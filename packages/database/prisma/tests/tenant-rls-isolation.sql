\set ON_ERROR_STOP on

INSERT INTO "tenants" ("id", "companyName", "primaryContactEmail", "updatedAt") VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A', 'a@example.test', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B', 'b@example.test', now());

INSERT INTO "users" ("id", "tenantId", "email", "oidcSubject", "firstName", "lastName", "role", "updatedAt") VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user-a@example.test', 'verified-subject-a', 'User', 'A', 'UNDERWRITER', now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'user-b@example.test', 'verified-subject-b', 'User', 'B', 'UNDERWRITER', now());

INSERT INTO "loan_applications" ("id", "tenantId", "primaryBorrowerName", "primaryBorrowerEmail", "updatedAt") VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Borrower A', 'borrower-a@example.test', now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Borrower B', 'borrower-b@example.test', now());

DO $role_assertions$
DECLARE
  unsafe_roles integer;
  incorrectly_owned integer;
  unprotected_tables integer;
BEGIN
  SELECT count(*) INTO unsafe_roles
  FROM pg_roles
  WHERE rolname IN ('freeflow_owner', 'freeflow_migrator', 'freeflow_app', 'freeflow_worker', 'freeflow_readonly')
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls);
  IF unsafe_roles <> 0 THEN
    RAISE EXCEPTION 'A FreeFlow capability role has unsafe PostgreSQL attributes';
  END IF;

  SELECT count(*) INTO incorrectly_owned
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> '_prisma_migrations'
    AND tableowner <> 'freeflow_owner';
  IF incorrectly_owned <> 0 THEN
    RAISE EXCEPTION 'Tenant tables are not owned exclusively by freeflow_owner';
  END IF;

  SELECT count(*) INTO unprotected_tables
  FROM pg_class
  WHERE oid IN (
    'public.tenants'::regclass,
    'public.tenant_configurations'::regclass,
    'public.users'::regclass,
    'public.loan_applications'::regclass,
    'public.loan_documents'::regclass,
    'public.ocr_diff_histories'::regclass,
    'public.form_1084_audits'::regclass,
    'public.loan_conditions'::regclass,
    'public.tenant_billing_ledgers'::regclass,
    'public.appraisal_audits'::regclass,
    'public.appraisal_action_items'::regclass
  ) AND (NOT relrowsecurity OR NOT relforcerowsecurity);
  IF unprotected_tables <> 0 THEN
    RAISE EXCEPTION 'One or more tenant tables do not force row-level security';
  END IF;

  IF has_schema_privilege('freeflow_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'freeflow_app can create public schema objects';
  END IF;
  IF has_table_privilege('freeflow_readonly', 'loan_applications', 'SELECT') THEN
    RAISE EXCEPTION 'freeflow_readonly received access before safe diagnostic views exist';
  END IF;
END
$role_assertions$;

SET ROLE freeflow_app;

DO $no_context$
DECLARE
  visible_rows integer;
BEGIN
  SELECT count(*) INTO visible_rows FROM "loan_applications";
  IF visible_rows <> 0 THEN
    RAISE EXCEPTION 'Missing tenant context exposed % loans', visible_rows;
  END IF;
END
$no_context$;

BEGIN;
SET LOCAL app.tenant_id = 'not-a-uuid';
DO $malformed_context$
DECLARE
  visible_rows integer;
BEGIN
  SELECT count(*) INTO visible_rows FROM "loan_applications";
  IF visible_rows <> 0 THEN
    RAISE EXCEPTION 'Malformed tenant context exposed % loans', visible_rows;
  END IF;
END
$malformed_context$;
ROLLBACK;

BEGIN;
SET LOCAL app.oidc_subject = 'verified-subject-a';
DO $identity_discovery$
DECLARE
  visible_users integer;
  visible_tenants integer;
BEGIN
  SELECT count(*) INTO visible_users FROM "users";
  SELECT count(*) INTO visible_tenants FROM "tenants";
  IF visible_users <> 1 OR visible_tenants <> 0 THEN
    RAISE EXCEPTION 'Pre-tenant identity discovery exceeded its narrow user scope';
  END IF;
END
$identity_discovery$;
ROLLBACK;

BEGIN;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL app.principal_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

DO $tenant_a_visibility$
DECLARE
  visible_loans integer;
  visible_tenants integer;
  changed_rows integer;
BEGIN
  SELECT count(*) INTO visible_loans FROM "loan_applications";
  SELECT count(*) INTO visible_tenants FROM "tenants";
  IF visible_loans <> 1 OR visible_tenants <> 1 THEN
    RAISE EXCEPTION 'Tenant A context did not isolate rows';
  END IF;

  UPDATE "loan_applications"
  SET "primaryBorrowerName" = 'Cross-tenant overwrite'
  WHERE "id" = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 0 THEN
    RAISE EXCEPTION 'Tenant A updated a Tenant B loan';
  END IF;
END
$tenant_a_visibility$;

DO $composite_fk$
BEGIN
  BEGIN
    INSERT INTO "loan_documents" (
      "id", "tenantId", "loanId", "fileName", "fileType", "s3BucketKey", "documentCategory"
    ) VALUES (
      '12121212-1212-4121-8121-121212121212',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'forbidden.pdf',
      'application/pdf',
      'forbidden',
      'TEST'
    );
    RAISE EXCEPTION 'Cross-tenant child relationship was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$composite_fk$;
ROLLBACK;

DO $ddl_denial$
BEGIN
  BEGIN
    CREATE TABLE public.forbidden_app_ddl (id integer);
    RAISE EXCEPTION 'freeflow_app unexpectedly created a table';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$ddl_denial$;

RESET ROLE;

SELECT 'tenant RLS isolation verified' AS result;
