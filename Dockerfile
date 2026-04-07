# ── build stage ──────────────────────────────────────────────────────────────
# Installs all deps (including devDeps) and compiles the Vite SPA.
FROM node:24-alpine AS builder
WORKDIR /app
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
# GEMINI_API_KEY is injected at runtime by Cloud Run from Google Secret Manager:
#   gcloud run deploy ... --set-secrets=GEMINI_API_KEY=gemini-api-key:latest
FROM node:24-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY --from=builder /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
