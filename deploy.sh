#!/usr/bin/env bash
set -euo pipefail

# ── Legacy Smelter deploy script ────────────────────────────────────────────
# Builds, pushes, and deploys to Cloud Run for any environment.
#
# Usage:
#   ./deploy.sh                          # uses .env + defaults
#   ./deploy.sh --env-file .env.staging  # uses a specific env file
#   ./deploy.sh --project my-proj --region us-central1
#
# Required env vars (set in env file or exported):
#   VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_APP_URL
#
# Optional overrides (flags or env vars):
#   --project   / GCP_PROJECT   (default: anchildress1)
#   --region    / GCP_REGION    (default: us-east1)
#   --service   / SERVICE_NAME  (default: legacy-smelter)
# ─────────────────────────────────────────────────────────────────────────────

GCP_PROJECT="${GCP_PROJECT:-anchildress1}"
GCP_REGION="${GCP_REGION:-us-east1}"
SERVICE_NAME="${SERVICE_NAME:-legacy-smelter}"
ENV_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --project)  GCP_PROJECT="$2"; shift 2 ;;
    --region)   GCP_REGION="$2"; shift 2 ;;
    --service)  SERVICE_NAME="$2"; shift 2 ;;
    -h|--help)
      sed -n '3,14p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Load env file (default: .env in repo root)
ENV_FILE="${ENV_FILE:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  echo "==> Loading VITE_* vars from $ENV_FILE"
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^VITE_ ]] || continue
    value="${value%\"}" ; value="${value#\"}"
    export "$key=$value"
  done < <(grep -E '^VITE_' "$ENV_FILE")
else
  echo "==> No env file found at $ENV_FILE — expecting vars from environment"
fi

# ── Validate ─────────────────────────────────────────────────────────────────

required_vars=(
  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_PROJECT_ID
  VITE_APP_URL
)
missing=()
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: missing required env vars: ${missing[*]}"
  echo "Set them in $ENV_FILE or export before running."
  exit 1
fi

# ── Derived values ───────────────────────────────────────────────────────────

SERVICE_SA="legacy-smelter-run@${GCP_PROJECT}.iam.gserviceaccount.com"
IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/cloud-run-source-deploy/${SERVICE_NAME}"

echo ""
echo "  Project:  $GCP_PROJECT"
echo "  Region:   $GCP_REGION"
echo "  Service:  $SERVICE_NAME"
echo "  SA:       $SERVICE_SA"
echo "  Image:    $IMAGE"
echo "  App URL:  $VITE_APP_URL"
echo ""

# ── Build ────────────────────────────────────────────────────────────────────

echo "==> Building Docker image..."
docker build \
  --build-arg VITE_FIREBASE_API_KEY="${VITE_FIREBASE_API_KEY}" \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_AUTH_DOMAIN:-}" \
  --build-arg VITE_FIREBASE_PROJECT_ID="${VITE_FIREBASE_PROJECT_ID}" \
  --build-arg VITE_FIREBASE_STORAGE_BUCKET="${VITE_FIREBASE_STORAGE_BUCKET:-}" \
  --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID="${VITE_FIREBASE_MESSAGING_SENDER_ID:-}" \
  --build-arg VITE_FIREBASE_APP_ID="${VITE_FIREBASE_APP_ID:-}" \
  --build-arg VITE_FIREBASE_FIRESTORE_DATABASE_ID="${VITE_FIREBASE_FIRESTORE_DATABASE_ID:-}" \
  --build-arg VITE_APP_URL="${VITE_APP_URL}" \
  -t "${SERVICE_NAME}" .

# ── Push ─────────────────────────────────────────────────────────────────────

echo "==> Pushing to Artifact Registry..."
docker tag "${SERVICE_NAME}" "${IMAGE}"
docker push "${IMAGE}"

# ── Deploy ───────────────────────────────────────────────────────────────────

# VITE_* vars are set as runtime env vars for server.js (OG pre-render).
# GEMINI_API_KEY is injected from GSM.
echo "==> Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --project="${GCP_PROJECT}" \
  --region="${GCP_REGION}" \
  --image="${IMAGE}" \
  --service-account="${SERVICE_SA}" \
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars="\
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY},\
VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID},\
VITE_FIREBASE_FIRESTORE_DATABASE_ID=${VITE_FIREBASE_FIRESTORE_DATABASE_ID:-},\
VITE_APP_URL=${VITE_APP_URL}" \
  --allow-unauthenticated

echo "==> Deploy complete: ${SERVICE_NAME} → ${GCP_REGION}"
