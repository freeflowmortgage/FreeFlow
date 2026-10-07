# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base

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

COPY . .

ENV NODE_ENV=production

RUN pnpm --filter @mortgage-pos/database prisma:generate
RUN pnpm --filter underwriting-console build

# 3. Production runtime stage (runs Vite custom middleware server for PDF/OCR and Appraisal proxy)
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:5c546c873970e79e5c9152cd9c8a9c7013824352bc89071d21feb15ad68496aa AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV VITE_CACHE_DIR=/tmp/freeflow/vite

# AL2023 locks packages to the image's release; --releasever=latest pulls current security fixes.
RUN microdnf --releasever=latest update -y \
    && microdnf --releasever=latest install -y tar xz shadow-utils libstdc++ \
    && curl -fsSLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz \
    && echo 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6  node-v24.21.0-linux-x64.tar.xz' | sha256sum -c - \
    && tar -xJf node-v24.21.0-linux-x64.tar.xz -C /usr/local --strip-components=1 \
    && rm node-v24.21.0-linux-x64.tar.xz \
    && microdnf clean all \
    && rm -rf /var/cache/dnf \
    && groupadd -g 1001 nodejs \
    && useradd -u 1001 -g nodejs -s /sbin/nologin -M consoleuser \
    && mkdir -p /tmp/freeflow \
    && chown consoleuser:nodejs /tmp/freeflow

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/underwriting-console ./apps/underwriting-console

RUN chown -R consoleuser:nodejs /app/apps/underwriting-console

USER consoleuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:3000/health', (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"]

WORKDIR /app/apps/underwriting-console
CMD ["node_modules/.bin/vite", "--host", "0.0.0.0", "--port", "3000"]
