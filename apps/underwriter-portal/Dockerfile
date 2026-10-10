# syntax=docker/dockerfile:1
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache openssl \
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
        --outfile=apps/underwriter-portal/.next/workers/encompass-sync-worker.cjs

# 3. Production runner stage
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

RUN apk upgrade --no-cache zlib \
    && apk add --no-cache openssl \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/.next/static ./apps/underwriter-portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/public ./apps/underwriter-portal/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/scripts/start.mjs /app/apps/underwriter-portal/scripts/production-config.mjs ./apps/underwriter-portal/scripts/
COPY --from=builder --chown=nextjs:nodejs /app/apps/underwriter-portal/.next/workers ./apps/underwriter-portal/workers
RUN rm -rf /app/apps/underwriter-portal/src /app/node_modules/typescript \
        /app/node_modules/.pnpm/typescript@* /opt/yarn-v* \
    && find /app -type d -name .cache -prune -exec rm -rf '{}' +

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:' + (process.env.PORT || '3001'), (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"]

WORKDIR /app/apps/underwriter-portal
CMD ["node", "scripts/start.mjs"]
