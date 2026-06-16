# Wisp — single-process production image.
#
# One Hono server serves the stats API, the `/wisp.js` tracker, and the React
# dashboard SPA, backed by SQLite. The server runs the TypeScript sources
# directly via `tsx` (no compile step) because `src/tracker/serve.ts` and
# `src/web/serve.ts` resolve `dist/` through `import.meta.url`-relative paths
# that only hold when `src/` keeps its layout.

# ---- Stage 1: build ----------------------------------------------------------
# Native module (better-sqlite3) needs a toolchain to compile here.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install all deps (incl. dev) for the build, leveraging layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the tracker bundle (dist/wisp.js) and the dashboard (dist/web/).
COPY . .
RUN npm run build:all

# Drop dev-only deps so the runtime image carries just what `npm start` needs
# (tsx, hono, better-sqlite3, @hono/node-server). The compiled better-sqlite3
# binary stays valid because the runtime image shares this base.
RUN npm prune --omit=dev

# ---- Stage 2: runtime --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy the pruned dependency tree (with the prebuilt native binary) and the
# sources/artifacts the server reads at runtime.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# SQLite lives on a mounted volume in production; WISP_DB_PATH points at it.
# The default keeps a sane local fallback if the env var is unset.
ENV WISP_DB_PATH=/data/wisp.db

# Railway injects PORT; config.ts honors it. Documented here for clarity.
EXPOSE 3000

# Migrations run on boot (src/index.ts) before the server listens.
CMD ["npm", "start"]
