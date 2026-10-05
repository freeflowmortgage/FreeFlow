# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# 1. Dependency installation stage
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/underwriting-console/package.json ./apps/underwriting-console/
COPY apps/underwriter-portal/package.json ./apps/underwriter-portal/
COPY packages/mortgage-engine/package.json ./packages/mortgage-engine/
COPY packages/encompass-connector-contract/package.json ./packages/encompass-connector-contract/
COPY packages/database/package.json ./packages/database/
COPY packages/ui/package.json ./packages/ui/
COPY services/encompass-connector/package.json ./services/encompass-connector/

RUN --mount=type=cache,id=freeflow-pnpm-console,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# 2. Builder stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/underwriting-console/node_modules ./apps/underwriting-console/node_modules
COPY --from=deps /app/apps/underwriter-portal/node_modules ./apps/underwriter-portal/node_modules
COPY --from=deps /app/packages/mortgage-engine/node_modules ./packages/mortgage-engine/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=deps /app/services/encompass-connector/node_modules ./services/encompass-connector/node_modules

COPY . .

ARG FREEFLOW_CONSOLE_MODE=encompass-hosted
ENV NODE_ENV=production
ENV VITE_FREEFLOW_RUNTIME_MODE=$FREEFLOW_CONSOLE_MODE

RUN pnpm --filter @mortgage-pos/database prisma:generate
RUN pnpm --filter underwriting-console build
RUN ./services/encompass-connector/node_modules/esbuild/bin/esbuild \
        apps/underwriting-console/src/server/demoFixtureDocuments.ts \
        --bundle --platform=node --target=node22 --format=cjs \
        --outfile=apps/underwriting-console/dist/server/demo-fixtures.cjs
RUN cp -R apps/underwriting-console/node_modules/pdfkit/js/data \
        apps/underwriting-console/dist/server/data

# 3. Static protected runtime. Parser and fixture middleware are demo/QA-only.
# Reuse the scan-clean pinned Node Alpine runtime used by the portal rather
# than carrying an RPM package manager and unused curl/PCRE libraries.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV VITE_CACHE_DIR=/tmp/freeflow/vite

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /tmp/freeflow \
    && chown node:node /tmp/freeflow

COPY --from=builder --chown=node:node /app/apps/underwriting-console/dist ./dist
COPY --from=builder --chown=node:node /app/services/doc-parser/templates ./forms
# serve-production.mjs loads sibling scripts at startup. Keep every local import beside it.
COPY --from=builder --chown=node:node /app/apps/underwriting-console/scripts/serve-production.mjs ./serve-production.mjs
COPY --from=builder --chown=node:node /app/apps/underwriting-console/scripts/portal-hosts.mjs ./portal-hosts.mjs

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:3000/health', (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"]

CMD ["node", "/app/serve-production.mjs"]
