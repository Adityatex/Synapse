# P1-06: local dev image for the API. Installs workspace deps via pnpm
# (needs the monorepo context) and runs the plain-JS server with hot reload.
FROM node:20-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/shared ./packages/shared
COPY server/package.json ./server/package.json
RUN pnpm install --filter server... --frozen-lockfile=false
COPY server ./server
COPY packages/shared ./packages/shared
RUN pnpm --filter @synapse/shared build
WORKDIR /app/server
EXPOSE 5000
CMD ["pnpm", "dev"]
