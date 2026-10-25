# Collab server image (P2-06): used by docker-compose.yml, and by staging/production later.
# Build context is the repo root:  docker build -f apps/collab/Dockerfile .

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Manifests first so the dependency layer caches.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/redis/package.json packages/redis/
COPY packages/room-doc/package.json packages/room-doc/
COPY apps/collab/package.json apps/collab/
RUN pnpm install --frozen-lockfile --filter "@synapse/collab..."

COPY packages/redis packages/redis
COPY packages/room-doc packages/room-doc
COPY apps/collab apps/collab
RUN pnpm --filter @synapse/redis --filter @synapse/room-doc --filter @synapse/collab build \
 && pnpm --filter @synapse/collab deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=5001
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
