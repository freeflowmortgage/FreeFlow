-- This migration requires prisma/bootstrap/roles.sql to have been executed once
-- by the database administrator. Application credentials cannot create roles.
DO $required_roles$
DECLARE
  required_role text;
BEGIN
  FOREACH required_role IN ARRAY ARRAY[
    'freeflow_owner',
    'freeflow_migrator',
    'freeflow_app',
    'freeflow_worker',
    'freeflow_readonly'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = required_role) THEN
      RAISE EXCEPTION 'Required database role % is missing; run prisma/bootstrap/roles.sql first', required_role;
    END IF;
  END LOOP;
END
$required_roles$;

-- Expand first so existing non-production rows can be backfilled safely.
ALTER TABLE "loan_documents" ADD COLUMN "tenantId" UUID;
ALTER TABLE "ocr_diff_histories" ADD COLUMN "tenantId" UUID;
ALTER TABLE "form_1084_audits" ADD COLUMN "tenantId" UUID;
ALTER TABLE "loan_conditions" ADD COLUMN "tenantId" UUID;
ALTER TABLE "appraisal_audits" ADD COLUMN "tenantId" UUID;
ALTER TABLE "appraisal_action_items" ADD COLUMN "tenantId" UUID;

UPDATE "loan_documents" AS child
SET "tenantId" = parent."tenantId"
FROM "loan_applications" AS parent
WHERE child."loanId" = parent."id";

UPDATE "ocr_diff_histories" AS child
SET "tenantId" = parent."tenantId"
FROM "loan_applications" AS parent
WHERE child."loanId" = parent."id";

UPDATE "form_1084_audits" AS child
SET "tenantId" = parent."tenantId"
FROM "loan_applications" AS parent
WHERE child."loanId" = parent."id";

UPDATE "loan_conditions" AS child
SET "tenantId" = parent."tenantId"
FROM "loan_applications" AS parent
WHERE child."loanId" = parent."id";

UPDATE "appraisal_audits" AS child
SET "tenantId" = parent."tenantId"
FROM "loan_applications" AS parent
WHERE child."loanId" = parent."id";

UPDATE "appraisal_action_items" AS child
SET "tenantId" = parent."tenantId"
FROM "appraisal_audits" AS parent
WHERE child."appraisalAuditId" = parent."id";

ALTER TABLE "loan_documents" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ocr_diff_histories" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "form_1084_audits" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "loan_conditions" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "appraisal_audits" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "appraisal_action_items" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "appraisal_action_items" DROP CONSTRAINT "appraisal_action_items_appraisalAuditId_fkey";
ALTER TABLE "appraisal_action_items" DROP CONSTRAINT "appraisal_action_items_clearedByUserId_fkey";
ALTER TABLE "appraisal_audits" DROP CONSTRAINT "appraisal_audits_loanId_fkey";
ALTER TABLE "appraisal_audits" DROP CONSTRAINT "appraisal_audits_verifiedByUserId_fkey";
ALTER TABLE "form_1084_audits" DROP CONSTRAINT "form_1084_audits_loanId_fkey";
ALTER TABLE "form_1084_audits" DROP CONSTRAINT "form_1084_audits_verifiedByUserId_fkey";
ALTER TABLE "loan_conditions" DROP CONSTRAINT "loan_conditions_loanId_fkey";
ALTER TABLE "loan_documents" DROP CONSTRAINT "loan_documents_loanId_fkey";
ALTER TABLE "ocr_diff_histories" DROP CONSTRAINT "ocr_diff_histories_documentId_fkey";
ALTER TABLE "ocr_diff_histories" DROP CONSTRAINT "ocr_diff_histories_loanId_fkey";

DROP INDEX "appraisal_action_items_appraisalAuditId_isCleared_idx";
DROP INDEX "appraisal_audits_loanId_idx";
DROP INDEX "form_1084_audits_loanId_entityType_idx";
DROP INDEX "loan_applications_encompassGuid_key";
DROP INDEX "tenant_billing_ledgers_loanId_idx";
DROP INDEX "tenant_billing_ledgers_tenantId_idx";

CREATE UNIQUE INDEX "users_tenantId_id_key" ON "users"("tenantId", "id");
CREATE UNIQUE INDEX "loan_applications_tenantId_id_key" ON "loan_applications"("tenantId", "id");
CREATE UNIQUE INDEX "loan_applications_tenantId_encompassGuid_key" ON "loan_applications"("tenantId", "encompassGuid");
CREATE INDEX "loan_documents_tenantId_loanId_idx" ON "loan_documents"("tenantId", "loanId");
CREATE UNIQUE INDEX "loan_documents_tenantId_id_key" ON "loan_documents"("tenantId", "id");
CREATE UNIQUE INDEX "loan_documents_tenantId_loanId_id_key" ON "loan_documents"("tenantId", "loanId", "id");
CREATE INDEX "ocr_diff_histories_tenantId_loanId_idx" ON "ocr_diff_histories"("tenantId", "loanId");
CREATE INDEX "form_1084_audits_tenantId_loanId_entityType_idx" ON "form_1084_audits"("tenantId", "loanId", "entityType");
CREATE INDEX "loan_conditions_tenantId_loanId_idx" ON "loan_conditions"("tenantId", "loanId");
CREATE INDEX "tenant_billing_ledgers_tenantId_loanId_idx" ON "tenant_billing_ledgers"("tenantId", "loanId");
CREATE UNIQUE INDEX "appraisal_audits_tenantId_id_key" ON "appraisal_audits"("tenantId", "id");
CREATE INDEX "appraisal_audits_tenantId_loanId_idx" ON "appraisal_audits"("tenantId", "loanId");
CREATE INDEX "appraisal_action_items_tenantId_appraisalAuditId_isCleared_idx" ON "appraisal_action_items"("tenantId", "appraisalAuditId", "isCleared");

ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_tenantId_loanId_fkey"
  FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ocr_diff_histories" ADD CONSTRAINT "ocr_diff_histories_tenantId_loanId_fkey"
  FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ocr_diff_histories" ADD CONSTRAINT "ocr_diff_histories_tenantId_loanId_documentId_fkey"
  FOREIGN KEY ("tenantId", "loanId", "documentId") REFERENCES "loan_documents"("tenantId", "loanId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_1084_audits" ADD CONSTRAINT "form_1084_audits_tenantId_loanId_fkey"
  FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_1084_audits" ADD CONSTRAINT "form_1084_audits_tenantId_verifiedByUserId_fkey"
  FOREIGN KEY ("tenantId", "verifiedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loan_conditions" ADD CONSTRAINT "loan_conditions_tenantId_loanId_fkey"
  FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_conditions" ADD CONSTRAINT "loan_conditions_tenantId_loanId_resolvedDocId_fkey"
  FOREIGN KEY ("tenantId", "loanId", "resolvedDocId") REFERENCES "loan_documents"("tenantId", "loanId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_billing_ledgers" ADD CONSTRAINT "tenant_billing_ledgers_tenantId_loanId_fkey"
  FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appraisal_audits" ADD CONSTRAINT "appraisal_audits_tenantId_loanId_fkey"
  FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appraisal_audits" ADD CONSTRAINT "appraisal_audits_tenantId_verifiedByUserId_fkey"
  FOREIGN KEY ("tenantId", "verifiedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appraisal_action_items" ADD CONSTRAINT "appraisal_action_items_tenantId_appraisalAuditId_fkey"
  FOREIGN KEY ("tenantId", "appraisalAuditId") REFERENCES "appraisal_audits"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appraisal_action_items" ADD CONSTRAINT "appraisal_action_items_tenantId_clearedByUserId_fkey"
  FOREIGN KEY ("tenantId", "clearedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION freeflow_owner;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO freeflow_app, freeflow_worker, freeflow_readonly;

CREATE OR REPLACE FUNCTION app.safe_uuid_setting(setting_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  setting_value text;
BEGIN
  setting_value := current_setting(setting_name, true);
  IF setting_value IS NULL OR setting_value = '' THEN
    RETURN NULL;
  END IF;
  RETURN setting_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$function$;

ALTER FUNCTION app.safe_uuid_setting(text) OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.safe_uuid_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.safe_uuid_setting(text) TO freeflow_app, freeflow_worker, freeflow_readonly;

-- Existing objects become owned by a role that can never log in.
ALTER TABLE "tenants" OWNER TO freeflow_owner;
ALTER TABLE "tenant_configurations" OWNER TO freeflow_owner;
ALTER TABLE "users" OWNER TO freeflow_owner;
ALTER TABLE "loan_applications" OWNER TO freeflow_owner;
ALTER TABLE "loan_documents" OWNER TO freeflow_owner;
ALTER TABLE "ocr_diff_histories" OWNER TO freeflow_owner;
ALTER TABLE "form_1084_audits" OWNER TO freeflow_owner;
ALTER TABLE "loan_conditions" OWNER TO freeflow_owner;
ALTER TABLE "tenant_billing_ledgers" OWNER TO freeflow_owner;
ALTER TABLE "appraisal_audits" OWNER TO freeflow_owner;
ALTER TABLE "appraisal_action_items" OWNER TO freeflow_owner;

ALTER TYPE "UserRole" OWNER TO freeflow_owner;
ALTER TYPE "ApplicationStatus" OWNER TO freeflow_owner;
ALTER TYPE "ConditionStatus" OWNER TO freeflow_owner;
ALTER TYPE "EntityType" OWNER TO freeflow_owner;
ALTER TYPE "BillingTier" OWNER TO freeflow_owner;
ALTER TYPE "TrendingAnalysisResult" OWNER TO freeflow_owner;
ALTER TYPE "HousingProgram" OWNER TO freeflow_owner;
ALTER TYPE "PropertyType" OWNER TO freeflow_owner;
ALTER TYPE "OwnershipType" OWNER TO freeflow_owner;
ALTER TYPE "ActionCategory" OWNER TO freeflow_owner;
ALTER TYPE "RuleSeverity" OWNER TO freeflow_owner;
ALTER TYPE "AuthoritySource" OWNER TO freeflow_owner;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON TYPE
  "UserRole",
  "ApplicationStatus",
  "ConditionStatus",
  "EntityType",
  "BillingTier",
  "TrendingAnalysisResult",
  "HousingProgram",
  "PropertyType",
  "OwnershipType",
  "ActionCategory",
  "RuleSeverity",
  "AuthoritySource"
TO freeflow_app, freeflow_worker, freeflow_readonly;

GRANT SELECT ON "tenants", "tenant_configurations", "users" TO freeflow_app;
GRANT SELECT, INSERT, UPDATE ON "loan_applications", "loan_documents", "ocr_diff_histories", "form_1084_audits", "loan_conditions", "tenant_billing_ledgers", "appraisal_audits", "appraisal_action_items" TO freeflow_app;
GRANT DELETE ON "loan_documents", "ocr_diff_histories", "loan_conditions", "appraisal_action_items" TO freeflow_app;

GRANT SELECT ON "tenants", "tenant_configurations", "loan_applications", "form_1084_audits", "appraisal_audits" TO freeflow_worker;
GRANT UPDATE ON "loan_applications" TO freeflow_worker;

-- No table grants are assigned to freeflow_readonly until approved diagnostic
-- views exclude borrower and document-derived sensitive columns.

DO $rls$
DECLARE
  table_name text;
  tenant_expression text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants',
    'tenant_configurations',
    'users',
    'loan_applications',
    'loan_documents',
    'ocr_diff_histories',
    'form_1084_audits',
    'loan_conditions',
    'tenant_billing_ledgers',
    'appraisal_audits',
    'appraisal_action_items'
  ]
  LOOP
    tenant_expression := CASE WHEN table_name = 'tenants' THEN 'id' ELSE '"tenantId"' END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (%s = app.safe_uuid_setting(''app.tenant_id'')) WITH CHECK (%s = app.safe_uuid_setting(''app.tenant_id''))',
      table_name,
      tenant_expression,
      tenant_expression
    );
  END LOOP;
END
$rls$;

-- Authentication performs one narrow pre-tenant lookup using the subject from
-- a cryptographically verified ALB assertion. It cannot reveal another user
-- unless the server supplies that exact, globally unique subject.
CREATE POLICY verified_subject_discovery ON "users"
  FOR SELECT
  USING (
    "oidcSubject" IS NOT NULL
    AND "oidcSubject" = nullif(current_setting('app.oidc_subject', true), '')
  );

ALTER DEFAULT PRIVILEGES FOR ROLE freeflow_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE freeflow_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
