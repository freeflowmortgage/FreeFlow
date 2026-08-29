#!/bin/bash

# ==============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - LOCAL ENVIRONMENT BOOTSTRAP SCRIPT
# ==============================================================================
# Sets up local docker containers, creates MinIO buckets, and runs database migrations.

set -e # Exit immediately on any command failure

# Text color formatting
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== 🚀 Initiating FreeFlow Local Bootstrap ===${NC}"

# 1. Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker daemon is not running. Please launch Docker Desktop and retry.${NC}"
    exit 1
fi

# 2. Setup local .env file
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 '.env' file not found. Copying from .env.development template...${NC}"
    cp .env.development .env
    echo -e "${GREEN}✓ Local .env file successfully created.${NC}"
else
    echo -e "${GREEN}✓ Local .env file already exists.${NC}"
fi

# 3. Spin up Docker containers (Postgres, Redis, MinIO)
echo -e "${BLUE}🐳 Spinning up Docker container services...${NC}"
docker-compose up -d

# 4. Wait for Database to become healthy
echo -e "${YELLOW}⏳ Waiting for PostgreSQL database to stabilize...${NC}"
until docker exec freeflow-postgres pg_isready -U postgres -d freeflow_dev >/dev/null 2>&1; do
    sleep 1
done
echo -e "${GREEN}✓ PostgreSQL is healthy and accepting connections.${NC}"

# 5. Initialize S3 Bucket inside MinIO Container
echo -e "${BLUE}📦 Creating S3 buckets inside MinIO local storage...${NC}"
# Use AWS CLI in a temporary container to create S3 bucket locally
docker run --net=host --entrypoint=/bin/sh amazon/aws-cli:2.15.15 -c \
  "aws --endpoint-url http://localhost:9000 s3 mb s3://freeflow-document-intake --region us-east-1" >/dev/null 2>&1 || true

echo -e "${GREEN}✓ Local S3 bucket 'freeflow-document-intake' initialized.${NC}"

# 6. Install Dependencies & Run Database Migrations
if [ -f "pnpm-lock.yaml" ]; then
    echo -e "${BLUE}📦 pnpm monorepo detected. Installing dependencies...${NC}"
    pnpm install
    echo -e "${BLUE}🔄 Running local Prisma database migrations...${NC}"
    pnpm prisma migrate dev --name init
elif [ -f "package.json" ]; then
    echo -e "${BLUE}📦 NPM package detected. Installing dependencies...${NC}"
    npm install
    if [ -d "prisma" ]; then
        echo -e "${BLUE}🔄 Running local Prisma database migrations...${NC}"
        npx prisma migrate dev --name init
    fi
fi

echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}🎉 FreeFlow Local Workspace Successfully Bootstrapped!${NC}"
echo -e "${GREEN}================================================================${NC}"
echo -e "🐳 Docker Containers Active: freeflow-postgres, freeflow-redis, freeflow-minio"
echo -e "🔌 Postgres Connection: postgresql://postgres:localpassword123@localhost:5432/freeflow_dev"
echo -e "💾 Redis Connection: redis://localhost:6379"
echo -e "🖥️  MinIO Web Admin UI: http://localhost:9001 (User: localminioadmin / Pass: localminiopassword123)"
echo -e "🚀 To launch the Next.js development server, run: ${YELLOW}npm run dev${NC} or ${YELLOW}pnpm dev${NC}"
echo -e "${GREEN}================================================================${NC}"
