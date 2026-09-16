CREATE TYPE "EncompassDocumentPullStatus" AS ENUM (
  'QUEUED',
  'IN_PROGRESS',
  'SUCCEEDED',
  'RETRYABLE_FAILURE',
  'FAILED'
);

ALTER TABLE "tenant_configurations"
  ALTER COLUMN "enableEncompassSync" SET DEFAULT false,
  ADD COLUMN "enableEncompassDocumentPull" BOOLEAN NOT NULL DEFAULT false;

-- Existing tenants must opt back into Encompass writes after their production
-- credentials and worker are qualified.
UPDATE "tenant_configurations" SET "enableEncompassSync" = false;

CREATE TABLE "encompass_document_pull_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "expectedLoanVersion" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "correlationId" VARCHAR(100) NOT NULL,
  "status" "EncompassDocumentPullStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "safeErrorCode" VARCHAR(100),
  "attachmentCount" INTEGER,
  "processedCount" INTEGER,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "encompass_document_pull_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "encompass_document_pull_jobs_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_document_pull_jobs_loan_fkey"
    FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_document_pull_jobs_requester_fkey"
    FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_document_pull_jobs_expected_version_positive"
    CHECK ("expectedLoanVersion" > 0),
  CONSTRAINT "encompass_document_pull_jobs_attempt_count_nonnegative"
    CHECK ("attemptCount" >= 0),
  CONSTRAINT "encompass_document_pull_jobs_counts_nonnegative"
    CHECK (("attachmentCount" IS NULL OR "attachmentCount" >= 0)
      AND ("processedCount" IS NULL OR "processedCount" >= 0)),
  CONSTRAINT "encompass_document_pull_jobs_idempotency_key_format"
    CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._~-]{16,128}$'),
  CONSTRAINT "encompass_document_pull_jobs_correlation_id_format"
    CHECK ("correlationId" ~ '^[A-Za-z0-9._:-]{1,100}$'),
  CONSTRAINT "encompass_document_pull_jobs_safe_error_code_format"
    CHECK ("safeErrorCode" IS NULL OR "safeErrorCode" ~ '^[A-Z0-9_]{1,100}$')
);

CREATE UNIQUE INDEX "encompass_document_pull_jobs_tenant_id_key"
  ON "encompass_document_pull_jobs"("tenantId", "id");
CREATE UNIQUE INDEX "encompass_document_pull_jobs_tenant_idempotency_key"
  ON "encompass_document_pull_jobs"("tenantId", "idempotencyKey");
CREATE INDEX "encompass_document_pull_jobs_tenant_loan_created_idx"
  ON "encompass_document_pull_jobs"("tenantId", "loanId", "createdAt");
CREATE INDEX "encompass_document_pull_jobs_status_created_idx"
  ON "encompass_document_pull_jobs"("status", "createdAt");

CREATE UNIQUE INDEX "loan_documents_tenant_loan_source_attachment_key"
  ON "loan_documents"("tenantId", "loanId", "sourceAttachmentId");

ALTER TABLE "encompass_document_pull_jobs" OWNER TO freeflow_owner;
ALTER TABLE "encompass_document_pull_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encompass_document_pull_jobs" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "encompass_document_pull_jobs"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));

REVOKE ALL ON "encompass_document_pull_jobs" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "encompass_document_pull_jobs" TO freeflow_app;
GRANT SELECT, UPDATE ON "encompass_document_pull_jobs" TO freeflow_worker;
GRANT SELECT, INSERT, UPDATE ON "loan_documents" TO freeflow_worker;

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_allowed";
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_action_allowed"
  CHECK ("action" IN (
    'INCOME_CALCULATION_COMPLETED',
    'INCOME_APPROVED',
    'INCOME_OVERRIDE',
    'ENCOMPASS_DOCUMENT_PULL_QUEUED'
  ));
