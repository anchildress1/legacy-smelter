# ── build stage ──────────────────────────────────────────────────────────────
# Installs all deps (including devDeps) and compiles the Vite SPA.
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── server stage ─────────────────────────────────────────────────────────────
# Minimal runtime: only express + dotenv + the compiled dist + server.js.
FROM node:24-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
RUN npm install express dotenv
COPY server.js .
COPY --from=builder /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
