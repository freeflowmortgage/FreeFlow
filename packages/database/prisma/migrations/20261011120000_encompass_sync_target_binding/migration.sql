ALTER TABLE "encompass_sync_jobs"
DROP CONSTRAINT "encompass_sync_jobs_write_preview_complete",
ADD COLUMN "writeTargetIntegrationMode" "EncompassIntegrationMode",
ADD COLUMN "writeTargetLenderId" VARCHAR(255),
ADD COLUMN "writeTargetDeploymentId" VARCHAR(255),
ADD COLUMN "writeTargetEncompassGuid" VARCHAR(255);

-- Existing v1 rows cannot prove their destination and intentionally remain
-- targetless. The worker accepts only complete v2 rows, so legacy work fails
-- closed instead of being redirected through a later tenant binding.
ALTER TABLE "encompass_sync_jobs"
ADD CONSTRAINT "encompass_sync_jobs_write_preview_complete" CHECK (
  (
    "writePreviewSchemaVersion" IS NULL
    AND "writePreviewHash" IS NULL
    AND "writePreviewFields" IS NULL
    AND "writeTargetIntegrationMode" IS NULL
    AND "writeTargetLenderId" IS NULL
    AND "writeTargetDeploymentId" IS NULL
    AND "writeTargetEncompassGuid" IS NULL
  )
  OR
  (
    "writePreviewSchemaVersion" IS NOT NULL
    AND "writePreviewHash" IS NOT NULL
    AND "writePreviewFields" IS NOT NULL
    AND "writePreviewSchemaVersion" = 'encompass-write-preview-v1'
    AND "writePreviewHash" ~ '^[0-9a-f]{64}$'
    AND CASE
      WHEN jsonb_typeof("writePreviewFields") = 'array'
      THEN jsonb_array_length("writePreviewFields") BETWEEN 1 AND 32
      ELSE false
    END
    AND "writeTargetIntegrationMode" IS NULL
    AND "writeTargetLenderId" IS NULL
    AND "writeTargetDeploymentId" IS NULL
    AND "writeTargetEncompassGuid" IS NULL
  )
  OR
  (
    "writePreviewSchemaVersion" IS NOT NULL
    AND "writePreviewHash" IS NOT NULL
    AND "writePreviewFields" IS NOT NULL
    AND "writeTargetIntegrationMode" IS NOT NULL
    AND "writeTargetLenderId" IS NOT NULL
    AND "writeTargetDeploymentId" IS NOT NULL
    AND "writeTargetEncompassGuid" IS NOT NULL
    AND "writePreviewSchemaVersion" = 'encompass-write-preview-v2'
    AND "writePreviewHash" ~ '^[0-9a-f]{64}$'
    AND CASE
      WHEN jsonb_typeof("writePreviewFields") = 'array'
      THEN jsonb_array_length("writePreviewFields") BETWEEN 1 AND 32
      ELSE false
    END
    AND "writeTargetIntegrationMode" = 'CUSTOM_CONNECTOR'
    AND length(btrim("writeTargetLenderId")) BETWEEN 1 AND 255
    AND length(btrim("writeTargetDeploymentId")) BETWEEN 1 AND 255
    AND length(btrim("writeTargetEncompassGuid")) BETWEEN 1 AND 255
    AND "writeTargetLenderId" = btrim("writeTargetLenderId")
    AND "writeTargetDeploymentId" = btrim("writeTargetDeploymentId")
    AND "writeTargetEncompassGuid" = btrim("writeTargetEncompassGuid")
  )
);

COMMENT ON COLUMN "encompass_sync_jobs"."writeTargetIntegrationMode" IS
  'Exact CUSTOM_CONNECTOR loan mode bound into the reviewer-approved v2 preview.';
COMMENT ON COLUMN "encompass_sync_jobs"."writeTargetLenderId" IS
  'Exact server-authoritative lender binding approved for this write.';
COMMENT ON COLUMN "encompass_sync_jobs"."writeTargetDeploymentId" IS
  'Exact server-authoritative connector deployment approved for this write.';
COMMENT ON COLUMN "encompass_sync_jobs"."writeTargetEncompassGuid" IS
  'Exact tenant-scoped Encompass loan target approved for this write.';
COMMENT ON COLUMN "encompass_sync_jobs"."writePreviewHash" IS
  'SHA-256 binding the reviewer confirmation to approval id, exact sorted field set, and v2 write target.';
