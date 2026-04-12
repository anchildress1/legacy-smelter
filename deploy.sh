#!/usr/bin/env bash
set -euo pipefail

# ── Legacy Smelter deploy script ────────────────────────────────────────────
# Builds via Cloud Build, pushes to Artifact Registry, and deploys to
# Cloud Run for any environment.
#
# Usage:
#   ./deploy.sh                          # uses .env + defaults
#   ./deploy.sh --env-file .env.staging  # uses a specific env file
#   ./deploy.sh --project my-proj --region us-central1
#
# Required env vars (set in env file or exported):
#   VITE_FIREBASE_API_KEY
#   VITE_FIREBASE_AUTH_DOMAIN
#   VITE_FIREBASE_PROJECT_ID
#   VITE_FIREBASE_STORAGE_BUCKET
#   VITE_FIREBASE_MESSAGING_SENDER_ID
#   VITE_FIREBASE_APP_ID
#   VITE_FIREBASE_FIRESTORE_DATABASE_ID
#
# The server-side admin SDK (shared/admin-init.js) requires
# FIREBASE_PROJECT_ID and FIREBASE_FIRESTORE_DATABASE_ID at runtime. These
# MUST match their VITE_ counterparts, so this script derives them
# automatically if not explicitly set — there is no valid deploy where
# they diverge.
#
# VITE_APP_URL is auto-resolved from the existing Cloud Run service URL
# if not set, so switching gcloud projects just works.
#
# Optional overrides (flags or env vars):
#   --project   / GCP_PROJECT   (default: from gcloud config)
#   --region    / GCP_REGION    (default: us-east1)
#   --service   / SERVICE_NAME  (default: legacy-smelter)
# ─────────────────────────────────────────────────────────────────────────────

REGION="${GCP_REGION:-us-east1}"
SERVICE_NAME="${SERVICE_NAME:-legacy-smelter}"
ENV_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --project)  GCP_PROJECT="$2"; shift 2 ;;
    --region)   REGION="$2"; shift 2 ;;
    --service)  SERVICE_NAME="$2"; shift 2 ;;
    -h|--help)
      sed -n '3,18p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Preflight ────────────────────────────────────────────────────────────────

if ! command -v gcloud &>/dev/null; then
  echo "ERROR: gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

PROJECT_ID="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "ERROR: No GCP project set. Pass --project or run: gcloud config set project <ID>" >&2
  exit 1
fi

# ── Load env ─────────────────────────────────────────────────────────────────

ENV_FILE="${ENV_FILE:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  echo "==> Loading VITE_* vars from $ENV_FILE"
  while IFS= read -r line; do
    [[ "$line" =~ ^(VITE_[^=]+)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%\"}" ; value="${value#\"}"
    export "$key=$value"
  done < <(grep -E '^VITE_' "$ENV_FILE")
else
  echo "==> No env file at $ENV_FILE — expecting vars from environment"
fi

# ── Validate ─────────────────────────────────────────────────────────────────

required_vars=(
  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
  VITE_FIREBASE_STORAGE_BUCKET
  VITE_FIREBASE_MESSAGING_SENDER_ID
  VITE_FIREBASE_APP_ID
  VITE_FIREBASE_FIRESTORE_DATABASE_ID
)
missing=()
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: missing required env vars: ${missing[*]}" >&2
  echo "Set them in $ENV_FILE or export before running." >&2
  exit 1
fi

# Auto-resolve VITE_APP_URL from existing Cloud Run service if not set.
if [[ -z "${VITE_APP_URL:-}" ]]; then
  VITE_APP_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" --project="$PROJECT_ID" \
    --format="value(status.url)" 2>/dev/null || true)
  if [[ -n "$VITE_APP_URL" ]]; then
    echo "==> Resolved VITE_APP_URL from existing service: $VITE_APP_URL"
  else
    echo "ERROR: VITE_APP_URL not set and no existing service to resolve from." >&2
    echo "Set VITE_APP_URL in $ENV_FILE or export it for first deploy." >&2
    exit 1
  fi
fi

if [[ ! "$VITE_APP_URL" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "ERROR: VITE_APP_URL must be an absolute http(s) URL. Received: $VITE_APP_URL" >&2
  exit 1
fi
VITE_APP_URL="${VITE_APP_URL%/}"

# Mirror the VITE_FIREBASE_* values into the server-side admin SDK vars.
# These MUST match (shared/admin-init.js is the sole writer for incidents
# and must target the same project + database as the client), so mirroring
# eliminates drift and makes deploys self-sufficient without having to
# duplicate values in the env file. An explicit export still wins.
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-$VITE_FIREBASE_PROJECT_ID}"
export FIREBASE_FIRESTORE_DATABASE_ID="${FIREBASE_FIRESTORE_DATABASE_ID:-$VITE_FIREBASE_FIRESTORE_DATABASE_ID}"

# ── Derived values ───────────────────────────────────────────────────────────

SERVICE_SA="${SERVICE_NAME}-run@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest"

echo ""
echo "  Project:  $PROJECT_ID"
echo "  Region:   $REGION"
echo "  Service:  $SERVICE_NAME"
echo "  SA:       $SERVICE_SA"
echo "  Image:    $IMAGE"
echo "  App URL:  $VITE_APP_URL"
echo ""

# ── Enable APIs ──────────────────────────────────────────────────────────────

echo "==> Enabling required GCP APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT_ID" --quiet

# ── Artifact Registry ────────────────────────────────────────────────────────

if ! gcloud artifacts repositories describe "$SERVICE_NAME" \
  --location="$REGION" --project "$PROJECT_ID" --quiet &>/dev/null; then
  echo "==> Creating Artifact Registry repository: $SERVICE_NAME"
  gcloud artifacts repositories create "$SERVICE_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --project "$PROJECT_ID" \
    --description="Docker images for $SERVICE_NAME"
else
  echo "==> Artifact Registry repository exists: $SERVICE_NAME"
fi

# ── Build ────────────────────────────────────────────────────────────────────

echo "==> Building image via Cloud Build..."
gcloud builds submit \
  --project "$PROJECT_ID" \
  --config cloudbuild.yaml \
  --substitutions "\
_IMAGE_URI=${IMAGE},\
_VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY},\
_VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN:-},\
_VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID},\
_VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET:-},\
_VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID:-},\
_VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID:-},\
_VITE_FIREBASE_FIRESTORE_DATABASE_ID=${VITE_FIREBASE_FIRESTORE_DATABASE_ID:-},\
_VITE_APP_URL=${VITE_APP_URL}" \
  --quiet

# ── Deploy ───────────────────────────────────────────────────────────────────

echo "==> Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE" \
  --port 8080 \
  --service-account "$SERVICE_SA" \
  --set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest \
  --set-env-vars="\
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY},\
VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID},\
VITE_FIREBASE_FIRESTORE_DATABASE_ID=${VITE_FIREBASE_FIRESTORE_DATABASE_ID},\
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID},\
FIREBASE_FIRESTORE_DATABASE_ID=${FIREBASE_FIRESTORE_DATABASE_ID},\
VITE_APP_URL=${VITE_APP_URL}" \
  --allow-unauthenticated \
  --cpu-boost

# ── Verify ───────────────────────────────────────────────────────────────────

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.url)")

echo ""
echo "=================================================="
echo "Deploy complete!"
echo "  URL: ${SERVICE_URL}"
echo "=================================================="
