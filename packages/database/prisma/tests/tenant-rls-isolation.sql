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

INSERT INTO "loan_documents" (
  "id", "tenantId", "loanId", "fileType", "documentCategory", "sourceAttachmentId", "sourceContentHash", "parserVersion"
) VALUES
  ('20202020-2020-4020-8020-202020202020', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'application/pdf', 'W2_WAGE', 'attachment-a', repeat('a', 64), 'income-parser-v5'),
  ('21212121-2121-4121-8121-212121212121', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'application/pdf', 'W2_WAGE', 'attachment-b', repeat('b', 64), 'income-parser-v5');

INSERT INTO "income_extractions" (
  "id", "tenantId", "loanId", "sourceDocumentId", "sourceAttachmentId", "sourceDocumentVersion",
  "sourceContentHash", "parserVersion", "schemaVersion", "normalizedInput", "evidence", "canonicalHash"
) VALUES
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '20202020-2020-4020-8020-202020202020', 'attachment-a', 1, repeat('a', 64), 'income-parser-v5', 'income-extraction-v2', '{"w2Records":[{"entityId":"synthetic-w2-a","employerName":"Synthetic Employer A","year":2025,"annualWages":97481.4}]}', '{"fields":[]}', repeat('c', 64)),
  ('23232323-2323-4232-8232-232323232323', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '21212121-2121-4121-8121-212121212121', 'attachment-b', 1, repeat('b', 64), 'income-parser-v5', 'income-extraction-v2', '{"w2Records":[{"entityId":"synthetic-w2-b","employerName":"Synthetic Employer B","year":2025,"annualWages":84000}]}', '{"fields":[]}', repeat('d', 64));

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
    'public.appraisal_action_items'::regclass,
    'public.audit_events'::regclass,
    'public.api_idempotency_keys'::regclass,
    'public.encompass_document_pull_jobs'::regclass,
    'public.encompass_connector_bindings'::regclass,
    'public.encompass_sync_jobs'::regclass,
    'public.encompass_host_writes'::regclass,
    'public.income_extractions'::regclass,
    'public.income_extraction_metadata_reviews'::regclass,
    'public.income_calculation_extractions'::regclass,
    'public.loan_borrowers'::regclass
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
  IF has_table_privilege('freeflow_app', 'audit_events', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'audit_events', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_app can mutate append-only audit events';
  END IF;
  IF has_table_privilege('freeflow_app', 'api_idempotency_keys', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'api_idempotency_keys', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_app can mutate stored idempotency keys';
  END IF;
  IF NOT has_table_privilege('freeflow_app', 'encompass_host_writes', 'INSERT')
    OR NOT has_table_privilege('freeflow_app', 'encompass_host_writes', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'encompass_host_writes', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_app hosted-write grants are not least privilege';
  END IF;
  IF has_table_privilege('freeflow_app', 'income_extractions', 'INSERT')
    OR has_table_privilege('freeflow_app', 'income_extractions', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'income_extractions', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_app can mutate authoritative extractions';
  END IF;
  IF NOT has_function_privilege(
    'freeflow_app',
    'app.persist_uploaded_income_extraction(uuid,uuid,uuid,character varying,integer,character,character varying,character varying,jsonb,jsonb,text[],numeric,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'freeflow_app cannot invoke the constrained authenticated-upload extraction writer';
  END IF;
  IF NOT has_table_privilege('freeflow_worker', 'income_extractions', 'INSERT')
    OR NOT has_table_privilege('freeflow_worker', 'income_extractions', 'UPDATE')
    OR has_table_privilege('freeflow_worker', 'income_extractions', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_worker extraction grants are not least privilege';
  END IF;
  IF has_table_privilege('freeflow_worker', 'income_calculation_extractions', 'INSERT')
    OR has_table_privilege('freeflow_worker', 'income_calculation_extractions', 'UPDATE')
    OR has_table_privilege('freeflow_worker', 'income_calculation_extractions', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_worker can mutate calculation provenance';
  END IF;
  IF NOT has_table_privilege('freeflow_app', 'income_extraction_metadata_reviews', 'INSERT')
    OR has_table_privilege('freeflow_app', 'income_extraction_metadata_reviews', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'income_extraction_metadata_reviews', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_app metadata review grants are not append-only';
  END IF;
  IF has_table_privilege('freeflow_worker', 'income_extraction_metadata_reviews', 'INSERT')
    OR has_table_privilege('freeflow_worker', 'income_extraction_metadata_reviews', 'UPDATE')
    OR has_table_privilege('freeflow_worker', 'income_extraction_metadata_reviews', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_worker can mutate reviewer metadata';
  END IF;
  IF NOT has_table_privilege('freeflow_app', 'loan_borrowers', 'SELECT')
    OR NOT has_table_privilege('freeflow_app', 'loan_borrowers', 'INSERT')
    OR has_table_privilege('freeflow_app', 'loan_borrowers', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'loan_borrowers', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_app borrower roster grants are not insert-only';
  END IF;
  IF NOT has_table_privilege('freeflow_worker', 'loan_borrowers', 'SELECT')
    OR has_table_privilege('freeflow_worker', 'loan_borrowers', 'INSERT')
    OR has_table_privilege('freeflow_worker', 'loan_borrowers', 'UPDATE')
    OR has_table_privilege('freeflow_worker', 'loan_borrowers', 'DELETE') THEN
    RAISE EXCEPTION 'freeflow_worker borrower roster grants are not read-only';
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
  visible_extractions integer;
  changed_rows integer;
BEGIN
  SELECT count(*) INTO visible_loans FROM "loan_applications";
  SELECT count(*) INTO visible_tenants FROM "tenants";
  SELECT count(*) INTO visible_extractions FROM "income_extractions";
  IF visible_loans <> 1 OR visible_tenants <> 1 OR visible_extractions <> 1 THEN
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

INSERT INTO "loan_applications" (
  "id", "tenantId", "encompassGuid", "encompassIntegrationMode", "updatedAt"
) VALUES (
  '29292929-2929-4292-8292-292929292929',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'synthetic-encompass-host-guid-a', 'ENCOMPASS_HOSTED', now()
);

DO $identity_only_host_binding$
DECLARE
  borrower_fields integer;
BEGIN
  SELECT count(*) INTO borrower_fields
  FROM "loan_applications"
  WHERE "id" = '29292929-2929-4292-8292-292929292929'
    AND ("primaryBorrowerName" IS NOT NULL OR "primaryBorrowerEmail" IS NOT NULL);
  IF borrower_fields <> 0 THEN
    RAISE EXCEPTION 'Identity-only host binding fabricated borrower identity';
  END IF;

  BEGIN
    INSERT INTO "loan_applications" (
      "id", "tenantId", "encompassGuid", "encompassIntegrationMode", "updatedAt"
    ) VALUES (
      '30303030-3030-4030-8030-303030303030',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'synthetic-cross-tenant-host-guid', 'ENCOMPASS_HOSTED', now()
    );
    RAISE EXCEPTION 'Tenant A created a Tenant B host binding';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$identity_only_host_binding$;

DO $composite_fk$
BEGIN
  BEGIN
    INSERT INTO "loan_documents" (
      "id", "tenantId", "loanId", "fileType", "documentCategory"
    ) VALUES (
      '12121212-1212-4121-8121-121212121212',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'application/pdf',
      'TEST'
    );
    RAISE EXCEPTION 'Cross-tenant child relationship was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$composite_fk$;

INSERT INTO "loan_documents" (
  "id", "tenantId", "loanId", "fileType", "documentCategory", "sourceAttachmentId",
  "sourceContentHash", "parserVersion"
) VALUES (
  '24242424-2424-4242-8242-242424242424',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'application/pdf', 'W2_WAGE', 'authenticated-upload-a', repeat('e', 64), 'income-parser-v5'
);

DO $authenticated_upload_writer$
DECLARE
  created BOOLEAN;
  repeated BOOLEAN;
  extraction_count INTEGER;
BEGIN
  SELECT app.persist_uploaded_income_extraction(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '24242424-2424-4242-8242-242424242424',
    'authenticated-upload-a', 1, repeat('e', 64), 'income-parser-v5', 'income-extraction-v2',
    '{"w2Records":[{"entityId":"synthetic-upload-a","employerName":"Synthetic Employer","year":2025,"annualWages":96000}]}'::jsonb,
    '{"fields":[]}'::jsonb, ARRAY[]::text[], 99.00, repeat('f', 64)
  ) INTO created;
  IF NOT created THEN
    RAISE EXCEPTION 'authenticated upload did not append its extraction';
  END IF;

  SELECT app.persist_uploaded_income_extraction(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '24242424-2424-4242-8242-242424242424',
    'authenticated-upload-a', 1, repeat('e', 64), 'income-parser-v5', 'income-extraction-v2',
    '{"w2Records":[{"entityId":"synthetic-upload-a","employerName":"Synthetic Employer","year":2025,"annualWages":96000}]}'::jsonb,
    '{"fields":[]}'::jsonb, ARRAY[]::text[], 99.00, repeat('f', 64)
  ) INTO repeated;
  IF repeated THEN
    RAISE EXCEPTION 'authenticated upload writer was not idempotent';
  END IF;

  SELECT count(*) INTO extraction_count
  FROM "income_extractions"
  WHERE "sourceDocumentId" = '24242424-2424-4242-8242-242424242424';
  IF extraction_count <> 1 THEN
    RAISE EXCEPTION 'authenticated upload created % extraction rows', extraction_count;
  END IF;

  BEGIN
    PERFORM app.persist_uploaded_income_extraction(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '21212121-2121-4121-8121-212121212121',
      'attachment-b', 1, repeat('b', 64), 'income-parser-v5', 'income-extraction-v2',
      '{}'::jsonb, '{"fields":[]}'::jsonb, ARRAY[]::text[], NULL, repeat('d', 64)
    );
    RAISE EXCEPTION 'authenticated upload writer accepted a cross-tenant call';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$authenticated_upload_writer$;

DO $zero_data_retention_schema$
DECLARE
  prohibited_columns integer;
BEGIN
  SELECT count(*) INTO prohibited_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (
      ('loan_documents', 'fileName'),
      ('loan_documents', 's3BucketKey'),
      ('loan_documents', 'ocrParsedPayload'),
      ('ocr_diff_histories', 'rawOcrValue'),
      ('ocr_diff_histories', 'borrowerValue'),
      ('form_1084_audits', 'extractedTaxFields'),
      ('form_1084_audits', 'manualFieldOverrides')
    );
  IF prohibited_columns <> 0 THEN
    RAISE EXCEPTION 'Zero-data-retention migration left % prohibited columns', prohibited_columns;
  END IF;
END
$zero_data_retention_schema$;

INSERT INTO "audit_events" (
  "id", "tenantId", "loanId", "actorUserId", "action", "entityType", "entityId",
  "expectedLoanVersion", "reasonCode", "ruleVersion", "schemaVersion", "requestId",
  "resultHash", "eventHash"
) VALUES (
  '13131313-1313-4131-8131-131313131313',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'INCOME_CALCULATION_COMPLETED', 'FORM_1084_AUDIT', '14141414-1414-4141-8141-141414141414',
  1, 'SYSTEM_CALCULATION', 'form-1084-v9', 'audit-event-v1', 'audit-test-request',
  repeat('0', 64), repeat('1', 64)
);

INSERT INTO "audit_events" (
  "id", "tenantId", "loanId", "actorUserId", "action", "entityType", "entityId",
  "expectedLoanVersion", "reasonCode", "reasonNarrative", "ruleVersion", "schemaVersion",
  "requestId", "resultHash", "eventHash", "previousEventHash"
) VALUES (
  '17171717-1717-4171-8171-171717171717',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'INCOME_APPROVED', 'FORM_1084_AUDIT', '14141414-1414-4141-8141-141414141414',
  1, 'UNDERWRITER_CONFIRMED', NULL, 'form-1084-v9', 'audit-event-v1',
  'audit-approval-request', repeat('4', 64), repeat('5', 64), repeat('1', 64)
);

INSERT INTO "api_idempotency_keys" (
  "id", "tenantId", "operation", "key", "requestHash", "responseCode",
  "responseReference", "expiresAt"
) VALUES (
  '18181818-1818-4181-8181-181818181818',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'income-approvals',
  'income-approval-sql-01',
  repeat('6', 64),
  201,
  '{"auditEventId":"17171717-1717-4171-8171-171717171717","loanVersion":2}',
  now() + interval '24 hours'
);

INSERT INTO "encompass_host_writes" (
  "id", "tenantId", "loanId", "approvalEventId", "requestedByUserId",
  "expectedLoanVersion", "idempotencyKey", "correlationId", "fieldMapHash", "updatedAt"
) VALUES (
  '28282828-2828-4282-8282-282828282828',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '17171717-1717-4171-8171-171717171717',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  2, 'host-write-sql-key-01', 'host-write-request', repeat('a', 64), now()
);

INSERT INTO "income_extraction_metadata_reviews" (
  "id", "tenantId", "loanId", "extractionId", "sourceDocumentId", "sourceDocumentVersion",
  "sourceContentHash", "extractionHash", "metadataVersion", "assignments", "source", "reasonCode",
  "reviewedByUserId", "canonicalHash"
) VALUES (
  '27272727-2727-4272-8272-272727272727',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '22222222-2222-4222-8222-222222222222',
  '20202020-2020-4020-8020-202020202020', 1, repeat('a', 64), repeat('c', 64), 1,
  '[{"entityId":"synthetic-w2-a","employmentRole":"CURRENT"}]',
  'DOCUMENT_VISUAL_REVIEW', 'DOCUMENT_METADATA_CONFIRMED',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', repeat('9', 64)
);

DO $metadata_append_only$
BEGIN
  BEGIN
    UPDATE "income_extraction_metadata_reviews" SET "reasonCode" = 'TAMPERED'
    WHERE "id" = '27272727-2727-4272-8272-272727272727';
    RAISE EXCEPTION 'freeflow_app unexpectedly updated reviewer metadata';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$metadata_append_only$;

DO $override_requires_narrative$
BEGIN
  BEGIN
    INSERT INTO "audit_events" (
      "id", "tenantId", "loanId", "actorUserId", "action", "entityType", "entityId",
      "expectedLoanVersion", "reasonCode", "ruleVersion", "schemaVersion", "requestId",
      "resultHash", "eventHash"
    ) VALUES (
      '19191919-1919-4191-8191-191919191919',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'INCOME_OVERRIDE', 'FORM_1084_AUDIT', '14141414-1414-4141-8141-141414141414',
      1, 'INCOME_ADJUSTED', 'form-1084-v9', 'audit-event-v1', 'audit-override-request',
      repeat('7', 64), repeat('8', 64)
    );
    RAISE EXCEPTION 'Override without a narrative was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$override_requires_narrative$;

DO $append_only_grants$
BEGIN
  BEGIN
    UPDATE "audit_events"
    SET "reasonCode" = 'TAMPERED'
    WHERE "id" = '13131313-1313-4131-8131-131313131313';
    RAISE EXCEPTION 'freeflow_app unexpectedly updated an audit event';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM "audit_events"
    WHERE "id" = '13131313-1313-4131-8131-131313131313';
    RAISE EXCEPTION 'freeflow_app unexpectedly deleted an audit event';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$append_only_grants$;

SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $audit_event_cross_tenant$
DECLARE
  visible_events integer;
  visible_keys integer;
  visible_metadata integer;
  visible_host_writes integer;
  visible_loans integer;
BEGIN
  SELECT count(*) INTO visible_events FROM "audit_events";
  SELECT count(*) INTO visible_keys FROM "api_idempotency_keys";
  SELECT count(*) INTO visible_metadata FROM "income_extraction_metadata_reviews";
  SELECT count(*) INTO visible_host_writes FROM "encompass_host_writes";
  SELECT count(*) INTO visible_loans FROM "loan_applications";
  IF visible_events <> 0 THEN
    RAISE EXCEPTION 'Tenant B observed Tenant A audit events';
  END IF;
  IF visible_keys <> 0 THEN
    RAISE EXCEPTION 'Tenant B observed Tenant A idempotency keys';
  END IF;
  IF visible_metadata <> 0 THEN
    RAISE EXCEPTION 'Tenant B observed Tenant A reviewer metadata';
  END IF;
  IF visible_host_writes <> 0 THEN
    RAISE EXCEPTION 'Tenant B observed Tenant A hosted writes';
  END IF;
  IF visible_loans <> 1 THEN
    RAISE EXCEPTION 'Tenant B observed a cross-tenant identity-only host binding';
  END IF;
END
$audit_event_cross_tenant$;
ROLLBACK;

BEGIN;
SET ROLE freeflow_migrator;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL app.principal_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

INSERT INTO "audit_events" (
  "id", "tenantId", "loanId", "actorUserId", "action", "entityType", "entityId",
  "expectedLoanVersion", "reasonCode", "ruleVersion", "schemaVersion", "requestId",
  "resultHash", "eventHash"
) VALUES (
  '15151515-1515-4151-8151-151515151515',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'INCOME_CALCULATION_COMPLETED', 'FORM_1084_AUDIT', '16161616-1616-4161-8161-161616161616',
  1, 'SYSTEM_CALCULATION', 'form-1084-v9', 'audit-event-v1', 'audit-trigger-test',
  repeat('2', 64), repeat('3', 64)
);

DO $append_only_trigger$
BEGIN
  BEGIN
    UPDATE "audit_events"
    SET "reasonCode" = 'TAMPERED'
    WHERE "id" = '15151515-1515-4151-8151-151515151515';
    RAISE EXCEPTION 'Audit mutation trigger did not reject the update';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
END
$append_only_trigger$;
ROLLBACK;
RESET ROLE;

BEGIN;
SET ROLE freeflow_worker;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL app.principal_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

DO $worker_extraction_isolation$
DECLARE
  visible_extractions integer;
BEGIN
  SELECT count(*) INTO visible_extractions FROM "income_extractions";
  IF visible_extractions <> 1 THEN
    RAISE EXCEPTION 'Worker tenant context exposed % extractions', visible_extractions;
  END IF;
  INSERT INTO "loan_documents" (
    "id", "tenantId", "loanId", "fileType", "documentCategory", "sourceAttachmentId",
    "sourceContentHash", "parserVersion"
  ) VALUES (
    '25252525-2525-4252-8252-252525252525',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'application/pdf', 'W2_WAGE', 'worker-attachment-a', repeat('e', 64), 'income-parser-v5'
  );
  INSERT INTO "income_extractions" (
    "id", "tenantId", "loanId", "sourceDocumentId", "sourceAttachmentId", "sourceDocumentVersion",
    "sourceContentHash", "parserVersion", "schemaVersion", "normalizedInput", "evidence", "canonicalHash"
  ) VALUES (
    '26262626-2626-4262-8262-262626262626',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '25252525-2525-4252-8252-252525252525',
    'worker-attachment-a', 1, repeat('e', 64), 'income-parser-v5', 'income-extraction-v1',
    '{"w2Employers":[]}', '{"fields":[]}', repeat('f', 64)
  );

  BEGIN
    INSERT INTO "income_extractions" (
      "id", "tenantId", "loanId", "sourceDocumentId", "sourceAttachmentId", "sourceDocumentVersion",
      "sourceContentHash", "parserVersion", "schemaVersion", "normalizedInput", "evidence", "canonicalHash"
    ) VALUES (
      '24242424-2424-4242-8242-242424242424',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '21212121-2121-4121-8121-212121212121',
      'attachment-b', 1, repeat('b', 64), 'income-parser-v5', 'income-extraction-v1',
      '{}', '{"fields":[]}', repeat('e', 64)
    );
    RAISE EXCEPTION 'Worker created a cross-tenant extraction association';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE "income_extractions"
    SET "canonicalHash" = repeat('f', 64)
    WHERE "id" = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'Worker mutated immutable extraction provenance';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  UPDATE "income_extractions"
  SET "status" = 'SUPERSEDED', "supersededAt" = now()
  WHERE "id" = '22222222-2222-4222-8222-222222222222';
  BEGIN
    UPDATE "income_extractions"
    SET "status" = 'ACTIVE', "supersededAt" = NULL
    WHERE "id" = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'Worker reactivated a superseded extraction';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
END
$worker_extraction_isolation$;
ROLLBACK;
RESET ROLE;

SET ROLE freeflow_app;
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
