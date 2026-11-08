# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Install build tools needed for native modules (@xenova/transformers deps)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ build-essential && rm -rf /var/lib/apt/lists/*
# Install dependencies in a separate layer for better caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --ignore-scripts=false install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Nuxt/Nitro bakes public runtime config defaults at build time, but NUXT_*
# env vars still override them at runtime in the node-server preset.
RUN pnpm build

FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

# Nitro node-server output is self-contained.
COPY --from=build /app/.output ./.output
# Domain blocklist read at runtime by server/utils/contentGuard.ts
COPY --from=build /app/server/blocked-domains.txt ./.output/server/blocked-domains.txt

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
