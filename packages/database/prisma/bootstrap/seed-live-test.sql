-- Synthetic-only live-test tenant and membership. Never substitute borrower data.
BEGIN;

SELECT set_config('app.tenant_id', :'tenant_id', true);
SELECT set_config('app.principal_id', :'user_id', true);

INSERT INTO tenants (
  id, "companyName", "primaryContactEmail", "isActive",
  "isBillingActive", "createdAt", "updatedAt"
) VALUES (
  :'tenant_id'::uuid,
  'FreeFlow Synthetic Test Tenant',
  :'user_email',
  true,
  false,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  "isActive" = true,
  "isBillingActive" = false,
  "updatedAt" = now();

-- Integration mode is an explicit operator-owned tenant setting. Omitting the
-- seed variable preserves the current value, so adding a tester cannot
-- accidentally enable or disable an LOS integration.
INSERT INTO tenant_configurations (
  id, "tenantId", "encompassIntegrationMode", "updatedAt"
)
SELECT
  gen_random_uuid(),
  :'tenant_id'::uuid,
  NULLIF(:'encompass_integration_mode', '')::"EncompassIntegrationMode",
  now()
WHERE :'encompass_integration_mode' <> ''
ON CONFLICT ("tenantId") DO UPDATE SET
  "encompassIntegrationMode" = EXCLUDED."encompassIntegrationMode",
  "updatedAt" = now();

INSERT INTO users (
  id, "tenantId", email, "oidcSubject", "isActive",
  "firstName", "lastName", role, "createdAt", "updatedAt"
) VALUES (
  :'user_id'::uuid,
  :'tenant_id'::uuid,
  :'user_email',
  :'oidc_subject',
  true,
  :'first_name',
  :'last_name',
  :'user_role'::"UserRole",
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  "oidcSubject" = EXCLUDED."oidcSubject",
  "firstName" = EXCLUDED."firstName",
  "lastName" = EXCLUDED."lastName",
  role = EXCLUDED.role,
  "isActive" = true,
  "updatedAt" = now();

COMMIT;
