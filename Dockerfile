# ── build stage ──────────────────────────────────────────────────────────────
# Installs all deps (including devDeps) and compiles the Vite SPA.
# VITE_* values are provided as a BuildKit secret env file at build time.
# This keeps secret-like names out of ARG/ENV image metadata.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY shared ./shared
COPY src ./src
RUN --mount=type=secret,id=vite_env,target=/run/secrets/vite_env \
  sh -eu -c 'set -a; . /run/secrets/vite_env; set +a; npm run build'

# ── production dependencies stage ─────────────────────────────────────────────
# Installs runtime dependencies from lockfile for deterministic image builds.
# Includes @google/genai for server-side Gemini calls.
FROM node:22-alpine AS server-deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ── server stage ─────────────────────────────────────────────────────────────
# Minimal runtime: express + @google/genai + dotenv + compiled dist + server.js.
#
# GEMINI_API_KEY is injected at runtime by Cloud Run from Google Secret Manager.
# VITE_FIREBASE_* and VITE_APP_URL are set as Cloud Run env vars for server.js
# (OG pre-render routes read them at runtime).
FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps --chown=node:node --chmod=0555 /app/node_modules ./node_modules
COPY --chown=node:node --chmod=0555 package.json server.js ./
COPY --chown=node:node --chmod=0555 shared ./shared
COPY --from=builder --chown=node:node --chmod=0555 /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server.js"]
