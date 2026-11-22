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
COPY apps/underwriter-portal/package.json ./apps/underwriter-portal/
COPY apps/underwriting-console/package.json ./apps/underwriting-console/
COPY packages/mortgage-engine/package.json ./packages/mortgage-engine/
COPY packages/encompass-connector-contract/package.json ./packages/encompass-connector-contract/
COPY packages/database/package.json ./packages/database/
COPY packages/ui/package.json ./packages/ui/
COPY services/encompass-connector/package.json ./services/encompass-connector/

RUN --mount=type=cache,id=freeflow-pnpm-portal,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# 2. Builder stage. Inherit the dependency layer so pnpm workspace links remain
# intact; copying linked node_modules trees between stages breaks Prisma's CLI.
FROM deps AS builder
WORKDIR /app

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_STANDALONE_BUILD=1
ENV NODE_ENV=production

RUN pnpm --filter @mortgage-pos/database prisma:generate
RUN pnpm --filter @mortgage-pos/mortgage-engine build
RUN pnpm --filter web build
RUN mkdir -p apps/underwriter-portal/.next/workers \
    && ./services/encompass-connector/node_modules/.bin/esbuild \
        apps/underwriter-portal/scripts/document-pull-worker.ts \
        --bundle --platform=node --target=node22 --format=cjs \
        --external:@prisma/client \
        --outfile=apps/underwriter-portal/.next/workers/document-pull-worker.cjs \
    && ./services/encompass-connector/node_modules/.bin/esbuild \
        apps/underwriter-portal/scripts/encompass-sync-worker.ts \
        --bundle --platform=node --target=node22 --format=cjs \
        --external:@prisma/client \
        --outfile=apps/underwriter-portal/.next/workers/encompass-sync-worker.cjs \
    && ./services/encompass-connector/node_modules/.bin/esbuild \
        apps/underwriter-portal/scripts/outbound-webhook-worker.ts \
        --bundle --platform=node --target=node22 --format=cjs \
        --external:@prisma/client \
        --outfile=apps/underwriter-portal/.next/workers/outbound-webhook-worker.cjs
RUN rm -rf apps/underwriter-portal/.next/standalone/apps/underwriter-portal/src \
        apps/underwriter-portal/.next/standalone/node_modules/typescript \
        apps/underwriter-portal/.next/standalone/node_modules/.pnpm/typescript@* \
    && find apps/underwriter-portal/.next/standalone -type d -name .cache -prune -exec rm -rf '{}' +

# 3. Production runner stage
FROM cgr.dev/chainguard/wolfi-base@sha256:be019c1c74fe69204a42c4e10bc4d886a49bf5403ffa74374ef7baa408fc9a26 AS runner
WORKDIR /app

RUN apk add --no-cache \
        nodejs-26=26.13.1-r1 \
        openssl=3.6.5-r6 \
    && ldconfig \
    && addgroup -S -g 1001 nodejs \
    && adduser -S -D -h /home/nextjs -s /bin/false -G nodejs -u 1001 nextjs \
    && mkdir -p /home/nextjs \
    && chown nextjs:nodejs /home/nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV HOME="/home/nextjs"

COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/.next/static ./apps/underwriter-portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/public ./apps/underwriter-portal/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/scripts/start.mjs /app/apps/underwriter-portal/scripts/production-config.mjs ./apps/underwriter-portal/scripts/
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/.next/workers ./apps/underwriter-portal/workers

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/usr/bin/node", "-e", "require('http').get('http://127.0.0.1:' + (process.env.PORT || '3001'), (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"]

WORKDIR /app/apps/underwriter-portal
ENTRYPOINT []
CMD ["/usr/bin/node", "scripts/start.mjs"]
