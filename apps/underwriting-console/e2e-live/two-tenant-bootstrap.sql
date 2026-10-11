-- Synthetic, local-only identities for the no-business-mock live acceptance run.
-- Run as the disposable database administrator after all migrations complete.

INSERT INTO tenants (
  id, "companyName", "primaryContactEmail", "isActive", "isBillingActive", "createdAt", "updatedAt"
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Synthetic Tenant A', 'tenant-a@synthetic.invalid', true, true, now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'Synthetic Tenant B', 'tenant-b@synthetic.invalid', true, true, now(), now())
ON CONFLICT (id) DO UPDATE SET
  "companyName" = EXCLUDED."companyName",
  "primaryContactEmail" = EXCLUDED."primaryContactEmail",
  "isActive" = true,
  "isBillingActive" = true,
  "updatedAt" = now();

INSERT INTO tenant_configurations (
  id, "tenantId", "enable1084Ocr", "enableEncompassSync",
  "enableEncompassDocumentPull", "enableUshdaValidation",
  "enableAppraisalReview", "encompassIntegrationMode", "updatedAt"
) VALUES
  (
    '11111111-1111-4111-8111-111111111112',
    '11111111-1111-4111-8111-111111111111',
    true, false, false, true, true, 'NONE', now()
  ),
  (
    '22222222-2222-4222-8222-222222222223',
    '22222222-2222-4222-8222-222222222222',
    true, false, false, true, true, 'NONE', now()
  )
ON CONFLICT ("tenantId") DO UPDATE SET
  "enable1084Ocr" = true,
  "enableEncompassSync" = false,
  "enableEncompassDocumentPull" = false,
  "encompassIntegrationMode" = 'NONE',
  "updatedAt" = now();

INSERT INTO users (
  id, "tenantId", email, "oidcSubject", "isActive", "firstName", "lastName", role, "createdAt", "updatedAt"
) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'underwriter-a@synthetic.invalid', 'synthetic-live-tenant-a', true,
    'Synthetic', 'Underwriter A', 'UNDERWRITER', now(), now()
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'underwriter-b@synthetic.invalid', 'synthetic-live-tenant-b', true,
    'Synthetic', 'Underwriter B', 'UNDERWRITER', now(), now()
  )
ON CONFLICT (id) DO UPDATE SET
  "tenantId" = EXCLUDED."tenantId",
  email = EXCLUDED.email,
  "oidcSubject" = EXCLUDED."oidcSubject",
  "isActive" = true,
  role = 'UNDERWRITER',
  "updatedAt" = now();

DO $verification$
BEGIN
  IF (
    SELECT count(*)
    FROM tenant_configurations
    WHERE "tenantId" IN (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
      AND "encompassIntegrationMode" = 'NONE'
      AND NOT "enableEncompassSync"
      AND NOT "enableEncompassDocumentPull"
  ) <> 2 THEN
    RAISE EXCEPTION 'Synthetic live tenants must have every LOS connection disabled';
  END IF;

  IF (
    SELECT count(*)
    FROM users
    WHERE id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    )
      AND "isActive"
      AND role = 'UNDERWRITER'
  ) <> 2 THEN
    RAISE EXCEPTION 'Synthetic live underwriter identities were not created';
  END IF;
END
$verification$;
