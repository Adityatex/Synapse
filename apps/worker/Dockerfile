# Worker image (P2-05). Build context is the repo root:  docker build -f apps/worker/Dockerfile .

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
# ydoc-store lists @synapse/redis as a dev dependency, so its manifest must be present to resolve the workspace.
COPY packages/redis/package.json packages/redis/
COPY packages/ydoc-store/package.json packages/ydoc-store/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter "@synapse/worker..."

COPY packages/ydoc-store packages/ydoc-store
COPY apps/worker apps/worker
RUN pnpm --filter @synapse/ydoc-store --filter @synapse/worker build \
 && pnpm --filter @synapse/worker deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/index.js"]
