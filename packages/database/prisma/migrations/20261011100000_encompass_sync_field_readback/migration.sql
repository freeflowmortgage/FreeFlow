ALTER TABLE "encompass_sync_jobs"
ADD COLUMN "fieldReadback" JSONB;

COMMENT ON COLUMN "encompass_sync_jobs"."fieldReadback" IS
  'Validated Encompass field status/reason codes only; no raw field values, value-derived hashes, or provider messages.';
