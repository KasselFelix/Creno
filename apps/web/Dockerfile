# syntax=docker/dockerfile:1
# Image de développement uniquement : en production, le front est déployé sur Vercel.

FROM node:24-alpine AS base
RUN npm install -g pnpm@10.33.2 turbo@2.11.5
ENV TURBO_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune web --docker

FROM base AS dev
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN mkdir -p apps/web/.next && chown node:node /app apps/web/.next
USER node
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["pnpm", "turbo", "run", "dev", "--filter=web"]
