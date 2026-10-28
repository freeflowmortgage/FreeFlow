-- Outbound webhooks for approved standalone income. The endpoint stores only a
-- Secrets Manager reference, and the delivery row is an identifiers-and-status
-- outbox: the payload is rebuilt from the approved snapshot at send time.
CREATE TYPE "OutboundWebhookDeliveryStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'RETRYABLE_FAILURE',
  'SUCCEEDED',
  'FAILED',
  'SUPERSEDED'
);

CREATE TABLE "outbound_webhook_endpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "signingSecretRef" VARCHAR(512) NOT NULL,
  "signingSecretVersion" INTEGER NOT NULL DEFAULT 1,
  "signingSecretRotatedAt" TIMESTAMPTZ,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "outbound_webhook_endpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_webhook_endpoints_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_endpoints_creator_fkey"
    FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_endpoints_updater_fkey"
    FOREIGN KEY ("tenantId", "updatedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_endpoints_https_url"
    CHECK ("url" ~ '^https://[^[:space:]@#?]{1,2040}$'),
  CONSTRAINT "outbound_webhook_endpoints_secret_reference_format"
    CHECK ("signingSecretRef" ~ '^(arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,400}|local-dev:[0-9a-f-]{36}/[0-9a-f-]{36})$'),
  CONSTRAINT "outbound_webhook_endpoints_versions_positive"
    CHECK ("version" > 0 AND "signingSecretVersion" > 0)
);

CREATE UNIQUE INDEX "outbound_webhook_endpoints_tenant_key"
  ON "outbound_webhook_endpoints"("tenantId");
CREATE UNIQUE INDEX "outbound_webhook_endpoints_tenant_id_key"
  ON "outbound_webhook_endpoints"("tenantId", "id");

CREATE TABLE "outbound_webhook_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "endpointId" UUID NOT NULL,
  "approvalEventId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "eventType" VARCHAR(64) NOT NULL,
  "approvedLoanVersion" INTEGER NOT NULL,
  "correlationId" VARCHAR(100) NOT NULL,
  "status" "OutboundWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimToken" UUID,
  "startedAt" TIMESTAMPTZ,
  "lastAttemptAt" TIMESTAMPTZ,
  "lastResponseStatus" INTEGER,
  "safeErrorCode" VARCHAR(100),
  "deliveredSnapshotHash" CHAR(64),
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "outbound_webhook_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_webhook_deliveries_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_deliveries_loan_fkey"
    FOREIGN KEY ("tenantId", "loanId") REFERENCES "loan_applications"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_deliveries_endpoint_fkey"
    FOREIGN KEY ("tenantId", "endpointId") REFERENCES "outbound_webhook_endpoints"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_deliveries_approval_fkey"
    FOREIGN KEY ("tenantId", "approvalEventId") REFERENCES "audit_events"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_deliveries_requester_fkey"
    FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_deliveries_event_type_allowed"
    CHECK ("eventType" IN ('income.approved')),
  CONSTRAINT "outbound_webhook_deliveries_loan_version_positive"
    CHECK ("approvedLoanVersion" > 0),
  CONSTRAINT "outbound_webhook_deliveries_attempts_bounded"
    CHECK ("attemptCount" BETWEEN 0 AND 100),
  CONSTRAINT "outbound_webhook_deliveries_correlation_id_format"
    CHECK ("correlationId" ~ '^[A-Za-z0-9._:-]{1,100}$'),
  CONSTRAINT "outbound_webhook_deliveries_safe_error_code_format"
    CHECK ("safeErrorCode" IS NULL OR "safeErrorCode" ~ '^[A-Z0-9_]{1,100}$'),
  CONSTRAINT "outbound_webhook_deliveries_response_status_range"
    CHECK ("lastResponseStatus" IS NULL OR "lastResponseStatus" BETWEEN 100 AND 599),
  CONSTRAINT "outbound_webhook_deliveries_snapshot_hash_format"
    CHECK ("deliveredSnapshotHash" IS NULL OR "deliveredSnapshotHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "outbound_webhook_deliveries_tenant_id_key"
  ON "outbound_webhook_deliveries"("tenantId", "id");
CREATE UNIQUE INDEX "outbound_webhook_deliveries_tenant_endpoint_approval_key"
  ON "outbound_webhook_deliveries"("tenantId", "endpointId", "approvalEventId");
CREATE INDEX "outbound_webhook_deliveries_tenant_created_idx"
  ON "outbound_webhook_deliveries"("tenantId", "createdAt", "id");
CREATE INDEX "outbound_webhook_deliveries_tenant_loan_created_idx"
  ON "outbound_webhook_deliveries"("tenantId", "loanId", "createdAt");
CREATE INDEX "outbound_webhook_deliveries_status_due_idx"
  ON "outbound_webhook_deliveries"("status", "nextAttemptAt");

CREATE TABLE "outbound_webhook_endpoint_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "endpointId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "endpointVersion" INTEGER NOT NULL,
  "urlHost" VARCHAR(255) NOT NULL,
  "urlHash" CHAR(64) NOT NULL,
  "isEnabled" BOOLEAN NOT NULL,
  "signingSecretVersion" INTEGER NOT NULL,
  "requestId" VARCHAR(100) NOT NULL,
  "authTime" TIMESTAMPTZ NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "outbound_webhook_endpoint_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_webhook_endpoint_audits_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_endpoint_audits_endpoint_fkey"
    FOREIGN KEY ("tenantId", "endpointId") REFERENCES "outbound_webhook_endpoints"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_endpoint_audits_actor_fkey"
    FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_webhook_endpoint_audits_action_allowed"
    CHECK ("action" IN (
      'WEBHOOK_ENDPOINT_CREATED',
      'WEBHOOK_ENDPOINT_UPDATED',
      'WEBHOOK_ENDPOINT_SECRET_ROTATED'
    )),
  CONSTRAINT "outbound_webhook_endpoint_audits_url_host_format"
    CHECK ("urlHost" ~ '^[a-z0-9.:\[\]-]{1,255}$'),
  CONSTRAINT "outbound_webhook_endpoint_audits_url_hash_format"
    CHECK ("urlHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "outbound_webhook_endpoint_audits_versions_positive"
    CHECK ("endpointVersion" > 0 AND "signingSecretVersion" > 0),
  CONSTRAINT "outbound_webhook_endpoint_audits_request_id_format"
    CHECK ("requestId" ~ '^[A-Za-z0-9._:-]{1,100}$')
);

CREATE INDEX "outbound_webhook_endpoint_audits_tenant_endpoint_idx"
  ON "outbound_webhook_endpoint_audit_events"("tenantId", "endpointId", "occurredAt");

-- Endpoint identity and secret reference are fixed at creation. Rotation
-- writes a new value to the same secret and increments the counter.
CREATE OR REPLACE FUNCTION app.enforce_outbound_webhook_endpoint_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW."signingSecretRef" IS DISTINCT FROM OLD."signingSecretRef"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'outbound webhook endpoint identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'outbound webhook endpoint updates must advance the version by one'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."signingSecretVersion" < OLD."signingSecretVersion"
    OR NEW."signingSecretVersion" > OLD."signingSecretVersion" + 1 THEN
    RAISE EXCEPTION 'outbound webhook signing secret version may only advance by one'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION app.enforce_outbound_webhook_endpoint_update() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.enforce_outbound_webhook_endpoint_update() FROM PUBLIC;

CREATE TRIGGER outbound_webhook_endpoint_update_guard
BEFORE UPDATE ON "outbound_webhook_endpoints"
FOR EACH ROW EXECUTE FUNCTION app.enforce_outbound_webhook_endpoint_update();

-- Deliveries are created pending with immutable identity. The application may
-- only request redelivery of a finished delivery; attempts, claims, and
-- outcomes belong to the worker.
CREATE OR REPLACE FUNCTION app.enforce_outbound_webhook_delivery_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING'
      OR NEW."attemptCount" <> 0
      OR NEW."claimToken" IS NOT NULL
      OR NEW."startedAt" IS NOT NULL
      OR NEW."lastAttemptAt" IS NOT NULL
      OR NEW."lastResponseStatus" IS NOT NULL
      OR NEW."safeErrorCode" IS NOT NULL
      OR NEW."deliveredSnapshotHash" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL
    THEN
      RAISE EXCEPTION 'outbound webhook deliveries must be created pending'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW."loanId" IS DISTINCT FROM OLD."loanId"
    OR NEW."endpointId" IS DISTINCT FROM OLD."endpointId"
    OR NEW."approvalEventId" IS DISTINCT FROM OLD."approvalEventId"
    OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId"
    OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
    OR NEW."approvedLoanVersion" IS DISTINCT FROM OLD."approvedLoanVersion"
    OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'outbound webhook delivery identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF pg_has_role(current_user, 'freeflow_app', 'USAGE')
    AND NOT pg_has_role(current_user, 'freeflow_worker', 'USAGE')
    AND (
      OLD."status" NOT IN ('SUCCEEDED', 'FAILED')
      OR NEW."status" <> 'PENDING'
      OR NEW."attemptCount" <> 0
      OR NEW."claimToken" IS NOT NULL
      OR NEW."safeErrorCode" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'application role may only request redelivery of a finished webhook delivery'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION app.enforce_outbound_webhook_delivery_transition() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.enforce_outbound_webhook_delivery_transition() FROM PUBLIC;

CREATE TRIGGER outbound_webhook_delivery_transition_guard
BEFORE INSERT OR UPDATE ON "outbound_webhook_deliveries"
FOR EACH ROW EXECUTE FUNCTION app.enforce_outbound_webhook_delivery_transition();

CREATE OR REPLACE FUNCTION app.reject_outbound_webhook_endpoint_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'outbound webhook endpoint audit events are append-only'
    USING ERRCODE = '55000';
END;
$$;

ALTER FUNCTION app.reject_outbound_webhook_endpoint_audit_mutation() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.reject_outbound_webhook_endpoint_audit_mutation() FROM PUBLIC;

CREATE TRIGGER outbound_webhook_endpoint_audit_reject_mutation
BEFORE UPDATE OR DELETE ON "outbound_webhook_endpoint_audit_events"
FOR EACH ROW EXECUTE FUNCTION app.reject_outbound_webhook_endpoint_audit_mutation();

ALTER TABLE "outbound_webhook_endpoints" OWNER TO freeflow_owner;
ALTER TABLE "outbound_webhook_deliveries" OWNER TO freeflow_owner;
ALTER TABLE "outbound_webhook_endpoint_audit_events" OWNER TO freeflow_owner;

ALTER TABLE "outbound_webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_webhook_endpoints" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbound_webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_webhook_deliveries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbound_webhook_endpoint_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_webhook_endpoint_audit_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "outbound_webhook_endpoints"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));
CREATE POLICY tenant_isolation ON "outbound_webhook_deliveries"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));
CREATE POLICY tenant_isolation ON "outbound_webhook_endpoint_audit_events"
  USING ("tenantId" = app.safe_uuid_setting('app.tenant_id'))
  WITH CHECK ("tenantId" = app.safe_uuid_setting('app.tenant_id'));

-- The dispatcher must find due work before it knows which tenant owns it. This
-- read-only policy is limited to the worker role, to unfinished rows, and to a
-- transaction that explicitly opts in. Each row is then claimed and processed
-- under that row's own tenant context.
CREATE POLICY worker_due_delivery_discovery ON "outbound_webhook_deliveries"
  FOR SELECT
  TO freeflow_worker
  USING (
    current_setting('app.outbound_webhook_dispatch_scan', true) = 'on'
    AND "status" IN ('PENDING', 'RETRYABLE_FAILURE', 'IN_PROGRESS')
  );

REVOKE ALL ON "outbound_webhook_endpoints" FROM PUBLIC;
REVOKE ALL ON "outbound_webhook_deliveries" FROM PUBLIC;
REVOKE ALL ON "outbound_webhook_endpoint_audit_events" FROM PUBLIC;

GRANT SELECT, INSERT ON "outbound_webhook_endpoints" TO freeflow_app;
GRANT UPDATE (
  "url", "isEnabled", "signingSecretVersion", "signingSecretRotatedAt",
  "version", "updatedByUserId", "updatedAt"
) ON "outbound_webhook_endpoints" TO freeflow_app;
GRANT SELECT ON "outbound_webhook_endpoints" TO freeflow_worker;

GRANT SELECT, INSERT ON "outbound_webhook_deliveries" TO freeflow_app;
GRANT UPDATE (
  "status", "attemptCount", "nextAttemptAt", "claimToken", "safeErrorCode",
  "completedAt", "updatedAt"
) ON "outbound_webhook_deliveries" TO freeflow_app;
GRANT SELECT ON "outbound_webhook_deliveries" TO freeflow_worker;
GRANT UPDATE (
  "status", "attemptCount", "nextAttemptAt", "claimToken", "startedAt",
  "lastAttemptAt", "lastResponseStatus", "safeErrorCode", "deliveredSnapshotHash",
  "completedAt", "updatedAt"
) ON "outbound_webhook_deliveries" TO freeflow_worker;

GRANT SELECT, INSERT ON "outbound_webhook_endpoint_audit_events" TO freeflow_app;

COMMENT ON COLUMN "outbound_webhook_endpoints"."signingSecretRef" IS
  'Secrets Manager reference only. The signing secret value is never stored in the database.';
COMMENT ON TABLE "outbound_webhook_deliveries" IS
  'Identifiers and safe status only. Payloads, URLs, response bodies, and borrower data are never stored here.';

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_allowed";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_allowed" CHECK ("action" IN (
  'STANDALONE_LOAN_CREATED',
  'INCOME_CALCULATION_COMPLETED', 'INCOME_APPROVED', 'INCOME_OVERRIDE',
  'ENCOMPASS_DOCUMENT_PULL_QUEUED', 'ENCOMPASS_DOCUMENT_PULL_SUCCEEDED', 'ENCOMPASS_DOCUMENT_PULL_FAILED',
  'ENCOMPASS_SYNC_QUEUED', 'ENCOMPASS_SYNC_SUCCEEDED', 'ENCOMPASS_SYNC_FAILED',
  'EXTRACTION_METADATA_REVIEWED', 'ENCOMPASS_HOST_WRITE_AUTHORIZED',
  'ENCOMPASS_HOST_WRITE_SUCCEEDED', 'ENCOMPASS_HOST_WRITE_FAILED',
  'OUTBOUND_WEBHOOK_QUEUED', 'OUTBOUND_WEBHOOK_DELIVERED', 'OUTBOUND_WEBHOOK_FAILED',
  'OUTBOUND_WEBHOOK_SUPERSEDED', 'OUTBOUND_WEBHOOK_REDELIVERY_REQUESTED'
));
