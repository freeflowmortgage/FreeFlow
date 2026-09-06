-- Zero-data-retention contract.
--
-- Do not apply this destructive migration to a populated environment without
-- the approved data-disposition procedure in docs/deployment-readiness. The
-- retained values below are allowlisted metadata/hashes only; no PDF, object
-- key, OCR text, raw XML, raw request, or human-entered field value remains.

ALTER TABLE "loan_documents"
  ADD COLUMN "sourceAttachmentId" VARCHAR(255),
  ADD COLUMN "sourceContentHash" CHAR(64),
  ADD COLUMN "sourcePageCount" INTEGER,
  ADD COLUMN "parserVersion" VARCHAR(100);

ALTER TABLE "ocr_diff_histories"
  ADD COLUMN "previousValueHash" CHAR(64),
  ADD COLUMN "newValueHash" CHAR(64);

ALTER TABLE "form_1084_audits"
  ADD COLUMN "calculationSchemaVersion" VARCHAR(100) NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN "calculationSource" VARCHAR(100) NOT NULL DEFAULT 'legacy-unknown';

ALTER TABLE "loan_documents"
  ADD CONSTRAINT "loan_documents_sourceContentHash_format"
  CHECK ("sourceContentHash" IS NULL OR "sourceContentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ocr_diff_histories"
  ADD CONSTRAINT "ocr_diff_histories_previousValueHash_format"
  CHECK ("previousValueHash" IS NULL OR "previousValueHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ocr_diff_histories_newValueHash_format"
  CHECK ("newValueHash" IS NULL OR "newValueHash" ~ '^[0-9a-f]{64}$');

-- Contract phase: remove all prohibited persisted raw-content fields. Existing
-- data in these columns is deliberately not copied or transformed.
ALTER TABLE "loan_documents"
  DROP COLUMN "fileName",
  DROP COLUMN "s3BucketKey",
  DROP COLUMN "ocrParsedPayload";

ALTER TABLE "ocr_diff_histories"
  DROP COLUMN "rawOcrValue",
  DROP COLUMN "borrowerValue";

ALTER TABLE "form_1084_audits"
  DROP COLUMN "extractedTaxFields",
  DROP COLUMN "manualFieldOverrides";
