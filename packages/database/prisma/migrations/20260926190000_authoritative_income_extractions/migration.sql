CREATE TYPE "IncomeExtractionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
CREATE TYPE "MortgageLoanProgram" AS ENUM ('CONVENTIONAL', 'FHA', 'VA', 'USDA');

ALTER TABLE "loan_applications"
  ADD COLUMN "loanProgram" "MortgageLoanProgram" NOT NULL DEFAULT 'CONVENTIONAL';

CREATE TABLE "income_extractions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "sourceDocumentId" UUID NOT NULL,
  "sourceAttachmentId" VARCHAR(255) NOT NULL,
  "sourceDocumentVersion" INTEGER NOT NULL,
  "sourceContentHash" CHAR(64) NOT NULL,
  "parserVersion" VARCHAR(100) NOT NULL,
  "schemaVersion" VARCHAR(100) NOT NULL,
  "normalizedInput" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "confidence" DECIMAL(5, 2),
  "canonicalHash" CHAR(64) NOT NULL,
  "status" "IncomeExtractionStatus" NOT NULL DEFAULT 'ACTIVE',
  "supersededAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "income_extractions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "income_extractions_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_extractions_loan_fkey"
    FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_extractions_document_fkey"
    FOREIGN KEY ("tenantId", "loanId", "sourceDocumentId") REFERENCES "loan_documents"("tenantId", "loanId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_extractions_source_version_positive" CHECK ("sourceDocumentVersion" > 0),
  CONSTRAINT "income_extractions_source_hash_format" CHECK ("sourceContentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "income_extractions_canonical_hash_format" CHECK ("canonicalHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "income_extractions_confidence_range" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 100),
  CONSTRAINT "income_extractions_status_time_consistent" CHECK (
    ("status" = 'ACTIVE' AND "supersededAt" IS NULL)
    OR ("status" = 'SUPERSEDED' AND "supersededAt" IS NOT NULL)
  ),
  CONSTRAINT "income_extractions_payload_object" CHECK (
    jsonb_typeof("normalizedInput") = 'object' AND jsonb_typeof("evidence") = 'object'
  )
);

CREATE UNIQUE INDEX "income_extractions_tenant_loan_id_key"
  ON "income_extractions"("tenantId", "loanId", "id");
CREATE UNIQUE INDEX "income_extractions_source_version_parser_key"
  ON "income_extractions"("tenantId", "sourceDocumentId", "sourceDocumentVersion", "parserVersion");
CREATE INDEX "income_extractions_tenant_loan_status_created_idx"
  ON "income_extractions"("tenantId", "loanId", "status", "createdAt");
CREATE INDEX "income_extractions_tenant_document_status_idx"
  ON "income_extractions"("tenantId", "sourceDocumentId", "status");

CREATE TABLE "income_calculation_extractions" (
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "calculationId" UUID NOT NULL,
  "extractionId" UUID NOT NULL,
  "extractionHash" CHAR(64) NOT NULL,
  "sourceDocumentId" UUID NOT NULL,
  "sourceDocumentVersion" INTEGER NOT NULL,
  "sourceContentHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "income_calculation_extractions_pkey" PRIMARY KEY ("tenantId", "calculationId", "extractionId"),
  CONSTRAINT "income_calculation_extractions_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_calculation_extractions_loan_fkey"
    FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_calculation_extractions_calculation_fkey"
    FOREIGN KEY ("tenantId", "loanId", "calculationId") REFERENCES "form_1084_audits"("tenantId", "loanId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_calculation_extractions_extraction_fkey"
    FOREIGN KEY ("tenantId", "loanId", "extractionId") REFERENCES "income_extractions"("tenantId", "loanId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_calculation_extractions_source_version_positive" CHECK ("sourceDocumentVersion" > 0),
  CONSTRAINT "income_calculation_extractions_hashes_format" CHECK (
    "extractionHash" ~ '^[0-9a-f]{64}$' AND "sourceContentHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX "income_calculation_extractions_tenant_loan_calculation_idx"
  ON "income_calculation_extractions"("tenantId", "loanId", "calculationId");
CREATE INDEX "income_calculation_extractions_tenant_extraction_idx"
  ON "income_calculation_extractions"("tenantId", "extractionId");

ALTER TABLE "income_extractions" OWNER TO freeflow_owner;
ALTER TABLE "income_calculation_extractions" OWNER TO freeflow_owner;
ALTER TABLE "income_extractions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_extractions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "income_calculation_extractions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_calculation_extractions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "income_extractions"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));
CREATE POLICY tenant_isolation ON "income_calculation_extractions"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));

CREATE OR REPLACE FUNCTION app.protect_income_extraction_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'income extractions are retained as calculation evidence' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'SUPERSEDED'
    AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt") THEN
    RAISE EXCEPTION 'superseded income extractions cannot be reactivated or retimed' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ACTIVE'
    AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt")
    AND NOT (NEW."status" = 'SUPERSEDED' AND NEW."supersededAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'income extraction status may only advance to superseded' USING ERRCODE = '55000';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW."loanId" IS DISTINCT FROM OLD."loanId"
    OR NEW."sourceDocumentId" IS DISTINCT FROM OLD."sourceDocumentId"
    OR NEW."sourceAttachmentId" IS DISTINCT FROM OLD."sourceAttachmentId"
    OR NEW."sourceDocumentVersion" IS DISTINCT FROM OLD."sourceDocumentVersion"
    OR NEW."sourceContentHash" IS DISTINCT FROM OLD."sourceContentHash"
    OR NEW."parserVersion" IS DISTINCT FROM OLD."parserVersion"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."normalizedInput" IS DISTINCT FROM OLD."normalizedInput"
    OR NEW."evidence" IS DISTINCT FROM OLD."evidence"
    OR NEW."warnings" IS DISTINCT FROM OLD."warnings"
    OR NEW."confidence" IS DISTINCT FROM OLD."confidence"
    OR NEW."canonicalHash" IS DISTINCT FROM OLD."canonicalHash"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'income extraction provenance is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION app.protect_income_extraction_provenance() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.protect_income_extraction_provenance() FROM PUBLIC;

CREATE TRIGGER income_extractions_protect_provenance
  BEFORE UPDATE OR DELETE ON "income_extractions"
  FOR EACH ROW EXECUTE FUNCTION app.protect_income_extraction_provenance();

CREATE OR REPLACE FUNCTION app.reject_calculation_extraction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'calculation extraction bindings are append-only' USING ERRCODE = '55000';
END
$function$;

ALTER FUNCTION app.reject_calculation_extraction_mutation() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.reject_calculation_extraction_mutation() FROM PUBLIC;

CREATE TRIGGER income_calculation_extractions_reject_mutation
  BEFORE UPDATE OR DELETE ON "income_calculation_extractions"
  FOR EACH ROW EXECUTE FUNCTION app.reject_calculation_extraction_mutation();

CREATE OR REPLACE FUNCTION app.validate_income_calculation_extraction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM 1
  FROM public.income_extractions AS extraction
  JOIN public.loan_documents AS document
    ON document."tenantId" = extraction."tenantId"
   AND document."loanId" = extraction."loanId"
   AND document."id" = extraction."sourceDocumentId"
  WHERE extraction."tenantId" = NEW."tenantId"
    AND extraction."loanId" = NEW."loanId"
    AND extraction."id" = NEW."extractionId"
    AND extraction."status" = 'ACTIVE'
    AND extraction."canonicalHash" = NEW."extractionHash"
    AND extraction."sourceDocumentId" = NEW."sourceDocumentId"
    AND extraction."sourceDocumentVersion" = NEW."sourceDocumentVersion"
    AND extraction."sourceContentHash" = NEW."sourceContentHash"
    AND document."version" = extraction."sourceDocumentVersion"
    AND document."sourceContentHash" = extraction."sourceContentHash"
    AND document."sourceAttachmentId" = extraction."sourceAttachmentId"
  FOR SHARE OF extraction, document;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calculation extraction provenance is stale or invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION app.validate_income_calculation_extraction() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.validate_income_calculation_extraction() FROM PUBLIC;

CREATE TRIGGER income_calculation_extractions_validate_insert
  BEFORE INSERT ON "income_calculation_extractions"
  FOR EACH ROW EXECUTE FUNCTION app.validate_income_calculation_extraction();

REVOKE ALL ON "income_extractions", "income_calculation_extractions" FROM PUBLIC;
GRANT SELECT ON "income_extractions" TO freeflow_app;
GRANT SELECT, INSERT, UPDATE ON "income_extractions" TO freeflow_worker;
GRANT SELECT, INSERT ON "income_calculation_extractions" TO freeflow_app;
GRANT SELECT ON "income_calculation_extractions" TO freeflow_worker;
