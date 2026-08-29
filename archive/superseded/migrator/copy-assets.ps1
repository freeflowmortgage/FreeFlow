# =====================================================================
#   FREEFLOW INCOME ENGINE - WINDOWS MONOREPO MIGRATION ENGINE (v2)
# =====================================================================
# This PowerShell script automates file migration from your Windows 
# Downloads directory directly to your active repository at C:\freeflow.
# Emojis and ampersands have been fully sanitized to prevent encoding
# and parsing failures on Windows shells.
# =====================================================================

$ErrorActionPreference = "Stop"

# 1. Define Paths (Auto-resolves your local Windows User Profile)
$DownloadsDir = "$env:USERPROFILE\Downloads"
$TargetDir = "C:\freeflow"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "--- Initiating Windows Monorepo Migration" -ForegroundColor Cyan
Write-Host "   Source: $DownloadsDir" -ForegroundColor Yellow
Write-Host "   Target: $TargetDir" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 2. Check if Target Directory Exists; if not, construct the layout
if (!(Test-Path -Path $TargetDir)) {
    Write-Host "--- Target C:\freeflow not found. Constructing clean folder architecture..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "$TargetDir\.github\workflows" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\apps\web\src\pages\api\underwrite" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\apps\underwriting-console\src\components" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\apps\underwriting-console\src\pages" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\packages\database\prisma" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\packages\mortgage-engine\src" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\packages\mortgage-engine\tests" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\packages\ui" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\services\doc-parser\src" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\docs" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TargetDir\nginx" | Out-Null
    Write-Host "--- Monorepo skeleton successfully built!" -ForegroundColor Green
}

# 3. Safe Migration Helper
function Copy-SystemFile {
    param (
        [string]$FileName,
        [string]$DestinationSubPath,
        [string]$Description
    )

    # Search both the base Downloads folder and any 'artifacts' sub-folder
    $SourcePath = Join-Path $DownloadsDir $FileName
    $ArtifactsPath = Join-Path (Join-Path $DownloadsDir "artifacts") $FileName
    $FinalDest = Join-Path $TargetDir $DestinationSubPath

    if (Test-Path -Path $SourcePath) {
        Copy-Item -Path $SourcePath -Destination $FinalDest -Force
        Write-Host "  * Migrated: $Description -> $DestinationSubPath" -ForegroundColor Green
    } elseif (Test-Path -Path $ArtifactsPath) {
        Copy-Item -Path $ArtifactsPath -Destination $FinalDest -Force
        Write-Host "  * Migrated (from artifacts/): $Description -> $DestinationSubPath" -ForegroundColor Green
    } else {
        Write-Host "  * Warning: Could not find '$FileName' in Downloads. Copy manually to $DestinationSubPath." -ForegroundColor Yellow
    }
}

# 4. Execute the File-to-Workspace Migration
Write-Host "`n--- Migrating System Controls and Containers..." -ForegroundColor Cyan
Copy-SystemFile "docker-compose.yml" "docker-compose.yml" "Docker Container Compose"
Copy-SystemFile "env.example" "env.example" "Environment Key Template"
Copy-SystemFile "local-bootstrap.sh" "local-bootstrap.sh" "Unix Bootstrap"
Copy-SystemFile "run-local-tests.sh" "run-local-tests.sh" "Unix Test Runner"

Write-Host "`n--- Migrating Mortgage Rules Engine (v7)..." -ForegroundColor Cyan
Copy-SystemFile "calculateForm1084Income-v7.ts" "packages/mortgage-engine/src/calculateForm1084Income.ts" "Unified Math Engine Core"
Copy-SystemFile "payload-guard.ts" "packages/mortgage-engine/src/payload-guard.ts" "FHA/USDA Model Guards"
Copy-SystemFile "usda-projected-income-engine-v2.ts" "packages/mortgage-engine/src/usda-projected-income-engine-v2.ts" "USDA Eligibility Rules"
Copy-SystemFile "usda-ssi-rules-engine.ts" "packages/mortgage-engine/src/usda-ssi-rules-engine.ts" "SSI Continuance Check"
Copy-SystemFile "fha-declining-multifamily.test.ts" "packages/mortgage-engine/tests/fha-declining-multifamily.test.ts" "FHA Multi-Family Unit Tests"
Copy-SystemFile "form1120-dividends-under-25.test.ts" "packages/mortgage-engine/tests/form1120-dividends-under-25.test.ts" "C-Corp Dividend Unit Tests"
Copy-SystemFile "mismo-d1c-mapping.test.ts" "packages/mortgage-engine/tests/mismo-d1c-mapping.test.ts" "MISMO D1C Mapping Unit Tests"

Write-Host "`n--- Migrating Python Parser and ZDR Container..." -ForegroundColor Cyan
Copy-SystemFile "Dockerfile" "services/doc-parser/Dockerfile" "Container Orchestrator"
Copy-SystemFile "requirements.txt" "services/doc-parser/requirements.txt" "Python Dependency Manifest"
Copy-SystemFile "server.py" "services/doc-parser/src/server.py" "ZDR FastAPI Server"
Copy-SystemFile "ai_pdf_converter.py" "services/doc-parser/src/ai_pdf_converter.py" "OCR Bounding Box Mapper"
Copy-SystemFile "pre_split_tax_returns-v4.py" "services/doc-parser/src/pdf_splitter.py" "Tax Slicer Engine"
Copy-SystemFile "mismo_xml_exporter.py" "services/doc-parser/src/mismo_xml_exporter.py" "MISMO XML Builder"
Copy-SystemFile "test-tmpfs-isolation.sh" "services/doc-parser/test-tmpfs-isolation.sh" "RAM Verification Utility"
Copy-SystemFile "ecs-task-definition.json" "services/doc-parser/ecs-task-definition.json" "AWS Fargate Mounting Parameters"
Copy-SystemFile "aws-deploy-automation.sh" "services/doc-parser/aws-deploy-automation.sh" "AWS Deployment Automator"

Write-Host "`n--- Migrating Multi-Tenant Database Layer..." -ForegroundColor Cyan
Copy-SystemFile "supabase-schema.prisma" "packages/database/prisma/schema.prisma" "Prisma Data Schema"
Copy-SystemFile "supabase-rls-policies.sql" "packages/database/prisma/supabase-rls-policies.sql" "SQL Row-Level Security Policies"

Write-Host "`n--- Migrating Next.js Broker Portal..." -ForegroundColor Cyan
Copy-SystemFile "calculate.ts" "apps/web/src/pages/api/income/calculate.ts" "Calculation Controller"
Copy-SystemFile "underwrite-process-route.ts" "apps/web/src/pages/api/underwrite/process.ts" "Process Endpoint"
Copy-SystemFile "encompass-sync.ts" "apps/web/src/pages/api/underwrite/encompass-sync.ts" "Encompass Connector"
Copy-SystemFile "map-encompass-fields-v2.ts" "apps/web/src/pages/api/underwrite/map-encompass-fields.ts" "XML Coordinate Mapper"
Copy-SystemFile "encompass-fallback-queue.ts" "apps/web/src/pages/api/underwrite/encompass-fallback-queue.ts" "Outage Fallback Queue"
Copy-SystemFile "encompass-pull-efolder-docs.ts" "apps/web/src/pages/api/underwrite/encompass-pull-efolder-docs.ts" "Document Intake Engine"
Copy-SystemFile "pricing-page.tsx" "apps/web/src/pages/pricing/page.tsx" "Metered Billing UI"

Write-Host "`n--- Migrating Back-Office Underwriter Console..." -ForegroundColor Cyan
Copy-SystemFile "UnderwriterSplitViewDemo-v4.tsx" "apps/underwriting-console/src/components/UnderwriterSplitView.tsx" "Visual Coordinate Viewer"
Copy-SystemFile "AuditTrailTable.tsx" "apps/underwriting-console/src/components/AuditTrailTable.tsx" "Audit Log Grid"
Copy-SystemFile "UsdaDistributionToggle.tsx" "apps/underwriting-console/src/components/UsdaDistributionToggle.tsx" "Underwriter Active Override panel"

Write-Host "`n--- Migrating Compliance and Server Documentation..." -ForegroundColor Cyan
Copy-SystemFile "deployment-and-architecture-playbook-v2.md" "docs/ARCHITECTURE.md" "Architecture Playbook"
Copy-SystemFile "pre-deployment-checklist.md" "docs/pre-deployment-checklist.md" "Pre-Deployment Checklist"
Copy-SystemFile "ZDR-Security-Whitepaper.md" "docs/ZDR-Security-Whitepaper.md" "CISO Security Whitepaper"
Copy-SystemFile "Transition-and-Onboarding-Playbook.md" "docs/Transition-and-Onboarding-Playbook.md" "Developer Onboarding Playbook"
Copy-SystemFile "Perpetual-License-Term-Sheet.md" "docs/Perpetual-License-Term-Sheet.md" "Buyout Term Sheet"
Copy-SystemFile "nginx-secure-routing.conf" "nginx/secure-routing.conf" "Nginx Reverse Proxy Config"

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "--- SUCCESS: Monorepo populated at C:\freeflow!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
