CREATE TYPE "EncompassSyncStatus" AS ENUM (
  'QUEUED',
  'IN_PROGRESS',
  'RECONCILING',
  'SUCCEEDED',
  'RETRYABLE_FAILURE',
  'FAILED'
);

ALTER TABLE "encompass_document_pull_jobs"
  ADD COLUMN "selectedAttachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD CONSTRAINT "encompass_document_pull_selected_attachments_present"
    CHECK (cardinality("selectedAttachmentIds") BETWEEN 0 AND 20);

ALTER TABLE "loan_documents"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "loan_documents_version_positive" CHECK ("version" > 0);

ALTER TABLE "form_1084_audits"
  ADD COLUMN "canonicalInputHash" CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN "calculatedLoanVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sourceDocumentHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mortgageRuleVersion" VARCHAR(100) NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN "w2BaseMonthly" DECIMAL(12, 2),
  ADD COLUMN "w2VariableMonthly" DECIMAL(12, 2),
  ADD COLUMN "scheduleCMonthlyTotal" DECIMAL(12, 2),
  ADD COLUMN "scheduleFMonthlyTotal" DECIMAL(12, 2),
  ADD COLUMN "form1120SMonthlyTotal" DECIMAL(12, 2),
  ADD COLUMN "form1065MonthlyTotal" DECIMAL(12, 2),
  ADD COLUMN "form1120MonthlyTotal" DECIMAL(12, 2),
  ADD COLUMN "assetIncomeMonthly" DECIMAL(12, 2),
  ADD COLUMN "rentalMonthly" DECIMAL(12, 2),
  ADD COLUMN "rentalLiabilityMonthly" DECIMAL(12, 2),
  ADD COLUMN "housingExpenseAdjustment" DECIMAL(12, 2),
  ADD CONSTRAINT "form_1084_audits_canonical_input_hash_format"
    CHECK ("canonicalInputHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "form_1084_audits_calculated_loan_version_positive"
    CHECK ("calculatedLoanVersion" > 0),
  ADD CONSTRAINT "form_1084_audits_source_hashes_format"
    CHECK (
      cardinality("sourceDocumentHashes") = 0
      OR array_to_string("sourceDocumentHashes", ',') ~ '^([0-9a-f]{64})(,[0-9a-f]{64})*$'
    );

CREATE UNIQUE INDEX "form_1084_audits_tenant_loan_id_key"
  ON "form_1084_audits"("tenantId", "loanId", "id");
CREATE UNIQUE INDEX "audit_events_tenant_id_key"
  ON "audit_events"("tenantId", "id");

CREATE TABLE "encompass_sync_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "approvalEventId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "expectedLoanVersion" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "correlationId" VARCHAR(100) NOT NULL,
  "status" "EncompassSyncStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "reconciliationCount" INTEGER NOT NULL DEFAULT 0,
  "safeErrorCode" VARCHAR(100),
  "providerRevision" VARCHAR(100),
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "encompass_sync_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "encompass_sync_jobs_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_sync_jobs_loan_fkey"
    FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_sync_jobs_approval_fkey"
    FOREIGN KEY ("tenantId", "approvalEventId") REFERENCES "audit_events"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_sync_jobs_requester_fkey"
    FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_sync_jobs_expected_version_positive" CHECK ("expectedLoanVersion" > 0),
  CONSTRAINT "encompass_sync_jobs_attempts_nonnegative" CHECK ("attemptCount" >= 0 AND "reconciliationCount" >= 0),
  CONSTRAINT "encompass_sync_jobs_idempotency_key_format"
    CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._~-]{16,128}$'),
  CONSTRAINT "encompass_sync_jobs_correlation_id_format"
    CHECK ("correlationId" ~ '^[A-Za-z0-9._:-]{1,100}$'),
  CONSTRAINT "encompass_sync_jobs_safe_error_code_format"
    CHECK ("safeErrorCode" IS NULL OR "safeErrorCode" ~ '^[A-Z0-9_]{1,100}$')
);

CREATE UNIQUE INDEX "encompass_sync_jobs_tenant_id_key"
  ON "encompass_sync_jobs"("tenantId", "id");
CREATE UNIQUE INDEX "encompass_sync_jobs_tenant_idempotency_key"
  ON "encompass_sync_jobs"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "encompass_sync_jobs_tenant_approval_key"
  ON "encompass_sync_jobs"("tenantId", "approvalEventId");
CREATE INDEX "encompass_sync_jobs_tenant_loan_created_idx"
  ON "encompass_sync_jobs"("tenantId", "loanId", "createdAt");
CREATE INDEX "encompass_sync_jobs_status_updated_idx"
  ON "encompass_sync_jobs"("status", "updatedAt");

ALTER TABLE "encompass_sync_jobs" OWNER TO freeflow_owner;
ALTER TABLE "encompass_sync_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encompass_sync_jobs" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "encompass_sync_jobs"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));

REVOKE ALL ON "encompass_sync_jobs" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "encompass_sync_jobs" TO freeflow_app;
GRANT SELECT, INSERT, UPDATE ON "encompass_sync_jobs" TO freeflow_worker;
GRANT INSERT ON "audit_events" TO freeflow_worker;

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_allowed";
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_action_allowed"
  CHECK ("action" IN (
    'INCOME_CALCULATION_COMPLETED',
    'INCOME_APPROVED',
    'INCOME_OVERRIDE',
    'ENCOMPASS_DOCUMENT_PULL_QUEUED',
    'ENCOMPASS_SYNC_QUEUED',
    'ENCOMPASS_SYNC_SUCCEEDED',
    'ENCOMPASS_SYNC_FAILED'
  ));
