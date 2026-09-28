-- Restricted dev-admin operation. This changes only an existing tenant's LOS
-- integration mode; it never creates tenant, user, loan, or borrower data.
BEGIN;

SELECT set_config('app.tenant_id', :'tenant_id', true);

UPDATE tenant_configurations
SET
  "encompassIntegrationMode" = :'encompass_integration_mode'::"EncompassIntegrationMode",
  "updatedAt" = now()
WHERE "tenantId" = :'tenant_id'::uuid;

SELECT EXISTS (
  SELECT 1
  FROM tenant_configurations
  WHERE "tenantId" = :'tenant_id'::uuid
    AND "encompassIntegrationMode" = :'encompass_integration_mode'::"EncompassIntegrationMode"
) AS tenant_mode_configured \gset

\if :tenant_mode_configured
\else
  \echo 'The requested tenant configuration does not exist or was not updated.'
  \quit 3
\endif

COMMIT;
