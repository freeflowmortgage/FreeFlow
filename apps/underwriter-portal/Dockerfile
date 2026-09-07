# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

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
COPY packages/database/package.json ./packages/database/
COPY packages/ui/package.json ./packages/ui/

RUN pnpm install --frozen-lockfile

# 2. Builder stage. Inherit the dependency layer so pnpm workspace links remain
# intact; copying linked node_modules trees between stages breaks Prisma's CLI.
FROM deps AS builder
WORKDIR /app

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @mortgage-pos/database prisma:generate
RUN pnpm --filter @mortgage-pos/mortgage-engine build
RUN pnpm --filter web build

# 3. Production runner stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

RUN apk add --no-cache openssl

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/underwriter-portal/package.json ./apps/underwriter-portal/
COPY --from=builder /app/apps/underwriter-portal/next.config.js ./apps/underwriter-portal/
COPY --from=builder /app/apps/underwriter-portal/scripts ./apps/underwriter-portal/scripts
COPY --from=builder /app/apps/underwriter-portal/node_modules ./apps/underwriter-portal/node_modules
COPY --from=builder /app/apps/underwriter-portal/.next ./apps/underwriter-portal/.next

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:' + (process.env.PORT || '3001'), (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"]

WORKDIR /app/apps/underwriter-portal
CMD ["node", "scripts/start.mjs"]
