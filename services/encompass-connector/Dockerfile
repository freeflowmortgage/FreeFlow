# syntax=docker/dockerfile:1
# Internal-only foundation image. It contains no LOS credentials or PDF persistence.

FROM cgr.dev/chainguard/node@sha256:8e8d45dd674724ccc71aed270223c3e2efc74edde6c841158d618d2baaaf5527 AS base

USER root
ENV PNPM_HOME="/pnpm"
ENV COREPACK_HOME="/pnpm/corepack"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir -p "$COREPACK_HOME" \
    && apk add --no-cache openssl=3.6.5-r6 \
    && corepack enable

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
FROM cgr.dev/chainguard/wolfi-base@sha256:be019c1c74fe69204a42c4e10bc4d886a49bf5403ffa74374ef7baa408fc9a26 AS runner

WORKDIR /app

RUN apk add --no-cache \
        nodejs-26=26.13.1-r1 \
        openssl=3.6.5-r6 \
    && ldconfig \
    && addgroup -S -g 1001 connector \
    && adduser -S -D -h /home/connector -s /bin/false -G connector -u 1001 connector \
    && mkdir -p /home/connector \
    && chown connector:connector /home/connector

COPY --from=build --chown=connector:connector /runtime ./
# Read-only synthetic freeflow-dev morning-pack fixtures. Real LOS mode never reads them.
COPY --from=build --chown=connector:connector /app/services/encompass-connector/fixtures/morning-pack-2026-09-29 ./fixtures/morning-pack-2026-09-29

ENV NODE_ENV=production
ENV PORT=8080
ENV HOME=/home/connector
# Boot refuses the NON-PROD Bearer stub when NODE_ENV=production. The isolated
# freeflow-dev foundation explicitly runs in development mode until real S2S
# authentication is implemented.

USER connector

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/usr/bin/node", "-e", "require('http').get('http://127.0.0.1:' + (process.env.PORT || '8080') + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"]

WORKDIR /app
ENTRYPOINT []
CMD ["/usr/bin/node", "dist/index.js"]
