#!/bin/bash

# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - MONOREPO ASSET MIGRATION UTILITY (v5)
# Sources: cwd, artifacts/, knowledge/, docs/Architecture, ~/Downloads
# Handles Windows duplicate names: "file (1).ext" / "file (2).ext"
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}     FREEFLOW MORTGAGE PORTAL - MONOREPO FILE MIGRATOR (v5)           ${NC}"
echo -e "${BLUE}======================================================================${NC}"

if [ ! -d "apps/web" ] || [ ! -d "packages" ] || [ ! -d "services" ]; then
    echo -e "${RED}Error: Monorepo folder layout not detected in this directory.${NC}"
    echo -e "Scaffolding missing workspaces..."
    mkdir -p apps/web/src/components \
      apps/web/src/pages/api/income \
      apps/web/src/pages/api/underwrite \
      apps/web/src/pages/api/billing \
      packages/database/prisma \
      packages/mortgage-engine/src \
      packages/mortgage-engine/tests \
      services/doc-parser/src
fi

MIGRATED_COUNT=0
WARNING_COUNT=0

DOWNLOADS_DIR="${USERPROFILE:-}/Downloads"
if [ -z "${DOWNLOADS_DIR}" ] || [ ! -d "${DOWNLOADS_DIR}" ]; then
    DOWNLOADS_DIR="/c/Users/bobae/Downloads"
fi

candidate_names() {
    local filename="$1"
    echo "$filename"
    if [[ "$filename" == *.* ]]; then
        local stem="${filename%.*}"
        local ext="${filename##*.}"
        echo "${stem} (1).${ext}"
        echo "${stem} (2).${ext}"
    else
        echo "${filename} (1)"
        echo "${filename} (2)"
    fi
}

find_source() {
    local filename="$1"
    local dirs=(
        "."
        "artifacts"
        "knowledge"
        "docs/Architecture"
        "docs/architecture"
        "archive/superseded/docs-artifacts/root"
        "archive/superseded/docs-artifacts/architecture"
        "${DOWNLOADS_DIR}"
        "Apps/web/lib/encompass"
        "apps/web/lib/encompass"
        "Apps/web/Pages/api/underwrite"
        "apps/web/pages/api/underwrite"
        "services/doc-parser"
        "services/doc-parser/src"
        "packages/mortgage-engine/src"
        "packages/mortgage-engine/tests"
    )
    local dir name
    for dir in "${dirs[@]}"; do
        [ -d "$dir" ] || continue
        while IFS= read -r name; do
            if [ -f "${dir}/${name}" ]; then
                echo "${dir}/${name}"
                return 0
            fi
        done < <(candidate_names "$filename")
    done
    return 1
}

migrate_file() {
    local filename="$1"
    local destination="$2"
    local label="$3"
    local fallback="${4:-}"

    mkdir -p "$(dirname "$destination")"

    local source=""
    if source=$(find_source "$filename"); then
        :
    elif [ -n "$fallback" ] && source=$(find_source "$fallback"); then
        echo -e "${YELLOW}  ~ Using fallback '${fallback}' for '${filename}'${NC}"
    else
        echo -e "${YELLOW}  Warning: Missing '${filename}'. Skipped ${destination}${NC}"
        WARNING_COUNT=$((WARNING_COUNT + 1))
        return 0
    fi

    cp "$source" "$destination"
    echo -e "${GREEN}  Migrated: ${label}${NC}"
    echo -e "           ${source} -> ${destination}"
    MIGRATED_COUNT=$((MIGRATED_COUNT + 1))
}

echo -e "\n${CYAN}[1/5] Migrating Multi-Tenant Database Schema & Security...${NC}"
migrate_file "supabase-schema-v2.prisma" "packages/database/prisma/schema.prisma" "Prisma Sanitized Models (Textract-Free)" "supabase-schema.prisma"
migrate_file "supabase-rls-policies.sql" "packages/database/prisma/supabase-rls-policies.sql" "PostgreSQL Row-Level Security Rules"

echo -e "\n${CYAN}[2/5] Migrating Highly Decoupled Slicer Container Microservice...${NC}"
# Live parser src (in-memory RapidOCR + pdf_splitter) is canonical. Do not overlay
# Architecture drops: Dockerfile-v2 (Poppler/Gunicorn), ai_pdf_converter-v2, or pre_split v4.
migrate_file "requirements.txt" "services/doc-parser/requirements.txt" "Python Dependency Requirements"
migrate_file "server.py" "services/doc-parser/src/server.py" "Stateless FastAPI ZDR Server"
migrate_file "test-tmpfs-isolation.sh" "services/doc-parser/test-tmpfs-isolation.sh" "CISO-Ready ZDR Validator Tool"
migrate_file "ecs-task-definition-v4.json" "services/doc-parser/ecs-task-definition.json" "Fargate-Compliant Hardware isolation config" "ecs-task-definition.json"
migrate_file "env.slicer-v2" "services/doc-parser/.env.slicer" "Decoupled Serverless Env (POS-Free)"

echo -e "\n${CYAN}[3/5] Migrating GSE-Compliant Rules Engine (v9 Upgrades)...${NC}"
migrate_file "calculateForm1084Income-v9.ts" "packages/mortgage-engine/src/calculateForm1084Income.ts" "Version 9 Agency Math Engine" "calculateForm1084Income-v7.ts"
migrate_file "payload-guard.ts" "packages/mortgage-engine/src/payload-guard.ts" "JSON Structure Validation Type-Guard"
migrate_file "usda-projected-income-engine-v2.ts" "packages/mortgage-engine/src/usda-projected-income-engine-v2.ts" "USDA Income Threshold Sorter"
migrate_file "usda-ssi-rules-engine.ts" "packages/mortgage-engine/src/usda-ssi-rules-engine.ts" "USDA SSI Continuance Evaluator"
migrate_file "subject-property-fnma.test.ts" "packages/mortgage-engine/tests/subject-property-fnma.test.ts" "FNMA Subject Rental Unit Tests"
migrate_file "fha-declining-multifamily.test.ts" "packages/mortgage-engine/tests/fha-declining-multifamily.test.ts" "FHA Multi-Family Unit Tests"
migrate_file "form1120-dividends-under-25.test.ts" "packages/mortgage-engine/tests/form1120-dividends-under-25.test.ts" "C-Corp Minority Dividend Tests"
migrate_file "mismo-d1c-mapping.test.ts" "packages/mortgage-engine/tests/mismo-d1c-mapping.test.ts" "MISMO 3.4 XML Mapping Tests"

echo -e "\n${CYAN}[4/5] Migrating POS Web Portal UI & Webhook Billing Handler...${NC}"
migrate_file "stripe-billing-router-v4.ts" "apps/underwriter-portal/src/pages/api/billing/webhook.ts" "Stripe Webhook Gateway (v4)"
migrate_file "UnderwriterSplitViewDemo-v5.tsx" "apps/underwriting-console/src/components/UnderwriterSplitViewDemo-v5.tsx" "Flipped Underwriter Review Canvas"
migrate_file "UnderwriterSplitViewDemo-v5.tsx" "apps/underwriter-portal/src/components/UnderwriterSplitViewDemo-v5.tsx" "Flipped Underwriter Review Canvas (portal)"
migrate_file "payment-intent-succeeded-v4.json" "apps/underwriter-portal/src/pages/api/billing/payment-intent-succeeded-v4.json" "Stripe payment-intent fixture"

echo -e "\n${CYAN}[5/5] Migrating Backend Node.js API Gateways...${NC}"
migrate_file "summary-pdf-route.ts" "docs/summary-pdf-route.ts" "Income summary PDF drop (keep; live route is adapted)"
# Do not copy underwrite-process-route-v2.ts onto portal process.ts — it execs converter-v2 and writes /tmp.
migrate_file "calculate.ts" "apps/web/src/pages/api/income/calculate.ts" "Client Formula Execution Route"
migrate_file "encompass-sync.ts" "apps/web/src/pages/api/underwrite/encompass-sync.ts" "LOS Folder EFolder Export Gateway"
migrate_file "map-encompass-fields-v2.ts" "apps/web/src/pages/api/underwrite/map-encompass-fields.ts" "Encompass Field Serializer" "map-encompass-fields.ts"
migrate_file "encompass-fallback-queue.ts" "apps/web/src/pages/api/underwrite/encompass-fallback-queue.ts" "Fail-Safe Async Queue Dispatcher"
migrate_file "encompass-pull-efolder-docs.ts" "apps/web/src/pages/api/underwrite/encompass-pull-efolder-docs.ts" "LOS Document Ingestion Queue Listener"

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "${GREEN}MIGRATION COMPLETE: ${MIGRATED_COUNT} production assets mapped.${NC}"
if [ ${WARNING_COUNT} -gt 0 ]; then
    echo -e "${YELLOW}Notice: ${WARNING_COUNT} files were not in docs/Architecture or Downloads.${NC}"
fi
echo -e "${BLUE}======================================================================${NC}"
