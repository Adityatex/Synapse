# Production image: API + Socket.IO + the built client on one origin.
# Used by fly.toml (production), fly.staging.toml and docker-compose.demo.yml.
# (server/Dockerfile is the hot-reload dev image for docker-compose.yml.)

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Install with only manifests first so the dependency layer caches.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY server server
COPY client client

# Client is built with no VITE_* URLs, so it talks to its own origin
# (/api + same-origin Socket.IO).
RUN pnpm --filter @synapse/shared build \
 && pnpm --filter client build \
 && pnpm --filter server deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./server
COPY --from=build --chown=node:node /app/client/dist ./client/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
