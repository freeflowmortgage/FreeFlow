#!/bin/bash

# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - MONOREPO ASSET MIGRATION UTILITY (v17)
# =============================================================================
# This script automates moving your production-ready, sanitized point-solution 
# files from a flat download/artifacts directory into their permanent, 
# decoupled Monorepo workspaces. Run this command inside your workspace root [cite: 33].
# =============================================================================

# Pristine Terminal Color Codes
RED='\033;31m'
GREEN='\033;32m'
YELLOW='\033[1;33m'
BLUE='\033;0;34m'
CYAN='\033;0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}     🚀 FREEFLOW MORTGAGE PORTAL - MONOREPO FILE MIGRATOR (v17)       ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# Check for target workspace directories before running migration [cite: 33]
if [ ! -d "apps/web" ] || [ ! -d "packages" ] || [ ! -d "services" ]; then
    echo -e "${RED}❌ Error: Monorepo folder layout not detected in this directory.${NC}"
    echo -e "Please run the workspace scaffold command first to generate your workspaces:${NC}"
    echo -e "${CYAN}mkdir -p apps/web/src/components apps/web/src/pages/api/income apps/web/src/pages/api/underwrite apps/web/src/pages/api/billing packages/database/prisma packages/mortgage-engine/src packages/mortgage-engine/tests services/doc-parser/src${NC}\n"
    exit 1
fi

MIGRATED_COUNT=0
WARNING_COUNT=0

# Helper function to find a file in the workspace (flat, artifacts/, or knowledge/) and copy it [cite: 33]
migrate_file() {
    local filename="$1"
    local destination="$2"
    local label="$3"

    # Ensure destination parent directory exists
    mkdir -p "$(dirname "$destination")"

    # Search candidates: current folder, artifacts folder, knowledge folder [cite: 33]
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

echo -e "\n${CYAN}[1/5] Migrating Multi-Tenant Database Schema, Triggers & Security...${NC}"
migrate_file "supabase-schema-v4.prisma" "packages/database/prisma/schema.prisma" "Prisma Column-d Restructured Models"
migrate_file "calculate-quick-ratio-trigger.sql" "packages/database/prisma/calculate-quick-ratio-trigger.sql" "PostgreSQL Dynamic Schedule L Quick Ratio Trigger"
migrate_file "supabase-rls-policies.sql" "packages/database/prisma/supabase-rls-policies.sql" "PostgreSQL Row-Level Security Rules"

echo -e "\n${CYAN}[2/5] Migrating Highly Decoupled Slicer Container Microservice...${NC}"
migrate_file "Dockerfile-v2" "services/doc-parser/Dockerfile" "Non-Privileged Multi-Worker Dockerfile"
migrate_file "requirements.txt" "services/doc-parser/requirements.txt" "Python Dependency Requirements"
migrate_file "server.py" "services/doc-parser/src/server.py" "Stateless FastAPI ZDR Server"
migrate_file "ai_pdf_converter-v2.py" "services/doc-parser/src/ai_pdf_converter.py" "Pure In-Memory Computer Vision Core"
migrate_file "pre_split_tax_returns-v5.py" "services/doc-parser/src/pdf_splitter.py" "Poppler & OpenCV Pre-Slicing Module"
migrate_file "mismo_xml_exporter.py" "services/doc-parser/src/mismo_xml_exporter.py" "Standardized MISMO XML Exporter"
migrate_file "test-tmpfs-isolation.sh" "services/doc-parser/test-tmpfs-isolation.sh" "CISO-Ready ZDR Validator Tool"
migrate_file "ecs-task-definition-v4.json" "services/doc-parser/ecs-task-definition-v4.json" "Fargate-Compliant Hardware isolation config"
migrate_file "aws-ecs-task-execution-policy.json" "services/doc-parser/aws-iam-policies/aws-ecs-task-execution-policy.json" "AWS ECS Task Execution IAM Policy"
migrate_file "aws-ecs-task-role-policy.json" "services/doc-parser/aws-iam-policies/aws-ecs-task-role-policy.json" "AWS ECS Task Role IAM Policy"
migrate_file "env.slicer-v2" "services/doc-parser/.env.slicer" "Decoupled Serverless Env (POS-Free)"
migrate_file "aws-deploy-automation.sh" "services/doc-parser/aws-deploy-automation.sh" "ECR AWS Rolling Deploy Script"
migrate_file "aws-fargate-deployment-runbook.md" "services/doc-parser/DEPLOYMENT.md" "AWS ECS Fargate Runbook"

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
migrate_file "UnderwriterSplitViewDemo-v10.tsx" "apps/web/src/components/UnderwriterSplitViewDemo.tsx" "Flipped Underwriter Review Canvas"

echo -e "\n${CYAN}[5/5] Migrating Backend Node.js API Gateways & Field Mappers...${NC}"
migrate_file "calculate.ts" "apps/web/src/pages/api/income/calculate.ts" "Client Formula Execution Route"
migrate_file "underwrite-process-route-v2.ts" "apps/web/src/pages/api/underwrite/process.ts" "Document Process Router (v2)"
migrate_file "encompass-sync.ts" "apps/web/src/pages/api/underwrite/encompass-sync.ts" "Ellie Mae eFolder Transmit API"
migrate_file "map-encompass-fields-v3.ts" "apps/web/src/pages/api/underwrite/map-encompass-fields.ts" "Encompass Field Transformer v3"
migrate_file "map-encompass-fields-v3.test.ts" "apps/web/src/pages/api/underwrite/map-encompass-fields.test.ts" "Encompass Field Transformer Test Suite"
migrate_file "encompass-fallback-queue.ts" "apps/web/src/pages/api/underwrite/encompass-fallback-queue.ts" "Asynchronous Backup Dispatcher"
migrate_file "encompass-pull-efolder-docs.ts" "apps/web/src/pages/api/underwrite/encompass-pull-efolder-docs.ts" "eFolder Queue Document Pull"
migrate_file "mock-encompass-pull-test.ts" "apps/web/tests/mock-encompass-pull-test.ts" "Encompass eFolder Bulk Pull Mock Sandbox"

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "🥇 ${GREEN}MIGRATION COMPLETE: ${MIGRATED_COUNT} production assets successfully mapped!${NC}"
if [ ${WARNING_COUNT} -gt 0 ]; then
    echo -e "⚠️  ${YELLOW}Notice: ${WARNING_COUNT} optional or unchanged helper files were skipped.${NC}"
fi
echo -e "${BLUE}======================================================================${NC}"
