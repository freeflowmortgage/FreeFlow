-- Synthetic-only live-test tenant and membership. Never substitute borrower data.
BEGIN;

SELECT set_config('app.tenant_id', '00000000-0000-4000-8000-000000000100', true);
SELECT set_config('app.principal_id', '00000000-0000-4000-8000-000000000101', true);

INSERT INTO tenants (
  id, "companyName", "primaryContactEmail", "isActive",
  "isBillingActive", "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000100',
  'FreeFlow Synthetic Test Tenant',
  :'user_email',
  true,
  false,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  "primaryContactEmail" = EXCLUDED."primaryContactEmail",
  "isActive" = true,
  "isBillingActive" = false,
  "updatedAt" = now();

INSERT INTO users (
  id, "tenantId", email, "oidcSubject", "isActive",
  "firstName", "lastName", role, "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000100',
  :'user_email',
  :'oidc_subject',
  true,
  'Synthetic',
  'Underwriter',
  'UNDERWRITER',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  "oidcSubject" = EXCLUDED."oidcSubject",
  "isActive" = true,
  "updatedAt" = now();

COMMIT;
