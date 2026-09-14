-- Approval/override actions are first-class audit events. The application
-- still validates narrative and reason codes; these checks keep obviously
-- invalid rows out of the append-only ledger.
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_action_allowed"
  CHECK ("action" IN (
    'INCOME_CALCULATION_COMPLETED',
    'INCOME_APPROVED',
    'INCOME_OVERRIDE'
  ));

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_override_requires_narrative"
  CHECK (
    "action" <> 'INCOME_OVERRIDE'
    OR (
      "reasonNarrative" IS NOT NULL
      AND char_length(btrim("reasonNarrative")) > 0
    )
  );

-- Tenant-scoped idempotency for mutations such as income approvals.
-- responseReference is a compact safe identifier payload (audit event id,
-- loan version, action). It must never contain borrower data, documents,
-- or raw request bodies.
CREATE TABLE "api_idempotency_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "operation" VARCHAR(100) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "responseCode" INTEGER NOT NULL,
  "responseReference" VARCHAR(512) NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "api_idempotency_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_idempotency_keys_tenant_operation_key"
    UNIQUE ("tenantId", "operation", "key"),
  CONSTRAINT "api_idempotency_keys_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "api_idempotency_keys_requestHash_format"
    CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_idempotency_keys_key_format"
    CHECK ("key" ~ '^[A-Za-z0-9._~-]{16,128}$'),
  CONSTRAINT "api_idempotency_keys_operation_format"
    CHECK ("operation" ~ '^[A-Za-z0-9:_-]{1,100}$')
);

CREATE INDEX "api_idempotency_keys_tenantId_expiresAt_idx"
  ON "api_idempotency_keys"("tenantId", "expiresAt");

ALTER TABLE "api_idempotency_keys" OWNER TO freeflow_owner;
ALTER TABLE "api_idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_idempotency_keys" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "api_idempotency_keys"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));

REVOKE ALL ON "api_idempotency_keys" FROM PUBLIC;
GRANT SELECT, INSERT ON "api_idempotency_keys" TO freeflow_app;
GRANT SELECT ON "api_idempotency_keys" TO freeflow_worker;
