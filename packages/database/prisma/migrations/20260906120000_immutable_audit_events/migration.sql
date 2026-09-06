-- Immutable audit ledger for calculation, approval, and override evidence.
-- This migration is deployed by the restricted migrator role after the
-- database-role bootstrap and tenant RLS foundation migrations.

ALTER TABLE "loan_applications"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "entityType" VARCHAR(100) NOT NULL,
  "entityId" UUID NOT NULL,
  "expectedLoanVersion" INTEGER NOT NULL,
  "reasonCode" VARCHAR(100) NOT NULL,
  "reasonNarrative" VARCHAR(500),
  "ruleVersion" VARCHAR(100) NOT NULL,
  "schemaVersion" VARCHAR(100) NOT NULL,
  "requestId" VARCHAR(100) NOT NULL,
  "resultHash" CHAR(64) NOT NULL,
  "previousEventHash" CHAR(64),
  "eventHash" CHAR(64) NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_events_eventHash_key" UNIQUE ("eventHash"),
  CONSTRAINT "audit_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_events_tenantId_loanId_fkey"
    FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_events_tenantId_actorUserId_fkey"
    FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_events_resultHash_format" CHECK ("resultHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "audit_events_previousEventHash_format" CHECK ("previousEventHash" IS NULL OR "previousEventHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "audit_events_eventHash_format" CHECK ("eventHash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "audit_events_tenantId_occurredAt_id_idx"
  ON "audit_events"("tenantId", "occurredAt", "id");
CREATE INDEX "audit_events_tenantId_loanId_occurredAt_id_idx"
  ON "audit_events"("tenantId", "loanId", "occurredAt", "id");
CREATE INDEX "audit_events_tenantId_requestId_idx"
  ON "audit_events"("tenantId", "requestId");

ALTER TABLE "audit_events" OWNER TO freeflow_owner;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "audit_events"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));

CREATE OR REPLACE FUNCTION app.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only'
    USING ERRCODE = '55000';
END
$function$;

ALTER FUNCTION app.reject_audit_event_mutation() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.reject_audit_event_mutation() FROM PUBLIC;

CREATE TRIGGER audit_events_reject_mutation
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_event_mutation();

REVOKE ALL ON "audit_events" FROM PUBLIC;
GRANT SELECT, INSERT ON "audit_events" TO freeflow_app;
GRANT SELECT ON "audit_events" TO freeflow_worker;

-- Future tables created by the owner must start private. Explicit grants are
-- required in their own migration after security review.
ALTER DEFAULT PRIVILEGES FOR ROLE freeflow_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
