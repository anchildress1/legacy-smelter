# ── build stage ──────────────────────────────────────────────────────────────
# Installs all deps (including devDeps) and compiles the Vite SPA.
# VITE_* args are inlined into the client bundle by Vite at build time.
FROM node:24-alpine AS builder
WORKDIR /app

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_FIRESTORE_DATABASE_ID
ARG VITE_APP_URL

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

# ── production dependencies stage ─────────────────────────────────────────────
# Installs runtime dependencies from lockfile for deterministic image builds.
# Includes @google/genai for server-side Gemini calls.
FROM node:24-alpine AS server-deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ── server stage ─────────────────────────────────────────────────────────────
# Minimal runtime: express + @google/genai + dotenv + compiled dist + server.js.
#
# GEMINI_API_KEY is injected at runtime by Cloud Run from Google Secret Manager.
# VITE_FIREBASE_* and VITE_APP_URL are set as Cloud Run env vars for server.js
# (OG pre-render routes read them at runtime).
FROM node:24-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY --from=builder /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
