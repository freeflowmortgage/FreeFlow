\set ON_ERROR_STOP on

-- Every fixture and mutation in this file is rolled back at the end.
BEGIN;

INSERT INTO "tenants" ("id", "companyName", "primaryContactEmail", "updatedAt") VALUES
  ('a7000000-0000-4000-8000-000000000001', 'Webhook Tenant A', 'webhook-a@example.test', now()),
  ('b7000000-0000-4000-8000-000000000001', 'Webhook Tenant B', 'webhook-b@example.test', now());

INSERT INTO "users" ("id", "tenantId", "email", "oidcSubject", "firstName", "lastName", "role", "updatedAt") VALUES
  ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'webhook-admin-a@example.test', 'webhook-subject-a', 'Admin', 'A', 'BROKER_OWNER', now()),
  ('b7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000001', 'webhook-admin-b@example.test', 'webhook-subject-b', 'Admin', 'B', 'BROKER_OWNER', now());

INSERT INTO "loan_applications" ("id", "tenantId", "primaryBorrowerName", "primaryBorrowerEmail", "updatedAt") VALUES
  ('a7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000001', 'Borrower A', 'webhook-borrower-a@example.test', now()),
  ('b7000000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-000000000001', 'Borrower B', 'webhook-borrower-b@example.test', now());

INSERT INTO "audit_events" (
  "id", "tenantId", "loanId", "actorUserId", "action", "entityType", "entityId",
  "expectedLoanVersion", "reasonCode", "ruleVersion", "schemaVersion", "requestId",
  "resultHash", "eventHash"
) VALUES
  ('a7000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003',
   'a7000000-0000-4000-8000-000000000002', 'INCOME_APPROVED', 'FORM_1084_AUDIT', 'a7000000-0000-4000-8000-000000000009',
   1, 'UNDERWRITER_CONFIRMED', 'form-1084-v9', 'audit-event-v1', 'webhook-approval-a', repeat('e7', 32), repeat('e8', 32)),
  ('b7000000-0000-4000-8000-000000000004', 'b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003',
   'b7000000-0000-4000-8000-000000000002', 'INCOME_APPROVED', 'FORM_1084_AUDIT', 'b7000000-0000-4000-8000-000000000009',
   1, 'UNDERWRITER_CONFIRMED', 'form-1084-v9', 'audit-event-v1', 'webhook-approval-b', repeat('f7', 32), repeat('f8', 32));

INSERT INTO "outbound_webhook_endpoints" (
  "id", "tenantId", "url", "signingSecretRef", "createdByUserId", "updatedByUserId", "updatedAt"
) VALUES
  ('a7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000001', 'https://hooks.example.test/freeflow',
   'local-dev:a7000000-0000-4000-8000-000000000001/a7000000-0000-4000-8000-000000000005',
   'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002', now()),
  ('b7000000-0000-4000-8000-000000000005', 'b7000000-0000-4000-8000-000000000001', 'https://hooks.example.test/tenant-b',
   'arn:aws:secretsmanager:us-west-2:123456789012:secret:freeflow-dev/outbound-webhooks/b7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000005-AbCdEf',
   'b7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000002', now());

INSERT INTO "outbound_webhook_deliveries" (
  "id", "tenantId", "loanId", "endpointId", "approvalEventId", "requestedByUserId",
  "eventType", "approvedLoanVersion", "correlationId", "updatedAt"
) VALUES
  ('a7000000-0000-4000-8000-000000000006', 'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003',
   'a7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000002',
   'income.approved', 1, 'webhook-approval-a', now()),
  ('b7000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003',
   'b7000000-0000-4000-8000-000000000005', 'b7000000-0000-4000-8000-000000000004', 'b7000000-0000-4000-8000-000000000002',
   'income.approved', 1, 'webhook-approval-b', now());

DO $webhook_schema_controls$
DECLARE
  unprotected integer;
BEGIN
  SELECT count(*) INTO unprotected
  FROM pg_class
  WHERE oid IN (
    'public.outbound_webhook_endpoints'::regclass,
    'public.outbound_webhook_deliveries'::regclass,
    'public.outbound_webhook_endpoint_audit_events'::regclass
  ) AND (NOT relrowsecurity OR NOT relforcerowsecurity);
  IF unprotected <> 0 THEN
    RAISE EXCEPTION 'Outbound webhook tables do not force row-level security';
  END IF;

  IF has_column_privilege('freeflow_app', 'outbound_webhook_endpoints', 'signingSecretRef', 'UPDATE')
    OR has_column_privilege('freeflow_app', 'outbound_webhook_endpoints', 'tenantId', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'outbound_webhook_endpoints', 'DELETE')
    OR NOT has_column_privilege('freeflow_app', 'outbound_webhook_endpoints', 'url', 'UPDATE') THEN
    RAISE EXCEPTION 'freeflow_app endpoint grants are not least privilege';
  END IF;
  IF has_column_privilege('freeflow_app', 'outbound_webhook_deliveries', 'approvalEventId', 'UPDATE')
    OR has_column_privilege('freeflow_app', 'outbound_webhook_deliveries', 'deliveredSnapshotHash', 'UPDATE')
    OR has_column_privilege('freeflow_app', 'outbound_webhook_deliveries', 'lastResponseStatus', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'outbound_webhook_deliveries', 'DELETE')
    OR NOT has_column_privilege('freeflow_app', 'outbound_webhook_deliveries', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'freeflow_app delivery grants are not least privilege';
  END IF;
  IF has_table_privilege('freeflow_app', 'outbound_webhook_endpoint_audit_events', 'UPDATE')
    OR has_table_privilege('freeflow_app', 'outbound_webhook_endpoint_audit_events', 'DELETE')
    OR NOT has_table_privilege('freeflow_app', 'outbound_webhook_endpoint_audit_events', 'INSERT') THEN
    RAISE EXCEPTION 'freeflow_app endpoint audit grants are not append-only';
  END IF;
  IF has_table_privilege('freeflow_worker', 'outbound_webhook_deliveries', 'INSERT')
    OR has_table_privilege('freeflow_worker', 'outbound_webhook_deliveries', 'DELETE')
    OR has_column_privilege('freeflow_worker', 'outbound_webhook_deliveries', 'approvalEventId', 'UPDATE')
    OR has_column_privilege('freeflow_worker', 'outbound_webhook_deliveries', 'endpointId', 'UPDATE')
    OR NOT has_column_privilege('freeflow_worker', 'outbound_webhook_deliveries', 'deliveredSnapshotHash', 'UPDATE') THEN
    RAISE EXCEPTION 'freeflow_worker delivery grants are not least privilege';
  END IF;
  IF has_table_privilege('freeflow_worker', 'outbound_webhook_endpoints', 'INSERT')
    OR has_table_privilege('freeflow_worker', 'outbound_webhook_endpoints', 'UPDATE')
    OR has_table_privilege('freeflow_worker', 'outbound_webhook_endpoint_audit_events', 'SELECT') THEN
    RAISE EXCEPTION 'freeflow_worker can change webhook configuration or read its audit';
  END IF;
  IF has_table_privilege('freeflow_readonly', 'outbound_webhook_deliveries', 'SELECT')
    OR has_table_privilege('freeflow_readonly', 'outbound_webhook_endpoints', 'SELECT') THEN
    RAISE EXCEPTION 'freeflow_readonly can read webhook tables';
  END IF;

  BEGIN
    INSERT INTO "outbound_webhook_endpoints" (
      "tenantId", "url", "signingSecretRef", "createdByUserId", "updatedByUserId", "updatedAt"
    ) VALUES (
      'a7000000-0000-4000-8000-000000000001', 'http://hooks.example.test/plain',
      'local-dev:a7000000-0000-4000-8000-000000000001/a7000000-0000-4000-8000-0000000000ff',
      'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002', now()
    );
    RAISE EXCEPTION 'A non-HTTPS webhook URL was stored';
  EXCEPTION WHEN check_violation OR unique_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE "outbound_webhook_deliveries" SET "safeErrorCode" = 'contains borrower text'
    WHERE "id" = 'a7000000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'An unsafe delivery error code was stored';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$webhook_schema_controls$;

SET ROLE freeflow_app;

DO $app_webhook_isolation$
DECLARE
  visible integer;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.outbound_webhook_dispatch_scan', 'on', true);
  SELECT count(*) INTO visible FROM "outbound_webhook_deliveries";
  IF visible <> 0 THEN
    RAISE EXCEPTION 'The dispatch scan exposed % deliveries to freeflow_app', visible;
  END IF;
  PERFORM set_config('app.outbound_webhook_dispatch_scan', '', true);

  PERFORM set_config('app.tenant_id', 'a7000000-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO visible FROM "outbound_webhook_deliveries";
  IF visible <> 1 THEN
    RAISE EXCEPTION 'Tenant A saw % deliveries instead of its own one', visible;
  END IF;
  SELECT count(*) INTO visible FROM "outbound_webhook_endpoints";
  IF visible <> 1 THEN
    RAISE EXCEPTION 'Tenant A saw % webhook endpoints instead of its own one', visible;
  END IF;

  BEGIN
    INSERT INTO "outbound_webhook_deliveries" (
      "tenantId", "loanId", "endpointId", "approvalEventId", "requestedByUserId",
      "eventType", "approvedLoanVersion", "correlationId", "status", "updatedAt"
    ) VALUES (
      'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003',
      'a7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000004',
      'a7000000-0000-4000-8000-000000000002', 'income.approved', 1, 'forged-success', 'SUCCEEDED', now()
    );
    RAISE EXCEPTION 'freeflow_app created a delivery that was not pending';
  EXCEPTION WHEN object_not_in_prerequisite_state OR unique_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE "outbound_webhook_deliveries" SET "status" = 'SUCCEEDED'
    WHERE "id" = 'a7000000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'freeflow_app marked a delivery as succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  BEGIN
    UPDATE "outbound_webhook_endpoints" SET "version" = "version" + 2
    WHERE "id" = 'a7000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'freeflow_app skipped an endpoint version';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  BEGIN
    UPDATE "outbound_webhook_endpoints" SET "signingSecretRef" = 'local-dev:x'
    WHERE "id" = 'a7000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'freeflow_app replaced the signing secret reference';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO "outbound_webhook_endpoints" (
      "tenantId", "url", "signingSecretRef", "createdByUserId", "updatedByUserId", "updatedAt"
    ) VALUES (
      'b7000000-0000-4000-8000-000000000001', 'https://attacker.example.test/hook',
      'local-dev:b7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-0000000000ff',
      'b7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000002', now()
    );
    RAISE EXCEPTION 'freeflow_app configured another tenant''s webhook';
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN
    NULL;
  END;

  INSERT INTO "outbound_webhook_endpoint_audit_events" (
    "tenantId", "endpointId", "actorUserId", "action", "endpointVersion", "urlHost", "urlHash",
    "isEnabled", "signingSecretVersion", "requestId", "authTime"
  ) VALUES (
    'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000005',
    'a7000000-0000-4000-8000-000000000002', 'WEBHOOK_ENDPOINT_CREATED', 1, 'hooks.example.test',
    repeat('5', 64), true, 1, 'webhook-sql-test', now()
  );
  BEGIN
    UPDATE "outbound_webhook_endpoint_audit_events" SET "isEnabled" = false
    WHERE "endpointId" = 'a7000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'freeflow_app rewrote a webhook endpoint audit event';
  EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state THEN
    NULL;
  END;
  PERFORM set_config('app.tenant_id', '', true);
END
$app_webhook_isolation$;

RESET ROLE;
SET ROLE freeflow_worker;

DO $worker_webhook_dispatch$
DECLARE
  visible integer;
  changed integer;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO visible FROM "outbound_webhook_deliveries";
  IF visible <> 0 THEN
    RAISE EXCEPTION 'Deliveries were visible to the worker without tenant context or scan mode';
  END IF;

  PERFORM set_config('app.outbound_webhook_dispatch_scan', 'on', true);
  SELECT count(*) INTO visible FROM "outbound_webhook_deliveries"
  WHERE "id" IN ('a7000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000006');
  IF visible <> 2 THEN
    RAISE EXCEPTION 'The dispatch scan exposed % of 2 due deliveries', visible;
  END IF;
  SELECT count(*) INTO visible FROM "outbound_webhook_endpoints";
  IF visible <> 0 THEN
    RAISE EXCEPTION 'The dispatch scan exposed webhook endpoints';
  END IF;
  SELECT count(*) INTO visible FROM "loan_applications";
  IF visible <> 0 THEN
    RAISE EXCEPTION 'The dispatch scan exposed loans';
  END IF;
  UPDATE "outbound_webhook_deliveries" SET "status" = 'IN_PROGRESS'
  WHERE "id" = 'b7000000-0000-4000-8000-000000000006';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'The dispatch scan allowed a delivery update without tenant context';
  END IF;
  PERFORM set_config('app.outbound_webhook_dispatch_scan', '', true);

  PERFORM set_config('app.tenant_id', 'a7000000-0000-4000-8000-000000000001', true);
  UPDATE "outbound_webhook_deliveries"
  SET "status" = 'FAILED', "attemptCount" = 8, "safeErrorCode" = 'RECEIVER_REJECTED',
      "lastResponseStatus" = 410, "completedAt" = now()
  WHERE "id" = 'a7000000-0000-4000-8000-000000000006';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'freeflow_worker could not record a terminal delivery outcome';
  END IF;
  BEGIN
    UPDATE "outbound_webhook_deliveries" SET "approvalEventId" = 'b7000000-0000-4000-8000-000000000004'
    WHERE "id" = 'a7000000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'freeflow_worker retargeted a delivery to another approval';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE "outbound_webhook_endpoints" SET "url" = 'https://attacker.example.test/hook'
    WHERE "id" = 'a7000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'freeflow_worker changed a webhook destination';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.outbound_webhook_dispatch_scan', 'on', true);
  SELECT count(*) INTO visible FROM "outbound_webhook_deliveries"
  WHERE "id" = 'a7000000-0000-4000-8000-000000000006';
  IF visible <> 0 THEN
    RAISE EXCEPTION 'The dispatch scan exposed a finished delivery';
  END IF;
  PERFORM set_config('app.outbound_webhook_dispatch_scan', '', true);
END
$worker_webhook_dispatch$;

RESET ROLE;
SET ROLE freeflow_app;

DO $app_webhook_redelivery$
DECLARE
  changed integer;
BEGIN
  PERFORM set_config('app.tenant_id', 'a7000000-0000-4000-8000-000000000001', true);
  BEGIN
    UPDATE "outbound_webhook_deliveries" SET "status" = 'PENDING', "attemptCount" = 3,
      "safeErrorCode" = NULL, "completedAt" = NULL
    WHERE "id" = 'a7000000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'freeflow_app redelivered without resetting attempts';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  UPDATE "outbound_webhook_deliveries"
  SET "status" = 'PENDING', "attemptCount" = 0, "nextAttemptAt" = now(), "claimToken" = NULL,
      "safeErrorCode" = NULL, "completedAt" = NULL
  WHERE "id" = 'a7000000-0000-4000-8000-000000000006';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'freeflow_app could not request redelivery of a failed delivery';
  END IF;
  PERFORM set_config('app.tenant_id', '', true);
END
$app_webhook_redelivery$;

RESET ROLE;
ROLLBACK;

SELECT 'outbound webhook isolation verified' AS result;
