#!/bin/bash

# ======================================================================
#   FREEFLOW MORTGAGE POS - SECURE LOCAL SANDBOX & TEST RUNNER
# ======================================================================
# This script boots up your isolated local PostgreSQL container,
# configures local environment variables, and executes your pipeline tests
# without touching cloud environments or risk-overwriting TypeScript code.

# Style codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}   FREEFLOW MORTGAGE POS - DEVELOPER SANDBOX ENVIRONMENT INITIALIZER  ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# 1. Verify Docker CLI is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ ERROR: Docker is not installed on this machine.${NC}"
    echo -e "Please install Docker Desktop (https://www.docker.com/products/docker-desktop) and try again."
    exit 1
fi

# 2. Check if Docker daemon is active
if ! docker info &> /dev/null; then
    echo -e "${YELLOW}⚠️ WARNING: Docker daemon is not running.${NC}"
    echo -e "Attempting to launch Docker services... (If on macOS, please open Docker Desktop manually)."
    
    # Try platform-specific startup commands safely
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start docker
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        open --background -a Docker
    fi

    # Wait and re-verify
    RETRY_COUNT=0
    until docker info &> /dev/null || [ $RETRY_COUNT -eq 6 ]; do
        echo -e "Waiting for Docker daemon to initialize... (Try $((RETRY_COUNT + 1))/6)"
        sleep 5
        RETRY_COUNT=$((RETRY_COUNT + 1))
    done

    if ! docker info &> /dev/null; then
        echo -e "${RED}❌ ERROR: Could not verify Docker status. Please open Docker Desktop and try again.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Docker daemon is active and running.${NC}"

# 3. Boot up PostgreSQL pgvector Sandbox Container
if [ -f "docker-compose.yml" ]; then
    echo -e "\n${BLUE}Booting database services via docker-compose...${NC}"
    docker compose up -d
else
    echo -e "\n${YELLOW}⚠️ WARNING: docker-compose.yml was not found in the current directory.${NC}"
    echo -e "Creating a temporary local compose file for pgvector database sandbox...${NC}"
    cat <<EOF > docker-compose.yml
version: '3.8'
services:
  db:
    image: ankane/pgvector:latest
    container_name: freeflow-postgres-sandbox
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: localpassword123
      POSTGRES_DB: freeflow_dev
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
EOF
    docker compose up -d
fi

# Confirm container is healthy
sleep 2
if docker ps | grep -q "freeflow-postgres-sandbox"; then
    echo -e "${GREEN}✓ PostgreSQL Sandbox Container is ONLINE [Port 5432]${NC}"
else
    echo -e "${RED}❌ ERROR: Failed to boot the database container. Check docker logs for details.${NC}"
    exit 1
fi

# 4. Set Environment Variables for Sandbox Tests
export DATABASE_URL="postgresql://postgres:localpassword123@localhost:5432/freeflow_dev?schema=public"
export NODE_ENV="development"

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}   SANDBOX ENVIRONMENT IS ACTIVE & CONFIGURED SUCCESSFULLY            ${NC}"
echo -e "${GREEN}======================================================================${NC}"

# 5. Run Python Backend Tests Safely (Check files exist first to prevent shell errors)
echo -e "\n${BLUE}Executing Local Verification Pipelines...${NC}"

if [ -f "scripts/test_tax_splitter_runner.py" ]; then
    echo -e "\n${YELLOW}Running Tax-Return Pre-Splitter Verification:${NC}"
    python3 scripts/test_tax_splitter_runner.py
else
    echo -e "${YELLOW}ℹ️ Notice: test_tax_splitter_runner.py not found in /scripts. Skipping splitter test.${NC}"
fi

if [ -f "scripts/test_checklist_runner.py" ]; then
    echo -e "\n${YELLOW}Running Dynamic Multi-Agency Checklist & Overlay Verification:${NC}"
    python3 scripts/test_checklist_runner.py
else
    echo -e "${YELLOW}ℹ️ Notice: test_checklist_runner.py not found in /scripts. Skipping checklist test.${NC}"
fi

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "   To run your main Web application locally, execute: ${YELLOW}pnpm dev${NC}"
echo -e "   To tear down database container when done, execute: ${YELLOW}docker compose down${NC}"
echo -e "${BLUE}======================================================================${NC}"
