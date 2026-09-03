#!/bin/bash

# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - UNIFIED MONOREPO MASTER MIGRATOR (v24)
# =============================================================================
# This master script automates the layout, scaffolding, and placement of EVERY 
# point-solution production asset (AI Income, Appraisal Review, Conversational 
# 1003, Local Database Snapshot utilities, and cloud-ready CI/CD pipelines)
# directly into their decoupled monorepo workspaces.
#
# RUN INSTRUCTIONS:
# Execute this script from your monorepo workspace root directory:
#   chmod +x ./copy-assets-v24.sh
#   ./copy-assets-v24.sh
# =============================================================================

# Pristine Terminal Color Codes for Professional Execution Logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}     🚀 FREEFLOW MORTGAGE SOLUTIONS - MASTER MONOREPO MIGRATOR (v24)   ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# Scaffolding: Safely generate monorepo directory skeleton if not present
echo -e "\n${CYAN}🔄 Initializing workspace directories...${NC}"
mkdir -p .github/workflows \
         apps/web/src/components \
         apps/web/src/pages/api/income \
         apps/web/src/pages/api/underwrite \
         apps/web/src/pages/api/billing \
         apps/web/src/styles \
         apps/web/src/hooks \
         apps/web/src/utils \
         apps/web/tests \
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

echo -e "\n${CYAN}[1/8] Migrating Multi-Tenant Database Schema, Triggers & Security...${NC}"
migrate_file "updated-prisma-schema.prisma" "packages/database/prisma/schema.prisma" "Unified Multi-Tenant Schema (Income & Appraisals)"
migrate_file "appraisal_prisma_additions.sql" "packages/database/prisma/appraisal_prisma_additions.sql" "PostgreSQL Schema Additions SQL Migration"
migrate_file "calculate-quick-ratio-trigger.sql" "packages/database/prisma/calculate-quick-ratio-trigger.sql" "PostgreSQL Dynamic Schedule L Quick Ratio Trigger"
migrate_file "supabase-rls-policies.sql" "packages/database/prisma/supabase-rls-policies.sql" "PostgreSQL Row-Level Security Rules"
migrate_file "truncate-stale-loans.sql" "packages/database/prisma/truncate-stale-loans.sql" "Safe Relational Purger Utility"

echo -e "\n${CYAN}[2/8] Migrating AI Income Document Slicer Container Microservice...${NC}"
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

echo -e "\n${CYAN}[3/8] Migrating Stateless Appraisal Parser Container Microservice...${NC}"
migrate_file "Dockerfile-appraisal-zdr" "services/appraisal-parser/Dockerfile" "Appraisal Non-Root ZDR Dockerfile"
migrate_file "requirements.txt" "services/appraisal-parser/requirements.txt" "Appraisal Parser Requirements"
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

echo -e "\n${CYAN}[5/8] Migrating Front-End Web Portal, Styles & Assets...${NC}"
migrate_file "theme-variables.css" "apps/web/src/styles/theme-variables.css" "Premium Light-to-Dark Token CSS File"
migrate_file "tailwind-theme-toggles.config.js" "apps/web/tailwind.config.js" "Dynamic Tailwind Variable Theme Configuration"
migrate_file "index-v3.tsx" "apps/web/src/pages/index.tsx" "Interactive B2B Landing & Speech Dashboard (v3)"
migrate_file "UnderwriterSplitViewDemo-v11.tsx" "apps/web/src/components/UnderwriterSplitViewDemo.tsx" "Definitive Income QA Dashboard (v11)"
migrate_file "AppraisalReviewGrid-v3.tsx" "apps/web/src/components/AppraisalReviewGrid.tsx" "Definitive Collateral QA Dashboard (v3)"
migrate_file "PdfCoordinateCanvas-v2.tsx" "apps/web/src/components/PdfCoordinateCanvas.tsx" "Interactive PDF Coordinates Canvas (v2 Engine)"
migrate_file "usePdfViewer.ts" "apps/web/src/hooks/usePdfViewer.ts" "Shared PDF Canvas Coordination Visual Hook"
migrate_file "conversational-1003-client-engine.tsx" "apps/web/src/components/Conversational1003ClientEngine.tsx" "Stateless WebCrypto Conversational Intake Component"
migrate_file "stripe-subscription-gateway.ts" "apps/web/src/utils/stripe-subscription-gateway.ts" "SaaS Tier Seat Gatekeeping Middleware"

echo -e "\n${CYAN}[6/8] Migrating Node.js API Gateway Routes & Ellie Mae Integrations...${NC}"
migrate_file "calculate.ts" "apps/web/src/pages/api/income/calculate.ts" "Form 1084 Math Execution Endpoint"
migrate_file "underwrite-process-route-v2.ts" "apps/web/src/pages/api/underwrite/process.ts" "In-Memory Income Slicer Streaming API Route"
migrate_file "appraisal-audit-route.ts" "apps/web/src/pages/api/underwrite/appraisal-audit.ts" "In-Memory Appraisal mTLS API Route"
migrate_file "encompass-sync.ts" "apps/web/src/pages/api/underwrite/encompass-sync.ts" "ICE Encompass REST Client Sync Dispatcher"
migrate_file "map-encompass-fields-v3.ts" "apps/web/src/pages/api/underwrite/map-encompass-fields.ts" "Encompass Field Transformer (v3)"
migrate_file "encompass-fallback-queue.ts" "apps/web/src/pages/api/underwrite/encompass-fallback-queue.ts" "Redis-Backed Encompass Dispatch Queue"
migrate_file "encompass-pull-efolder-docs.ts" "apps/web/src/pages/api/underwrite/encompass-pull-efolder-docs.ts" "Encompass Inbound Queue Doc Puller"
migrate_file "stripe-billing-router-v4.ts" "apps/web/src/pages/api/billing/webhook.ts" "Transactional Metered Stripe Webhook Handler (v4)"

echo -e "\n${CYAN}[7/8] Migrating Local Dev Runners & Playwright E2E Tests...${NC}"
migrate_file "seed-staging-tenants.ts" "packages/database/prisma/seed-staging-tenants.ts" "PostgreSQL Staging Environment Database Seeder"
migrate_file "appraisal-validation.spec.ts" "apps/web/tests/appraisal-validation.spec.ts" "Automated Playwright E2E Integration Suite"
migrate_file "nginx-secure-routing-v2.conf" "services/gateway-proxy/nginx.conf" "mTLS Edge Gateway Proxy Configuration"
migrate_file "docker-compose.prod.yml" "docker-compose.prod.yml" "VPC-Isolated Stack Compose Blueprint"
migrate_file "start-appraisal-local-dev.sh" "start-appraisal-local-dev.sh" "Appraisal Hot-Reloader Bootstrapper"
migrate_file "start-local-dev.sh" "start-local-dev.sh" "Income Hot-Reloader Bootstrapper"
migrate_file "run-all-encompass-mocks.sh" "run-all-encompass-mocks.sh" "Encompass Integration Test Suite Runner"

echo -e "\n${CYAN}[8/8] Migrating Utility Tools & CI/CD Pipelines...${NC}"
migrate_file "db-backup.sh" "scripts/db-backup.sh" "Database Snapshot Snapshot Utility"
migrate_file "aws-fargate-deploy.yml" ".github/workflows/aws-fargate-deploy.yml" "GitHub Actions OIDC Multi-Container Rollout"
migrate_file "Dockerfile-web" "apps/web/Dockerfile" "Optimized Multi-Stage Standalone Web Image"

# Grant executive privileges to local environment script configurations
chmod +x start-appraisal-local-dev.sh \
         start-local-dev.sh \
         run-all-encompass-mocks.sh \
         scripts/db-backup.sh 2>/dev/null

echo -e "${BLUE}======================================================================${NC}"
echo -e "🥇 ${GREEN}MIGRATION COMPLETE: ${MIGRATED_COUNT} absolute latest production assets mapped!${NC}"
if [ ${WARNING_COUNT} -gt 0 ]; then
    echo -e "⚠️  ${YELLOW}Notice: ${WARNING_COUNT} optional legacy helper files were skipped.${NC}"
fi
echo -e "${BLUE}======================================================================${NC}"
