# Production image: API + Socket.IO + the built client + the collab server, one origin, one port.
# Used by fly.toml (production), fly.staging.toml and docker-compose.demo.yml.
# (server/Dockerfile is the hot-reload dev image for docker-compose.yml, apps/collab/Dockerfile the
# stand-alone collab image used by compose and by replicas.)
#
# Two processes (scripts/start-prod.js): the api on PORT, and the collab server on 5001 inside the
# container. The api passes /collab WebSocket upgrades on to it, so only PORT is published.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Install with only manifests first so the dependency layer caches.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/redis/package.json packages/redis/
COPY packages/room-doc/package.json packages/room-doc/
COPY packages/ydoc-store/package.json packages/ydoc-store/
COPY apps/collab/package.json apps/collab/
COPY server/package.json server/
COPY client/package.json client/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/redis packages/redis
COPY packages/room-doc packages/room-doc
COPY packages/ydoc-store packages/ydoc-store
COPY apps/collab apps/collab
COPY server server
COPY client client

# Client is built with no VITE_* URLs, so it talks to its own origin
# (/api, same-origin Socket.IO, and /collab for the collab server).
RUN pnpm --filter @synapse/shared --filter @synapse/redis --filter @synapse/room-doc --filter @synapse/ydoc-store --filter @synapse/collab build \
 && pnpm --filter client build \
 && pnpm --filter server deploy --prod --legacy /out \
 && pnpm --filter @synapse/collab deploy --prod --legacy /out-collab

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./server
COPY --from=build --chown=node:node /out-collab ./collab
COPY --from=build --chown=node:node /app/client/dist ./client/dist
COPY --chown=node:node scripts/start-prod.js ./start-prod.js
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:'+process.env.PORT+'/api/health'),fetch('http://127.0.0.1:'+(process.env.COLLAB_PORT||5001)+'/health')]).then(r=>process.exit(r.every(x=>x.ok)?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start-prod.js"]
