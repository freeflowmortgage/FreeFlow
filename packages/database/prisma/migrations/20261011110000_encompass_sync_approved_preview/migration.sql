ALTER TABLE "encompass_sync_jobs"
ADD COLUMN "writePreviewSchemaVersion" VARCHAR(64),
ADD COLUMN "writePreviewHash" CHAR(64),
ADD COLUMN "writePreviewFields" JSONB,
ADD CONSTRAINT "encompass_sync_jobs_write_preview_complete" CHECK (
  (
    "writePreviewSchemaVersion" IS NULL
    AND "writePreviewHash" IS NULL
    AND "writePreviewFields" IS NULL
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
  )
);

COMMENT ON COLUMN "encompass_sync_jobs"."writePreviewSchemaVersion" IS
  'Version of the immutable reviewer-confirmed Encompass write preview.';
COMMENT ON COLUMN "encompass_sync_jobs"."writePreviewHash" IS
  'SHA-256 binding the reviewer confirmation to approval id and exact sorted field set.';
COMMENT ON COLUMN "encompass_sync_jobs"."writePreviewFields" IS
  'Tenant-scoped exact approved field set consumed by the worker without recomputation; never log or queue.';
