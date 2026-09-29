-- Ordered, tenant/loan-scoped borrower roster. Identity is a stable key, never a name.
CREATE TYPE "LoanBorrowerRole" AS ENUM ('PRIMARY', 'CO_BORROWER');

CREATE TABLE "loan_borrowers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "borrowerKey" VARCHAR(32) NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "role" "LoanBorrowerRole" NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_borrowers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loan_borrowers_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_borrowers_loan_fkey" FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_borrowers_key_format" CHECK ("borrowerKey" ~ '^borrower-[1-9][0-9]{0,2}$'),
  CONSTRAINT "loan_borrowers_ordinal_role" CHECK (
    ("role" = 'PRIMARY' AND "ordinal" = 0)
    OR ("role" = 'CO_BORROWER' AND "ordinal" > 0 AND "ordinal" < 4)
  )
);

CREATE UNIQUE INDEX "loan_borrowers_tenant_loan_key" ON "loan_borrowers"("tenantId", "loanId", "borrowerKey");
CREATE UNIQUE INDEX "loan_borrowers_tenant_loan_ordinal" ON "loan_borrowers"("tenantId", "loanId", "ordinal");
CREATE INDEX "loan_borrowers_tenant_loan_ordinal_idx" ON "loan_borrowers"("tenantId", "loanId", "ordinal");
CREATE UNIQUE INDEX "loan_borrowers_one_primary_per_loan" ON "loan_borrowers"("tenantId", "loanId") WHERE "role" = 'PRIMARY';

CREATE OR REPLACE FUNCTION app.reject_loan_borrower_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION 'loan borrower roster rows are insert-only' USING ERRCODE = '55000';
END
$function$;
ALTER FUNCTION app.reject_loan_borrower_mutation() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.reject_loan_borrower_mutation() FROM PUBLIC;
CREATE TRIGGER loan_borrowers_reject_mutation
  BEFORE UPDATE OR DELETE ON "loan_borrowers"
  FOR EACH ROW EXECUTE FUNCTION app.reject_loan_borrower_mutation();

ALTER TABLE "loan_borrowers" OWNER TO freeflow_owner;
ALTER TABLE "loan_borrowers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loan_borrowers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loan_borrowers"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));
REVOKE ALL ON "loan_borrowers" FROM PUBLIC;
GRANT SELECT, INSERT ON "loan_borrowers" TO freeflow_app;
GRANT SELECT ON "loan_borrowers" TO freeflow_worker;

-- Allowlisted per-borrower qualifying income. Values are keys and amounts only.
ALTER TABLE "form_1084_audits" ADD COLUMN "borrowerIncome" JSONB;
ALTER TABLE "form_1084_audits" ADD CONSTRAINT "form_1084_audits_borrower_income_array" CHECK (
  "borrowerIncome" IS NULL OR jsonb_typeof("borrowerIncome") = 'array'
);
