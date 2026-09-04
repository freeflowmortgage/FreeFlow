# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

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

# 2. Builder stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/underwriter-portal/node_modules ./apps/underwriter-portal/node_modules
COPY --from=deps /app/apps/underwriting-console/node_modules ./apps/underwriting-console/node_modules
COPY --from=deps /app/packages/mortgage-engine/node_modules ./packages/mortgage-engine/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @mortgage-pos/database prisma:generate
RUN pnpm --filter @mortgage-pos/mortgage-engine build 2>/dev/null || true
RUN pnpm --filter web build

# 3. Production runner stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/underwriter-portal/package.json ./apps/underwriter-portal/
COPY --from=builder /app/apps/underwriter-portal/next.config.js ./apps/underwriter-portal/
COPY --from=builder /app/apps/underwriter-portal/node_modules ./apps/underwriter-portal/node_modules
COPY --from=builder /app/apps/underwriter-portal/.next ./apps/underwriter-portal/.next
COPY --from=builder /app/apps/underwriter-portal/public ./apps/underwriter-portal/public 2>/dev/null || true

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:3001', (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"]

WORKDIR /app/apps/underwriter-portal
CMD ["node_modules/.bin/next", "start", "-p", "3001"]
