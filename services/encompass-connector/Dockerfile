# syntax=docker/dockerfile:1
# Internal-only foundation image. It contains no LOS credentials or PDF persistence.

FROM node:22-alpine AS base

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
RUN pnpm install --frozen-lockfile \
    --filter @mortgage-pos/database... \
    --filter @mortgage-pos/encompass-connector...
RUN pnpm --filter @mortgage-pos/database exec prisma generate --schema prisma/schema.prisma

FROM deps AS runner
WORKDIR /app

COPY packages/encompass-connector-contract ./packages/encompass-connector-contract
COPY services/encompass-connector ./services/encompass-connector

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
CMD ["pnpm", "--filter", "@mortgage-pos/encompass-connector", "start"]
