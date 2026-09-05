-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'BROKER_OWNER', 'LOAN_OFFICER', 'PROCESSOR', 'UNDERWRITER', 'BORROWER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'DOCS_UPLOADED', 'IN_QA_REVIEW', 'VERIFIED', 'EXPORTED_TO_LOS', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConditionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CLEARED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('SCHEDULE_C', 'SCHEDULE_E_PART_1', 'SCHEDULE_E_PART_2', 'FORM_1120S', 'FORM_1065', 'FORM_1120');

-- CreateEnum
CREATE TYPE "BillingTier" AS ENUM ('STANDARD', 'COMPLEX');

-- CreateEnum
CREATE TYPE "TrendingAnalysisResult" AS ENUM ('CONVENTIONAL_STABLE_OR_INCREASING', 'CONVENTIONAL_DECLINING', 'FHA_STABLE_OR_INCREASING', 'FHA_DECLINE_WARNING', 'FHA_CRITICAL_DECLINE', 'VA_STABLE_OR_INCREASING', 'VA_DECLINING', 'USDA_STABLE_OR_INCREASING', 'USDA_DECLINING', 'SINGLE_YEAR', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "HousingProgram" AS ENUM ('CONVENTIONAL', 'FHA', 'VA', 'USDA');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('SINGLE_FAMILY', 'CONDO', 'MULTI_FAMILY', 'MANUFACTURED');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('FEE_SIMPLE', 'LEASEHOLD');

-- CreateEnum
CREATE TYPE "ActionCategory" AS ENUM ('REPAIR', 'INSPECTION', 'ADMIN', 'CRITICAL_DISCREPANCY');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('CRITICAL_ERROR', 'WARNING', 'COMPLIANCE_INFO');

-- CreateEnum
CREATE TYPE "AuthoritySource" AS ENUM ('FHA_HUD_4000_1', 'VA_PAM_26_7_CH12', 'FANNIE_MAE_SEL_GUIDE', 'COMPLIANCE_GENERAL');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "companyName" VARCHAR(255) NOT NULL,
    "nmlsId" VARCHAR(50),
    "primaryContactEmail" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stripeCustomerId" VARCHAR(255),
    "isBillingActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_configurations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "enable1084Ocr" BOOLEAN NOT NULL DEFAULT true,
    "enableEncompassSync" BOOLEAN NOT NULL DEFAULT true,
    "enableUshdaValidation" BOOLEAN NOT NULL DEFAULT true,
    "enableAppraisalReview" BOOLEAN NOT NULL DEFAULT true,
    "encompassClientId" VARCHAR(255),
    "encompassInstanceId" VARCHAR(255),
    "stripeWebhookSecret" VARCHAR(255),
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "oidcSubject" VARCHAR(255),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" VARCHAR(255),
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'UNDERWRITER',
    "nmlsNumber" VARCHAR(50),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "primaryBorrowerName" VARCHAR(255) NOT NULL,
    "primaryBorrowerEmail" VARCHAR(255) NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "encompassGuid" VARCHAR(255),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_documents" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileType" VARCHAR(100) NOT NULL,
    "s3BucketKey" TEXT NOT NULL,
    "documentCategory" VARCHAR(100) NOT NULL,
    "ocrParsedPayload" JSONB,
    "ocrConfidence" DECIMAL(5,2),
    "uploadedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_diff_histories" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "fieldName" VARCHAR(100) NOT NULL,
    "rawOcrValue" TEXT NOT NULL,
    "borrowerValue" TEXT NOT NULL,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "confidenceScore" DECIMAL(5,2) NOT NULL,
    "verifiedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_diff_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_1084_audits" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL DEFAULT 'SCHEDULE_C',
    "businessName" VARCHAR(255),
    "yearsAnalyzed" INTEGER[],
    "trendingResult" "TrendingAnalysisResult" NOT NULL DEFAULT 'CONVENTIONAL_STABLE_OR_INCREASING',
    "totalAnnualCashFlow" DECIMAL(12,2) NOT NULL,
    "qualifyingMonthlyIncome" DECIMAL(12,2) NOT NULL,
    "extractedTaxFields" JSONB NOT NULL,
    "manualFieldOverrides" JSONB,
    "quickRatioComputed" DECIMAL(6,2),
    "passesLiquidityTest" BOOLEAN,
    "isHumanVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMPTZ,
    "verifiedByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "form_1084_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_conditions" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "status" "ConditionStatus" NOT NULL DEFAULT 'OPEN',
    "generatedByRule" VARCHAR(150),
    "requiredDocType" VARCHAR(100),
    "resolvedDocId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "loan_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_billing_ledgers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "documentHashList" TEXT[],
    "activeTier" "BillingTier" NOT NULL DEFAULT 'STANDARD',
    "amountCents" INTEGER NOT NULL,
    "stripeChargeId" VARCHAR(255),
    "isBilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_billing_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_audits" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "caseNumber" VARCHAR(100) NOT NULL,
    "intendedUse" TEXT NOT NULL,
    "highestAndBestUse" BOOLEAN NOT NULL DEFAULT true,
    "ownershipType" "OwnershipType" NOT NULL DEFAULT 'FEE_SIMPLE',
    "remainingLeaseTermYears" INTEGER,
    "loanMaturityDate" DATE NOT NULL,
    "yearBuilt" INTEGER NOT NULL,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'SINGLE_FAMILY',
    "isManufacturedHousing" BOOLEAN NOT NULL DEFAULT false,
    "hudCertificationPlatesPresent" BOOLEAN NOT NULL DEFAULT false,
    "hudDataPlatePresent" BOOLEAN NOT NULL DEFAULT false,
    "hasFoundationEngineersCertificate" BOOLEAN NOT NULL DEFAULT false,
    "atticInspected" BOOLEAN NOT NULL DEFAULT false,
    "crawlspaceInspected" BOOLEAN NOT NULL DEFAULT false,
    "utilitiesAreActive" BOOLEAN NOT NULL DEFAULT true,
    "septicWellVisualInspectionNoted" BOOLEAN NOT NULL DEFAULT true,
    "peelingPaintDetected" BOOLEAN NOT NULL DEFAULT false,
    "termiteActiveInfestationDetected" BOOLEAN NOT NULL DEFAULT false,
    "wellWaterPotabilityTestCleared" BOOLEAN,
    "neighborhoodTrend" VARCHAR(50) NOT NULL,
    "mcMedianPriceCurrentQuarter" DECIMAL(12,2) NOT NULL,
    "mcMedianPricePriorYearQuarter" DECIMAL(12,2) NOT NULL,
    "mcMonthsSupplyCurrentQuarter" DECIMAL(4,1) NOT NULL,
    "extractedCompsGrid" JSONB NOT NULL,
    "isHumanVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMPTZ,
    "verifiedByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appraisal_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_action_items" (
    "id" UUID NOT NULL,
    "appraisalAuditId" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "category" "ActionCategory" NOT NULL DEFAULT 'REPAIR',
    "severity" "RuleSeverity" NOT NULL DEFAULT 'CRITICAL_ERROR',
    "description" TEXT NOT NULL,
    "sourceAuthority" "AuthoritySource" NOT NULL DEFAULT 'FHA_HUD_4000_1',
    "coordinates" JSONB,
    "autoPrefillNovConditionText" TEXT,
    "isCleared" BOOLEAN NOT NULL DEFAULT false,
    "clearedAt" TIMESTAMPTZ,
    "clearedByUserId" UUID,
    "clearedNotes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appraisal_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripeCustomerId_key" ON "tenants"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_configurations_tenantId_key" ON "tenant_configurations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_oidcSubject_key" ON "users"("oidcSubject");

-- CreateIndex
CREATE INDEX "users_tenantId_email_idx" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "loan_applications_encompassGuid_key" ON "loan_applications"("encompassGuid");

-- CreateIndex
CREATE INDEX "loan_applications_tenantId_idx" ON "loan_applications"("tenantId");

-- CreateIndex
CREATE INDEX "form_1084_audits_loanId_entityType_idx" ON "form_1084_audits"("loanId", "entityType");

-- CreateIndex
CREATE INDEX "tenant_billing_ledgers_tenantId_idx" ON "tenant_billing_ledgers"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_billing_ledgers_loanId_idx" ON "tenant_billing_ledgers"("loanId");

-- CreateIndex
CREATE INDEX "tenant_billing_ledgers_createdAt_idx" ON "tenant_billing_ledgers"("createdAt");

-- CreateIndex
CREATE INDEX "appraisal_audits_loanId_idx" ON "appraisal_audits"("loanId");

-- CreateIndex
CREATE INDEX "appraisal_action_items_appraisalAuditId_isCleared_idx" ON "appraisal_action_items"("appraisalAuditId", "isCleared");

-- AddForeignKey
ALTER TABLE "tenant_configurations" ADD CONSTRAINT "tenant_configurations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_diff_histories" ADD CONSTRAINT "ocr_diff_histories_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_diff_histories" ADD CONSTRAINT "ocr_diff_histories_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "loan_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_1084_audits" ADD CONSTRAINT "form_1084_audits_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_1084_audits" ADD CONSTRAINT "form_1084_audits_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_conditions" ADD CONSTRAINT "loan_conditions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_billing_ledgers" ADD CONSTRAINT "tenant_billing_ledgers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_audits" ADD CONSTRAINT "appraisal_audits_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_audits" ADD CONSTRAINT "appraisal_audits_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_action_items" ADD CONSTRAINT "appraisal_action_items_appraisalAuditId_fkey" FOREIGN KEY ("appraisalAuditId") REFERENCES "appraisal_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_action_items" ADD CONSTRAINT "appraisal_action_items_clearedByUserId_fkey" FOREIGN KEY ("clearedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
