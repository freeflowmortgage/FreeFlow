#!/bin/bash

# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - MONOREPO ASSET MIGRATION UTILITY (v7)
# =============================================================================
# WARNING: This drop still copies Poppler-era Dockerfile-v2, converter-v2, and
# pre_split v4 onto live parser paths, and targets apps/web. Do not run it
# against the current in-memory parser. Use copy-assets-v5.sh (hardened) or
# copy files by hand. See docs/ARCHITECTURE.md.
# =============================================================================

# Pristine Terminal Color Codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}     🚀 FREEFLOW MORTGAGE PORTAL - MONOREPO FILE MIGRATOR (v7)        ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# Check for target workspace directories before running migration
if [ ! -d "apps/web" ] || [ ! -d "packages" ] || [ ! -d "services" ]; then
    echo -e "${RED}❌ Error: Monorepo folder layout not detected in this directory.${NC}"
    echo -e "Please run the workspace scaffold command first to generate your workspaces:${NC}"
    echo -e "${CYAN}mkdir -p apps/web/src/components apps/web/src/pages/api/income apps/web/src/pages/api/underwrite apps/web/src/pages/api/billing packages/database/prisma packages/mortgage-engine/src packages/mortgage-engine/tests services/doc-parser/src${NC}\n"
    exit 1
fi

MIGRATED_COUNT=0
WARNING_COUNT=0

# Helper function to find a file in the workspace (flat, artifacts/, or knowledge/) and copy it
migrate_file() {
    local filename="$1"
    local destination="$2"
    local label="$3"

    # Ensure destination parent directory exists
    mkdir -p "$(dirname "$destination")"

    # Search candidates: current folder, artifacts folder, knowledge folder
    if [ -f "$filename" ]; then
        cp "$filename" "$destination"
        echo -e "${GREEN}  ✓ Migrated: ${label} -> ${destination}${NC}"
        MIGRATED_COUNT=$((MIGRATED_COUNT + 1))
    elif [ -f "artifacts/$filename" ]; then
        cp "artifacts/$filename" "$destination"
        echo -e "${GREEN}  ✓ Migrated (from artifacts/): ${label} -> ${destination}${NC}"
        MIGRATED_COUNT=$((MIGRATED_COUNT + 1))
    elif [ -f "knowledge/$filename" ]; then
        cp "knowledge/$filename" "$destination"
        echo -e "${GREEN}  ✓ Migrated (from knowledge/): ${label} -> ${destination}${NC}"
        MIGRATED_COUNT=$((MIGRATED_COUNT + 1))
    else
        echo -e "${RED}  ❌ Error: Missing '${filename}'. Please verify it is in your download workspace.${NC}"
        WARNING_COUNT=$((WARNING_COUNT + 1))
    fi
}

echo -e "\n${CYAN}[1/5] Migrating Multi-Tenant Database Schema & Security...${NC}"
migrate_file "supabase-schema-v2.prisma" "packages/database/prisma/schema.prisma" "Prisma Sanitized Models (Textract-Free)"
migrate_file "supabase-rls-policies.sql" "packages/database/prisma/supabase-rls-policies.sql" "PostgreSQL Row-Level Security Rules"

echo -e "\n${CYAN}[2/5] Migrating Highly Decoupled Slicer Container Microservice...${NC}"
migrate_file "Dockerfile-v2" "services/doc-parser/Dockerfile" "Non-Privileged Multi-Worker Dockerfile"
migrate_file "requirements.txt" "services/doc-parser/requirements.txt" "Python Dependency Requirements"
migrate_file "server.py" "services/doc-parser/src/server.py" "Stateless FastAPI ZDR Server"
migrate_file "ai_pdf_converter-v2.py" "services/doc-parser/src/ai_pdf_converter.py" "Pure In-Memory Computer Vision Core"
migrate_file "pre_split_tax_returns-v4.py" "services/doc-parser/src/pdf_splitter.py" "Four-Pass Regex Tax Splitting Core"
migrate_file "test-tmpfs-isolation.sh" "services/doc-parser/test-tmpfs-isolation.sh" "CISO-Ready ZDR Validator Tool"
migrate_file "ecs-task-definition-v4.json" "services/doc-parser/ecs-task-definition-v4.json" "Fargate-Compliant Hardware isolation config"
migrate_file "env.slicer-v2" "services/doc-parser/.env.slicer" "Decoupled Serverless Env (POS-Free)"

echo -e "\n${CYAN}[3/5] Migrating GSE-Compliant Rules Engine (v9 Upgrades)...${NC}"
migrate_file "calculateForm1084Income-v9.ts" "packages/mortgage-engine/src/calculateForm1084Income.ts" "Version 9 Agency Math Engine"
migrate_file "payload-guard.ts" "packages/mortgage-engine/src/payload-guard.ts" "JSON Structure Validation Type-Guard"
migrate_file "usda-projected-income-engine-v2.ts" "packages/mortgage-engine/src/usda-projected-income-engine-v2.ts" "USDA Income Threshold Sorter"
migrate_file "usda-ssi-rules-engine.ts" "packages/mortgage-engine/src/usda-ssi-rules-engine.ts" "USDA SSI Continuance Evaluator"
migrate_file "subject-property-fnma.test.ts" "packages/mortgage-engine/tests/subject-property-fnma.test.ts" "FNMA Subject Rental Unit Tests"
migrate_file "fha-declining-multifamily.test.ts" "packages/mortgage-engine/tests/fha-declining-multifamily.test.ts" "FHA Multi-Family Unit Tests"
migrate_file "form1120-dividends-under-25.test.ts" "packages/mortgage-engine/tests/form1120-dividends-under-25.test.ts" "C-Corp Minority Dividend Tests"
migrate_file "mismo-d1c-mapping.test.ts" "packages/mortgage-engine/tests/mismo-d1c-mapping.test.ts" "MISMO 3.4 XML Mapping Tests"

echo -e "\n${CYAN}[4/5] Migrating POS Web Portal UI & Webhook Billing Handler...${NC}"
migrate_file "stripe-billing-router-v4.ts" "apps/web/src/pages/api/billing/webhook.ts" "Stripe Webhook Gateway (v4)"
migrate_file "UnderwriterSplitViewDemo-v7.tsx" "apps/web/src/components/UnderwriterSplitViewDemo.tsx" "Flipped Underwriter Review Canvas"

echo -e "\n${CYAN}[5/5] Migrating Backend Node.js API Gateways...${NC}"
migrate_file "calculate.ts" "apps/web/src/pages/api/income/calculate.ts" "Client Formula Execution Route"
migrate_file "underwrite-process-route-v2.ts" "apps/web/src/pages/api/underwrite/process.ts" "Document Process Router (v2)"
migrate_file "encompass-sync.ts" "apps/web/src/pages/api/underwrite/encompass-sync.ts" "LOS Folder EFolder Export Gateway"
migrate_file "map-encompass-fields-v2.ts" "apps/web/src/pages/api/underwrite/map-encompass-fields.ts" "Encompass Field Serializer"
migrate_file "encompass-fallback-queue.ts" "apps/web/src/pages/api/underwrite/encompass-fallback-queue.ts" "Fail-Safe Async Queue Dispatcher"
migrate_file "encompass-pull-efolder-docs.ts" "apps/web/src/pages/api/underwrite/encompass-pull-efolder-docs.ts" "LOS Document Ingestion Queue Listener"

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "🥇 ${GREEN}MIGRATION COMPLETE: ${MIGRATED_COUNT} production assets successfully mapped!${NC}"
if [ ${WARNING_COUNT} -gt 0 ]; then
    echo -e "⚠️  ${YELLOW}Notice: ${WARNING_COUNT} optional or unchanged helper files were skipped.${NC}"
fi
echo -e "${BLUE}======================================================================${NC}"
