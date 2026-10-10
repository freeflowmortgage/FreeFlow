#!/bin/bash

# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - UNIFIED MONOREPO MASTER MIGRATOR (v24-updated)
# =============================================================================
# Hardened v24: Windows duplicate names, Docs/ search, live-parser protection.
# Maps PdfCoordinateCanvas-v2 into apps/web (legacy tree), packages/ui (shared),
# and apps/underwriting-console (live local UI).
#
# Does NOT overlay services/doc-parser live ingest (pypdfium2 + RapidOCR).
# See docs/ARCHITECTURE.md.
#
# RUN:
#   bash ./copy-assets-v24-updated.sh
# =============================================================================

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}  FREEFLOW MORTGAGE SOLUTIONS - MASTER MONOREPO MIGRATOR (v24-updated)${NC}"
echo -e "${BLUE}======================================================================${NC}"

echo -e "\n${CYAN}Initializing workspace directories...${NC}"
mkdir -p .github/workflows \
         apps/web/src/components \
         apps/web/src/pages/api/income \
         apps/web/src/pages/api/underwrite \
         apps/web/src/pages/api/billing \
         apps/web/src/styles \
         apps/web/src/hooks \
         apps/web/src/utils \
         apps/web/tests \
         apps/underwriting-console/src/components \
         apps/underwriting-console/src/hooks \
         apps/underwriting-console/e2e \
         packages/ui/src/components \
         packages/ui/src/hooks \
         packages/database/prisma \
         packages/mortgage-engine/src \
         packages/mortgage-engine/tests \
         services/doc-parser/src \
         services/doc-parser/aws-iam-policies \
         services/appraisal-parser/src \
         services/gateway-proxy \
         scripts

MIGRATED_COUNT=0
WARNING_COUNT=0
SKIPPED_PROTECTED=0

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
        "Docs"
        "docs"
        "Docs/Architecture"
        "docs/Architecture"
        "docs/architecture"
        "artifacts"
        "knowledge"
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

skip_protected() {
    echo -e "${YELLOW}  Protected: $1 (live in-memory parser stays canonical)${NC}"
    SKIPPED_PROTECTED=$((SKIPPED_PROTECTED + 1))
}

echo -e "\n${CYAN}[1/8] Migrating Multi-Tenant Database Schema, Triggers & Security...${NC}"
echo -e "${YELLOW}  Skipping updated-prisma-schema overlay; merging appraisal additions only.${NC}"
migrate_file "appraisal_prisma_additions.prisma" "packages/database/prisma/appraisal_prisma_additions.prisma" "Appraisal Prisma model additions"
migrate_file "appraisal_prisma_additions.sql" "packages/database/prisma/appraisal_prisma_additions.sql" "PostgreSQL Schema Additions SQL Migration" "appraisal_prisma_additions.prisma"
migrate_file "calculate-quick-ratio-trigger.sql" "packages/database/prisma/calculate-quick-ratio-trigger.sql" "PostgreSQL Dynamic Schedule L Quick Ratio Trigger"
migrate_file "supabase-rls-policies.sql" "packages/database/prisma/supabase-rls-policies.sql" "PostgreSQL Row-Level Security Rules"
migrate_file "truncate-stale-loans.sql" "packages/database/prisma/truncate-stale-loans.sql" "Safe Relational Purger Utility"

echo -e "\n${CYAN}[2/8] Protecting live AI Income Document Slicer (no Poppler overlay)...${NC}"
skip_protected "Dockerfile-v2 / services/doc-parser/Dockerfile"
skip_protected "ai_pdf_converter-v2.py / services/doc-parser/src/ai_pdf_converter.py"
skip_protected "pre_split_tax_returns-v5.py / services/doc-parser/src/pdf_splitter.py"
skip_protected "server.py overlay of live FastAPI ingest"
migrate_file "test-tmpfs-isolation.sh" "services/doc-parser/test-tmpfs-isolation.sh" "CISO-Ready ZDR Validator Tool"
migrate_file "ecs-task-definition-v4.json" "services/doc-parser/ecs-task-definition-v4.json" "Fargate-Compliant Hardware isolation config" "ecs-task-definition.json"
migrate_file "aws-ecs-task-execution-policy.json" "services/doc-parser/aws-iam-policies/aws-ecs-task-execution-policy.json" "AWS ECS Task Execution IAM Policy"
migrate_file "aws-ecs-task-role-policy.json" "services/doc-parser/aws-iam-policies/aws-ecs-task-role-policy.json" "AWS ECS Task Role IAM Policy"
migrate_file "env.slicer-v2" "services/doc-parser/.env.slicer.example" "Decoupled Serverless Env template (not live .env.slicer)"
migrate_file "aws-deploy-automation.sh" "services/doc-parser/aws-deploy-automation.sh" "ECR AWS Rolling Deploy Script"
migrate_file "aws-fargate-deployment-runbook.md" "services/doc-parser/DEPLOYMENT.md" "AWS ECS Fargate Runbook"

echo -e "\n${CYAN}[3/8] Migrating Stateless Appraisal Parser Container Microservice...${NC}"
migrate_file "Dockerfile-appraisal-zdr" "services/appraisal-parser/Dockerfile" "Appraisal Non-Root ZDR Dockerfile"
migrate_file "appraisal-parser-main.py" "services/appraisal-parser/src/main.py" "Appraisal Core FastAPI Server"
migrate_file "appraisal_parser_v4.py" "services/appraisal-parser/src/appraisal_parser.py" "Appraisal Dynamic Matrix OCR Parsing Engine (v4)"

echo -e "\n${CYAN}[4/8] Migrating GSE-Compliant Rules Engines & Test Suites...${NC}"
migrate_file "calculateForm1084Income-v9.ts" "packages/mortgage-engine/src/calculateForm1084Income.ts" "Version 9 Agency Math Engine"
migrate_file "AppraisalRulesEngine-v2.ts" "packages/mortgage-engine/src/AppraisalRulesEngine.ts" "Appraisal Rules Engine with Matrix Coordinates (v2)"
migrate_file "payload-guard.ts" "packages/mortgage-engine/src/payload-guard.ts" "JSON Structure Validation Type-Guard"
migrate_file "usda-projected-income-engine-v2.ts" "packages/mortgage-engine/src/usda-projected-income-engine-v2.ts" "USDA Income Threshold Sorter"
migrate_file "usda-ssi-rules-engine.ts" "packages/mortgage-engine/src/usda-ssi-rules-engine.ts" "USDA SSI Continuance Evaluator"
migrate_file "income-sync.test.ts" "packages/mortgage-engine/tests/income-sync.test.ts" "Reconciled Wage Income Test Suite"
migrate_file "appraisal-sync.test.ts" "packages/mortgage-engine/tests/appraisal-sync.test.ts" "Appraisal Integration Tests"

echo -e "\n${CYAN}[5/8] Migrating Front-End Web Portal, Shared Canvas & Live Console...${NC}"
migrate_file "theme-variables.css" "apps/web/src/styles/theme-variables.css" "Premium Light-to-Dark Token CSS File"
migrate_file "tailwind-theme-toggles.config.js" "apps/web/tailwind.config.js" "Dynamic Tailwind Variable Theme Configuration"
migrate_file "index-v3.tsx" "apps/web/src/pages/index.tsx" "Interactive B2B Landing & Speech Dashboard (v3)"
migrate_file "UnderwriterSplitViewDemo-v11.tsx" "apps/web/src/components/UnderwriterSplitViewDemo.tsx" "Income QA Dashboard (v11) -> leftover apps/web tree"
migrate_file "AppraisalReviewGrid-v3.tsx" "apps/web/src/components/AppraisalReviewGrid.tsx" "Collateral QA Dashboard (v3) -> leftover apps/web tree"
migrate_file "AppraisalReviewGrid-v3.tsx" "apps/underwriting-console/src/components/AppraisalReviewGrid.tsx" "Collateral QA Dashboard (v3) -> live console"
migrate_file "AppraisalReviewWorkspace.tsx" "apps/underwriting-console/src/components/AppraisalReviewWorkspace.tsx" "Appraisal canvas workspace (highlight + page switch)"
migrate_file "AppraisalReviewWorkspace.tsx" "apps/web/src/components/AppraisalReviewWorkspace.tsx" "Appraisal canvas workspace -> leftover apps/web tree"

# Core PDF viewer: v2 engine with fallback to unversioned drop
migrate_file "PdfCoordinateCanvas-v2.tsx" "apps/web/src/components/PdfCoordinateCanvas.tsx" "Interactive PDF Coordinates Canvas (v2) -> apps/web" "PdfCoordinateCanvas.tsx"
migrate_file "PdfCoordinateCanvas-v2.tsx" "packages/ui/src/components/PdfCoordinateCanvas.tsx" "Interactive PDF Coordinates Canvas (v2) -> shared UI" "PdfCoordinateCanvas.tsx"
migrate_file "PdfCoordinateCanvas-v2.tsx" "apps/underwriting-console/src/components/PdfCoordinateCanvas.tsx" "Interactive PDF Coordinates Canvas (v2) -> live console" "PdfCoordinateCanvas.tsx"

migrate_file "usePdfViewer.ts" "apps/web/src/hooks/usePdfViewer.ts" "Shared PDF Canvas Coordination Hook -> apps/web"
migrate_file "usePdfViewer.ts" "packages/ui/src/hooks/usePdfViewer.ts" "Shared PDF Canvas Coordination Hook -> shared UI"
migrate_file "usePdfViewer.ts" "apps/underwriting-console/src/hooks/usePdfViewer.ts" "Shared PDF Canvas Coordination Hook -> live console"

migrate_file "conversational-1003-client-engine.tsx" "apps/web/src/components/Conversational1003ClientEngine.tsx" "Stateless WebCrypto Conversational Intake Component"
migrate_file "stripe-subscription-gateway.ts" "apps/web/src/utils/stripe-subscription-gateway.ts" "SaaS Tier Seat Gatekeeping Middleware"

echo -e "\n${CYAN}[6/8] Migrating Node.js API Gateway Routes (no process-v2 overlay)...${NC}"
migrate_file "calculate.ts" "apps/web/src/pages/api/income/calculate.ts" "Form 1084 Math Execution Endpoint"
migrate_file "calculate.ts" "apps/underwriter-portal/src/pages/api/income/calculate.ts" "Form 1084 Math Execution Endpoint (portal)"
skip_protected "underwrite-process-route-v2.ts / live process.ts"
migrate_file "appraisal-audit-route.ts" "apps/web/src/pages/api/underwrite/appraisal-audit.ts" "In-Memory Appraisal mTLS API Route"
migrate_file "appraisal-audit-route.ts" "apps/underwriter-portal/src/pages/api/underwrite/appraisal-audit.ts" "In-Memory Appraisal mTLS API Route (portal)"
migrate_file "map-encompass-fields-v3.ts" "apps/underwriter-portal/src/pages/api/underwrite/map-encompass-fields.ts" "Encompass Field Transformer (v3)" "map-encompass-fields-v2.ts"
migrate_file "encompass-fallback-queue.ts" "apps/underwriter-portal/src/pages/api/underwrite/encompass-fallback-queue.ts" "Redis-Backed Encompass Dispatch Queue"
migrate_file "encompass-pull-efolder-docs.ts" "apps/underwriter-portal/src/pages/api/underwrite/encompass-pull-efolder-docs.ts" "Encompass Inbound Queue Doc Puller"
migrate_file "stripe-billing-router-v4.ts" "apps/underwriter-portal/src/pages/api/billing/webhook.ts" "Transactional Metered Stripe Webhook Handler (v4)"

echo -e "\n${CYAN}[7/8] Migrating Local Dev Runners & Playwright E2E Tests...${NC}"
migrate_file "seed-staging-tenants.ts" "packages/database/prisma/seed-staging-tenants.ts" "PostgreSQL Staging Environment Database Seeder"
migrate_file "appraisal-validation.spec.ts" "apps/web/tests/appraisal-validation.spec.ts" "Playwright E2E suite -> apps/web/tests"
migrate_file "appraisal-validation.spec.ts" "apps/underwriting-console/e2e/appraisal-validation.spec.ts" "Playwright E2E suite -> live console"
migrate_file "nginx-secure-routing-v2.conf" "services/gateway-proxy/nginx.conf" "mTLS Edge Gateway Proxy Configuration"
migrate_file "docker-compose.prod.yml" "docker-compose.prod.yml" "VPC-Isolated Stack Compose Blueprint"
migrate_file "start-appraisal-local-dev.sh" "start-appraisal-local-dev.sh" "Appraisal Hot-Reloader Bootstrapper"
migrate_file "start-local-dev.sh" "start-local-dev.sh" "Income Hot-Reloader Bootstrapper"
migrate_file "run-all-encompass-mocks.sh" "run-all-encompass-mocks.sh" "Encompass Integration Test Suite Runner"

echo -e "\n${CYAN}[8/8] Migrating Utility Tools & CI/CD Pipelines...${NC}"
migrate_file "db-backup.sh" "scripts/db-backup.sh" "Database Snapshot Utility"
migrate_file "aws-fargate-deploy.yml" ".github/workflows/aws-fargate-deploy.yml" "GitHub Actions OIDC Multi-Container Rollout"
migrate_file "Dockerfile-web" "apps/web/Dockerfile" "Optimized Multi-Stage Standalone Web Image"

chmod +x start-appraisal-local-dev.sh \
         start-local-dev.sh \
         run-all-encompass-mocks.sh \
         scripts/db-backup.sh 2>/dev/null || true

echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}MIGRATION COMPLETE: ${MIGRATED_COUNT} production assets mapped.${NC}"
if [ ${SKIPPED_PROTECTED} -gt 0 ]; then
    echo -e "${YELLOW}Protected live parser paths skipped: ${SKIPPED_PROTECTED}${NC}"
fi
if [ ${WARNING_COUNT} -gt 0 ]; then
    echo -e "${YELLOW}Notice: ${WARNING_COUNT} optional helper files were not in Docs/ or Downloads.${NC}"
fi
echo -e "${BLUE}======================================================================${NC}"
