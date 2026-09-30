# syntax=docker/dockerfile:1
# Construire depuis la racine du monorepo : docker build -f apps/api/Dockerfile --target runtime .

FROM node:24-alpine AS base
RUN npm install -g pnpm@10.33.2 turbo@2.11.5
ENV TURBO_TELEMETRY_DISABLED=1
WORKDIR /app

# Ne garde que l'API et les packages dont elle dépend (lockfile compris).
FROM base AS pruner
COPY . .
RUN turbo prune api --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Développement : le code est monté par docker compose, les node_modules viennent de l'image.
FROM deps AS dev
RUN chown node:node /app
USER node
EXPOSE 4000
CMD ["pnpm", "turbo", "run", "dev", "--filter=api"]

FROM deps AS build
COPY --from=pruner /app/out/full/ .
RUN turbo run build --filter=api
RUN pnpm --filter api deploy --prod --legacy /prod/api

# Production : uniquement dist + dépendances de prod, utilisateur non-root.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/api .
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/main.js"]
