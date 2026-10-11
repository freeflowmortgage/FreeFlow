ALTER TABLE "encompass_sync_jobs"
ADD COLUMN "fieldReadback" JSONB;

COMMENT ON COLUMN "encompass_sync_jobs"."fieldReadback" IS
  'Validated Encompass field status/reason codes and expected/actual SHA-256 values only; no raw field values or provider messages.';
