CREATE TYPE "IncomeMetadataReviewSource" AS ENUM (
  'DOCUMENT_VISUAL_REVIEW',
  'ENCOMPASS_VERIFIED_METADATA',
  'WORKFLOW_VERIFIED_METADATA'
);

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_allowed";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_allowed" CHECK ("action" IN (
  'INCOME_CALCULATION_COMPLETED', 'INCOME_APPROVED', 'INCOME_OVERRIDE',
  'ENCOMPASS_DOCUMENT_PULL_QUEUED', 'ENCOMPASS_SYNC_QUEUED', 'ENCOMPASS_SYNC_SUCCEEDED', 'ENCOMPASS_SYNC_FAILED',
  'EXTRACTION_METADATA_REVIEWED'
));

CREATE TABLE "income_extraction_metadata_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "extractionId" UUID NOT NULL,
  "sourceDocumentId" UUID NOT NULL,
  "sourceDocumentVersion" INTEGER NOT NULL,
  "sourceContentHash" CHAR(64) NOT NULL,
  "extractionHash" CHAR(64) NOT NULL,
  "metadataVersion" INTEGER NOT NULL,
  "assignments" JSONB NOT NULL,
  "source" "IncomeMetadataReviewSource" NOT NULL,
  "reasonCode" VARCHAR(100) NOT NULL,
  "reasonNarrative" VARCHAR(500),
  "reviewedByUserId" UUID NOT NULL,
  "canonicalHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "income_extraction_metadata_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "income_metadata_reviews_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_metadata_reviews_loan_fkey" FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_metadata_reviews_extraction_fkey" FOREIGN KEY ("tenantId", "loanId", "extractionId") REFERENCES "income_extractions"("tenantId", "loanId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_metadata_reviews_document_fkey" FOREIGN KEY ("tenantId", "loanId", "sourceDocumentId") REFERENCES "loan_documents"("tenantId", "loanId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_metadata_reviews_user_fkey" FOREIGN KEY ("tenantId", "reviewedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_metadata_reviews_version_positive" CHECK ("metadataVersion" > 0 AND "sourceDocumentVersion" > 0),
  CONSTRAINT "income_metadata_reviews_hash_format" CHECK (
    "sourceContentHash" ~ '^[0-9a-f]{64}$' AND "extractionHash" ~ '^[0-9a-f]{64}$' AND "canonicalHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "income_metadata_reviews_assignments_array" CHECK (jsonb_typeof("assignments") = 'array')
);

CREATE UNIQUE INDEX "income_metadata_reviews_tenant_loan_id_key" ON "income_extraction_metadata_reviews"("tenantId", "loanId", "id");
CREATE UNIQUE INDEX "income_metadata_reviews_extraction_version_key" ON "income_extraction_metadata_reviews"("tenantId", "extractionId", "metadataVersion");
CREATE INDEX "income_metadata_reviews_tenant_loan_extraction_version_idx" ON "income_extraction_metadata_reviews"("tenantId", "loanId", "extractionId", "metadataVersion");

ALTER TABLE "income_calculation_extractions"
  ADD COLUMN "metadataReviewId" UUID,
  ADD COLUMN "metadataReviewVersion" INTEGER,
  ADD COLUMN "metadataReviewHash" CHAR(64),
  ADD CONSTRAINT "income_calculation_extractions_metadata_review_fkey"
    FOREIGN KEY ("tenantId", "loanId", "metadataReviewId") REFERENCES "income_extraction_metadata_reviews"("tenantId", "loanId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "income_calculation_extractions_metadata_complete" CHECK (
    ("metadataReviewId" IS NULL AND "metadataReviewVersion" IS NULL AND "metadataReviewHash" IS NULL)
    OR ("metadataReviewId" IS NOT NULL AND "metadataReviewVersion" IS NOT NULL AND "metadataReviewHash" IS NOT NULL)
  ),
  ADD CONSTRAINT "income_calculation_extractions_metadata_hash_format" CHECK ("metadataReviewHash" IS NULL OR "metadataReviewHash" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION app.reject_income_metadata_review_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION 'income extraction metadata reviews are append-only' USING ERRCODE = '55000';
END
$function$;
ALTER FUNCTION app.reject_income_metadata_review_mutation() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.reject_income_metadata_review_mutation() FROM PUBLIC;
CREATE TRIGGER income_metadata_reviews_reject_mutation
  BEFORE UPDATE OR DELETE ON "income_extraction_metadata_reviews"
  FOR EACH ROW EXECUTE FUNCTION app.reject_income_metadata_review_mutation();

CREATE OR REPLACE FUNCTION app.validate_income_metadata_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  PERFORM 1
  FROM public.income_extractions extraction
  JOIN public.loan_documents document
    ON document."tenantId" = extraction."tenantId" AND document."loanId" = extraction."loanId" AND document."id" = extraction."sourceDocumentId"
  WHERE extraction."tenantId" = NEW."tenantId" AND extraction."loanId" = NEW."loanId" AND extraction."id" = NEW."extractionId"
    AND extraction."status" = 'ACTIVE' AND extraction."canonicalHash" = NEW."extractionHash"
    AND extraction."sourceDocumentId" = NEW."sourceDocumentId" AND extraction."sourceDocumentVersion" = NEW."sourceDocumentVersion"
    AND extraction."sourceContentHash" = NEW."sourceContentHash"
    AND document."version" = NEW."sourceDocumentVersion" AND document."sourceContentHash" = NEW."sourceContentHash"
    AND document."sourceAttachmentId" = extraction."sourceAttachmentId"
  FOR SHARE OF extraction, document;
  IF NOT FOUND THEN RAISE EXCEPTION 'metadata review source is stale or invalid' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$function$;
ALTER FUNCTION app.validate_income_metadata_review() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.validate_income_metadata_review() FROM PUBLIC;
CREATE TRIGGER income_metadata_reviews_validate_insert
  BEFORE INSERT ON "income_extraction_metadata_reviews"
  FOR EACH ROW EXECUTE FUNCTION app.validate_income_metadata_review();

CREATE OR REPLACE FUNCTION app.validate_income_calculation_extraction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  PERFORM 1 FROM public.income_extractions extraction
  JOIN public.loan_documents document ON document."tenantId" = extraction."tenantId" AND document."loanId" = extraction."loanId" AND document."id" = extraction."sourceDocumentId"
  WHERE extraction."tenantId" = NEW."tenantId" AND extraction."loanId" = NEW."loanId" AND extraction."id" = NEW."extractionId"
    AND extraction."status" = 'ACTIVE' AND extraction."canonicalHash" = NEW."extractionHash"
    AND extraction."sourceDocumentId" = NEW."sourceDocumentId" AND extraction."sourceDocumentVersion" = NEW."sourceDocumentVersion"
    AND extraction."sourceContentHash" = NEW."sourceContentHash" AND document."version" = extraction."sourceDocumentVersion"
    AND document."sourceContentHash" = extraction."sourceContentHash" AND document."sourceAttachmentId" = extraction."sourceAttachmentId"
  FOR SHARE OF extraction, document;
  IF NOT FOUND THEN RAISE EXCEPTION 'calculation extraction provenance is stale or invalid' USING ERRCODE = '23514'; END IF;
  IF NEW."metadataReviewId" IS NOT NULL THEN
    PERFORM 1 FROM public.income_extraction_metadata_reviews review
    WHERE review."tenantId" = NEW."tenantId" AND review."loanId" = NEW."loanId" AND review."id" = NEW."metadataReviewId"
      AND review."extractionId" = NEW."extractionId" AND review."metadataVersion" = NEW."metadataReviewVersion"
      AND review."canonicalHash" = NEW."metadataReviewHash"
      AND NOT EXISTS (SELECT 1 FROM public.income_extraction_metadata_reviews newer WHERE newer."tenantId" = review."tenantId" AND newer."extractionId" = review."extractionId" AND newer."metadataVersion" > review."metadataVersion")
    FOR SHARE OF review;
    IF NOT FOUND THEN RAISE EXCEPTION 'calculation metadata provenance is stale or invalid' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END
$function$;

ALTER TABLE "income_extraction_metadata_reviews" OWNER TO freeflow_owner;
ALTER TABLE "income_extraction_metadata_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_extraction_metadata_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "income_extraction_metadata_reviews"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id')) WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));
REVOKE ALL ON "income_extraction_metadata_reviews" FROM PUBLIC;
GRANT SELECT, INSERT ON "income_extraction_metadata_reviews" TO freeflow_app;
GRANT SELECT ON "income_extraction_metadata_reviews" TO freeflow_worker;
