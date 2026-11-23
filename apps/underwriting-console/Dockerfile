# syntax=docker/dockerfile:1
FROM cgr.dev/chainguard/node@sha256:8e8d45dd674724ccc71aed270223c3e2efc74edde6c841158d618d2baaaf5527 AS base

USER root
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache openssl=3.6.5-r6 \
    && corepack enable

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

# The public production entry point is standalone/protected-web. Hosted builds
# must opt in explicitly so an omitted build argument cannot ship an Encompass
# bundle to the standalone application.
ARG FREEFLOW_CONSOLE_MODE=protected-web
ENV NODE_ENV=production
ENV VITE_FREEFLOW_RUNTIME_MODE=$FREEFLOW_CONSOLE_MODE

RUN pnpm --filter @mortgage-pos/database prisma:generate
RUN pnpm --filter underwriting-console build
RUN ./services/encompass-connector/node_modules/esbuild/bin/esbuild \
        apps/underwriting-console/src/server/demoFixtureDocuments.ts \
        --bundle --platform=node --target=node24 --format=cjs \
        --outfile=apps/underwriting-console/dist/server/demo-fixtures.cjs
RUN cp -R apps/underwriting-console/node_modules/pdfkit/js/data \
        apps/underwriting-console/dist/server/data

# 3. Static protected runtime. Parser and fixture middleware are demo/QA-only.
# The shell is retained for the production ECS volume-init container.
FROM cgr.dev/chainguard/wolfi-base@sha256:be019c1c74fe69204a42c4e10bc4d886a49bf5403ffa74374ef7baa408fc9a26 AS runner
WORKDIR /app

RUN apk add --no-cache \
        nodejs-26=26.13.1-r1 \
        openssl=3.6.5-r6 \
    && ldconfig \
    && addgroup -S -g 1001 nodejs \
    && adduser -S -D -h /home/console -s /bin/false -G nodejs -u 1001 console \
    && mkdir -p /home/console /tmp/freeflow \
    && chown -R console:nodejs /home/console /tmp/freeflow

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV VITE_CACHE_DIR=/tmp/freeflow/vite
ENV HOME=/home/console

COPY --from=builder --chown=console:nodejs /app/apps/underwriting-console/dist ./dist
COPY --from=builder --chown=console:nodejs /app/services/doc-parser/templates ./forms
# serve-production.mjs loads sibling scripts at startup. Keep every local import beside it.
COPY --from=builder --chown=console:nodejs /app/apps/underwriting-console/scripts/serve-production.mjs ./serve-production.mjs
COPY --from=builder --chown=console:nodejs /app/apps/underwriting-console/scripts/portal-hosts.mjs ./portal-hosts.mjs

USER console

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/usr/bin/node", "-e", "require('http').get('http://127.0.0.1:3000/health', (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"]

ENTRYPOINT []
CMD ["/usr/bin/node", "/app/serve-production.mjs"]
