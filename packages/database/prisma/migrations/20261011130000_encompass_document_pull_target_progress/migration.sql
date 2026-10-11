ALTER TABLE "encompass_document_pull_jobs"
ADD COLUMN "selectionSchemaVersion" VARCHAR(64),
ADD COLUMN "selectionHash" CHAR(64),
ADD COLUMN "selectionTargetIntegrationMode" "EncompassIntegrationMode",
ADD COLUMN "selectionTargetLenderId" VARCHAR(255),
ADD COLUMN "selectionTargetDeploymentId" VARCHAR(255),
ADD COLUMN "selectionTargetEncompassGuid" VARCHAR(255),
ADD COLUMN "workingLoanVersion" INTEGER,
ADD COLUMN "processedAttachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "processedByteCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processedPageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "claimToken" UUID;

-- Existing jobs cannot prove which list operation and connector target created
-- their attachment ids. They intentionally remain targetless and the worker
-- rejects them before connector I/O.
ALTER TABLE "encompass_document_pull_jobs"
ADD CONSTRAINT "encompass_document_pull_jobs_selection_complete" CHECK (
  (
    "selectionSchemaVersion" IS NULL
    AND "selectionHash" IS NULL
    AND "selectionTargetIntegrationMode" IS NULL
    AND "selectionTargetLenderId" IS NULL
    AND "selectionTargetDeploymentId" IS NULL
    AND "selectionTargetEncompassGuid" IS NULL
    AND "workingLoanVersion" IS NULL
    AND cardinality("processedAttachmentIds") = 0
    AND "processedByteCount" = 0
    AND "processedPageCount" = 0
  )
  OR
  (
    "selectionSchemaVersion" IS NOT NULL
    AND "selectionHash" IS NOT NULL
    AND "selectionTargetIntegrationMode" IS NOT NULL
    AND "selectionTargetLenderId" IS NOT NULL
    AND "selectionTargetDeploymentId" IS NOT NULL
    AND "selectionTargetEncompassGuid" IS NOT NULL
    AND "workingLoanVersion" IS NOT NULL
    AND "selectionSchemaVersion" = 'encompass-document-pull-selection-v1'
    AND "selectionHash" ~ '^[0-9a-f]{64}$'
    AND "selectionTargetIntegrationMode" = 'CUSTOM_CONNECTOR'
    AND length(btrim("selectionTargetLenderId")) BETWEEN 1 AND 255
    AND length(btrim("selectionTargetDeploymentId")) BETWEEN 1 AND 255
    AND length(btrim("selectionTargetEncompassGuid")) BETWEEN 1 AND 255
    AND "selectionTargetLenderId" = btrim("selectionTargetLenderId")
    AND "selectionTargetDeploymentId" = btrim("selectionTargetDeploymentId")
    AND "selectionTargetEncompassGuid" = btrim("selectionTargetEncompassGuid")
    AND "workingLoanVersion" > 0
    AND cardinality("selectedAttachmentIds") BETWEEN 1 AND 20
    AND cardinality("processedAttachmentIds") <= cardinality("selectedAttachmentIds")
    AND "processedAttachmentIds" <@ "selectedAttachmentIds"
    AND "processedByteCount" BETWEEN 0 AND 83886080
    AND "processedPageCount" BETWEEN 0 AND 300
  )
);

COMMENT ON COLUMN "encompass_document_pull_jobs"."selectionHash" IS
  'SHA-256 binding tenant, loan, exact connector target, and sorted attachment ids.';
COMMENT ON COLUMN "encompass_document_pull_jobs"."workingLoanVersion" IS
  'Expected loan version after the last durably persisted attachment in this job.';
COMMENT ON COLUMN "encompass_document_pull_jobs"."processedAttachmentIds" IS
  'Durable attachment-level completion fence; contains identifiers only.';
COMMENT ON COLUMN "encompass_document_pull_jobs"."processedByteCount" IS
  'Durable aggregate byte count for completed attachments; document bytes are never stored.';
COMMENT ON COLUMN "encompass_document_pull_jobs"."processedPageCount" IS
  'Durable aggregate page count for completed attachments.';
COMMENT ON COLUMN "encompass_document_pull_jobs"."claimToken" IS
  'Per-attempt fencing token. A stale worker cannot persist progress or terminal state.';

CREATE OR REPLACE FUNCTION app.enforce_document_pull_job_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW."loanId" IS DISTINCT FROM OLD."loanId"
    OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId"
    OR NEW."expectedLoanVersion" IS DISTINCT FROM OLD."expectedLoanVersion"
    OR NEW."selectedAttachmentIds" IS DISTINCT FROM OLD."selectedAttachmentIds"
    OR NEW."selectionSchemaVersion" IS DISTINCT FROM OLD."selectionSchemaVersion"
    OR NEW."selectionHash" IS DISTINCT FROM OLD."selectionHash"
    OR NEW."selectionTargetIntegrationMode" IS DISTINCT FROM OLD."selectionTargetIntegrationMode"
    OR NEW."selectionTargetLenderId" IS DISTINCT FROM OLD."selectionTargetLenderId"
    OR NEW."selectionTargetDeploymentId" IS DISTINCT FROM OLD."selectionTargetDeploymentId"
    OR NEW."selectionTargetEncompassGuid" IS DISTINCT FROM OLD."selectionTargetEncompassGuid"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
  THEN
    RAISE EXCEPTION 'encompass document pull job identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF pg_has_role(current_user, 'freeflow_app', 'USAGE')
    AND NOT pg_has_role(current_user, 'freeflow_worker', 'USAGE')
    AND (
      OLD."status" <> 'QUEUED'
      OR NEW."status" <> 'RETRYABLE_FAILURE'
      OR NEW."safeErrorCode" IS DISTINCT FROM 'QUEUE_PUBLISH_FAILED'
    )
  THEN
    RAISE EXCEPTION 'application role may only record a document queue publication failure'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION app.enforce_document_pull_job_identity_immutable() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.enforce_document_pull_job_identity_immutable() FROM PUBLIC;

CREATE TRIGGER encompass_document_pull_job_identity_immutable
BEFORE UPDATE ON "encompass_document_pull_jobs"
FOR EACH ROW EXECUTE FUNCTION app.enforce_document_pull_job_identity_immutable();

-- The application creates jobs and may record only queue publication failure.
-- Durable claim, progress, and terminal state belong exclusively to the worker.
REVOKE UPDATE ON "encompass_document_pull_jobs" FROM freeflow_app, freeflow_worker;
GRANT UPDATE ("status", "safeErrorCode", "updatedAt")
  ON "encompass_document_pull_jobs" TO freeflow_app;
GRANT UPDATE (
  "status", "attemptCount", "safeErrorCode", "attachmentCount", "processedCount",
  "workingLoanVersion", "processedAttachmentIds", "processedByteCount", "processedPageCount", "claimToken",
  "startedAt", "completedAt", "updatedAt"
) ON "encompass_document_pull_jobs" TO freeflow_worker;

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_allowed";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_allowed" CHECK ("action" IN (
  'STANDALONE_LOAN_CREATED',
  'INCOME_CALCULATION_COMPLETED', 'INCOME_APPROVED', 'INCOME_OVERRIDE',
  'ENCOMPASS_DOCUMENT_PULL_QUEUED', 'ENCOMPASS_DOCUMENT_PULL_SUCCEEDED', 'ENCOMPASS_DOCUMENT_PULL_FAILED',
  'ENCOMPASS_SYNC_QUEUED', 'ENCOMPASS_SYNC_SUCCEEDED', 'ENCOMPASS_SYNC_FAILED',
  'EXTRACTION_METADATA_REVIEWED', 'ENCOMPASS_HOST_WRITE_AUTHORIZED',
  'ENCOMPASS_HOST_WRITE_SUCCEEDED', 'ENCOMPASS_HOST_WRITE_FAILED'
));
