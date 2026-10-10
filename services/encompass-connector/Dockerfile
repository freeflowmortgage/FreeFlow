# syntax=docker/dockerfile:1
# Internal-only foundation image. It contains no LOS credentials or PDF persistence.

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base

ENV PNPM_HOME="/pnpm"
ENV COREPACK_HOME="/pnpm/corepack"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir -p "$COREPACK_HOME" && corepack enable
RUN apk add --no-cache openssl

WORKDIR /app

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma/
COPY packages/encompass-connector-contract/package.json ./packages/encompass-connector-contract/
COPY services/encompass-connector/package.json ./services/encompass-connector/

RUN corepack install
RUN --mount=type=cache,id=freeflow-pnpm-connector,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile \
    --filter @mortgage-pos/database... \
    --filter @mortgage-pos/encompass-connector...
RUN pnpm --filter @mortgage-pos/database exec prisma generate --schema prisma/schema.prisma

FROM deps AS build
WORKDIR /app

COPY packages/encompass-connector-contract ./packages/encompass-connector-contract
COPY services/encompass-connector ./services/encompass-connector

RUN pnpm --filter @mortgage-pos/encompass-connector build
RUN pnpm --filter @mortgage-pos/encompass-connector --prod deploy /runtime \
    && cp -R packages/database/prisma /runtime/prisma \
    && cd /runtime \
    && /app/packages/database/node_modules/.bin/prisma generate --schema prisma/schema.prisma \
    && rm -rf /runtime/prisma

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner

RUN apk add --no-cache openssl \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app

COPY --from=build /runtime ./
# Read-only synthetic freeflow-dev morning-pack fixtures. Real LOS mode never reads them.
COPY --from=build /app/services/encompass-connector/fixtures/morning-pack-2026-09-29 ./fixtures/morning-pack-2026-09-29

ENV NODE_ENV=production
ENV PORT=8080
# Boot refuses the NON-PROD Bearer stub when NODE_ENV=production. The isolated
# freeflow-dev foundation explicitly runs in development mode until real S2S
# authentication is implemented.

RUN addgroup --system --gid 1001 connector \
    && adduser --system --uid 1001 --ingroup connector connector

USER connector

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:' + (process.env.PORT || '8080') + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"]

WORKDIR /app
CMD ["node", "dist/index.js"]
