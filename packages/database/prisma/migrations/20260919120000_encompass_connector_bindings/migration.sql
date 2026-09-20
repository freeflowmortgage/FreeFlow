-- Opaque tenant-to-lender/deployment identity for the separate connector
-- service. Deliberately excludes LOS credentials, service tokens, and documents.
CREATE TABLE "encompass_connector_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "lenderId" VARCHAR(255) NOT NULL,
  "deploymentId" VARCHAR(255) NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "encompass_connector_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "encompass_connector_bindings_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "encompass_connector_bindings_tenant_id_key"
  ON "encompass_connector_bindings"("tenantId");

ALTER TABLE "encompass_connector_bindings" OWNER TO freeflow_owner;
ALTER TABLE "encompass_connector_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encompass_connector_bindings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "encompass_connector_bindings"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));

REVOKE ALL ON "encompass_connector_bindings" FROM PUBLIC;
GRANT SELECT ON "encompass_connector_bindings" TO freeflow_worker;
