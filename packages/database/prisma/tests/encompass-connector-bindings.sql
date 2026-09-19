\set ON_ERROR_STOP on

DO $migration_assertions$
DECLARE
  applied_migrations integer;
  binding_table regclass;
BEGIN
  SELECT count(*) INTO applied_migrations
  FROM "_prisma_migrations"
  WHERE migration_name = '20260919120000_encompass_connector_bindings'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;
  IF applied_migrations <> 1 THEN
    RAISE EXCEPTION 'Connector binding migration was not applied successfully';
  END IF;

  SELECT to_regclass('public.encompass_connector_bindings') INTO binding_table;
  IF binding_table IS NULL THEN
    RAISE EXCEPTION 'Connector binding table is missing after migration';
  END IF;
END
$migration_assertions$;

DO $worker_role_assertions$
DECLARE
  unsafe_worker_role integer;
  rls_enabled boolean;
  rls_forced boolean;
BEGIN
  SELECT count(*) INTO unsafe_worker_role
  FROM pg_roles
  WHERE rolname = 'freeflow_worker'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls);
  IF unsafe_worker_role <> 0 THEN
    RAISE EXCEPTION 'freeflow_worker has unsafe PostgreSQL attributes';
  END IF;

  IF NOT has_schema_privilege('freeflow_worker', 'public', 'USAGE')
    OR NOT has_schema_privilege('freeflow_worker', 'app', 'USAGE')
    OR NOT has_function_privilege('freeflow_worker', 'app.safe_uuid_setting(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'freeflow_worker lacks a privilege required for tenant-scoped binding reads';
  END IF;

  IF NOT has_table_privilege('freeflow_worker', 'encompass_connector_bindings', 'SELECT') THEN
    RAISE EXCEPTION 'freeflow_worker cannot read connector bindings';
  END IF;
  IF has_table_privilege('freeflow_worker', 'encompass_connector_bindings', 'INSERT')
    OR has_table_privilege('freeflow_worker', 'encompass_connector_bindings', 'UPDATE')
    OR has_table_privilege('freeflow_worker', 'encompass_connector_bindings', 'DELETE')
    OR has_table_privilege('freeflow_worker', 'encompass_connector_bindings', 'TRUNCATE')
    OR has_table_privilege('freeflow_worker', 'encompass_connector_bindings', 'REFERENCES')
    OR has_table_privilege('freeflow_worker', 'encompass_connector_bindings', 'TRIGGER') THEN
    RAISE EXCEPTION 'freeflow_worker can mutate or administer connector bindings';
  END IF;

  SELECT relrowsecurity, relforcerowsecurity INTO rls_enabled, rls_forced
  FROM pg_class
  WHERE oid = 'public.encompass_connector_bindings'::regclass;
  IF NOT rls_enabled OR NOT rls_forced THEN
    RAISE EXCEPTION 'Connector bindings do not force row-level security';
  END IF;
END
$worker_role_assertions$;

INSERT INTO "tenants" ("id", "companyName", "primaryContactEmail", "updatedAt") VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A', 'a@example.test', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B', 'b@example.test', now()),
  ('33333333-3333-4333-8333-333333333333', 'Tenant Disabled', 'disabled@example.test', now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "encompass_connector_bindings" (
  "tenantId", "lenderId", "deploymentId", "isEnabled", "updatedAt"
) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'lender-a', 'deployment-a', true, now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'lender-b-sensitive', 'deployment-b-sensitive', true, now()),
  ('33333333-3333-4333-8333-333333333333', 'lender-disabled', 'deployment-disabled', false, now())
ON CONFLICT ("tenantId") DO UPDATE SET
  "lenderId" = EXCLUDED."lenderId",
  "deploymentId" = EXCLUDED."deploymentId",
  "isEnabled" = EXCLUDED."isEnabled",
  "updatedAt" = EXCLUDED."updatedAt";

SELECT 'connector binding migration and worker grants verified' AS result;
