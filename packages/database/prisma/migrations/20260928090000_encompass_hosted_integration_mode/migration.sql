-- Hosted is opt-in. Existing tenants remain NONE and therefore cannot
-- accidentally activate an external connector or hosted write path.
CREATE TYPE "EncompassIntegrationMode" AS ENUM ('ENCOMPASS_HOSTED', 'DEVELOPER_CONNECT', 'NONE');
CREATE TYPE "EncompassHostWriteStatus" AS ENUM ('AUTHORIZED', 'SUCCEEDED', 'FAILED');
ALTER TABLE "tenant_configurations"
  ADD COLUMN "encompassIntegrationMode" "EncompassIntegrationMode" NOT NULL DEFAULT 'NONE';

-- A loan row is the tenant-scoped workflow identity. Borrower identity is a
-- later, authoritative application concern and is not required for host bind.
ALTER TABLE "loan_applications"
  ALTER COLUMN "primaryBorrowerName" DROP NOT NULL,
  ALTER COLUMN "primaryBorrowerEmail" DROP NOT NULL,
  ADD COLUMN "encompassIntegrationMode" "EncompassIntegrationMode" NOT NULL DEFAULT 'NONE';

CREATE TABLE "encompass_host_writes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "approvalEventId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "expectedLoanVersion" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "correlationId" VARCHAR(100) NOT NULL,
  "fieldMapHash" CHAR(64) NOT NULL,
  "status" "EncompassHostWriteStatus" NOT NULL DEFAULT 'AUTHORIZED',
  "safeErrorCode" VARCHAR(100),
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "encompass_host_writes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "encompass_host_writes_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_host_writes_loan_fkey" FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_host_writes_approval_fkey" FOREIGN KEY ("tenantId", "approvalEventId") REFERENCES "audit_events"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_host_writes_requester_fkey" FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encompass_host_writes_expected_version_positive" CHECK ("expectedLoanVersion" > 0),
  CONSTRAINT "encompass_host_writes_idempotency_key_format" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._~-]{16,128}$'),
  CONSTRAINT "encompass_host_writes_correlation_id_format" CHECK ("correlationId" ~ '^[A-Za-z0-9._:-]{1,100}$'),
  CONSTRAINT "encompass_host_writes_field_map_hash_format" CHECK ("fieldMapHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "encompass_host_writes_safe_error_code_format" CHECK ("safeErrorCode" IS NULL OR "safeErrorCode" ~ '^[A-Z0-9_]{1,100}$')
);

CREATE UNIQUE INDEX "encompass_host_writes_tenant_id_key" ON "encompass_host_writes"("tenantId", "id");
CREATE UNIQUE INDEX "encompass_host_writes_tenant_idempotency_key" ON "encompass_host_writes"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "encompass_host_writes_tenant_approval_key" ON "encompass_host_writes"("tenantId", "approvalEventId");
CREATE INDEX "encompass_host_writes_tenant_loan_created_idx" ON "encompass_host_writes"("tenantId", "loanId", "createdAt");

ALTER TABLE "encompass_host_writes" OWNER TO freeflow_owner;
ALTER TABLE "encompass_host_writes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encompass_host_writes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "encompass_host_writes"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));
REVOKE ALL ON "encompass_host_writes" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "encompass_host_writes" TO freeflow_app;

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_allowed";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_allowed" CHECK ("action" IN (
  'INCOME_CALCULATION_COMPLETED', 'INCOME_APPROVED', 'INCOME_OVERRIDE',
  'ENCOMPASS_DOCUMENT_PULL_QUEUED', 'ENCOMPASS_SYNC_QUEUED',
  'ENCOMPASS_SYNC_SUCCEEDED', 'ENCOMPASS_SYNC_FAILED',
  'EXTRACTION_METADATA_REVIEWED', 'ENCOMPASS_HOST_WRITE_AUTHORIZED',
  'ENCOMPASS_HOST_WRITE_SUCCEEDED', 'ENCOMPASS_HOST_WRITE_FAILED'
));

-- Existing tenant and loan policies remain authoritative. The hosted-write
-- ledger has its own forced tenant policy and least-privilege grants above.
