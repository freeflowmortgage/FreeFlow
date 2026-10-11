-- Reviewer-approved values and their exact destination are insert-only facts.
-- Both application and worker roles retain status/reconciliation updates, but
-- neither can retarget or rewrite a stored approval after insertion.
CREATE OR REPLACE FUNCTION app.enforce_encompass_sync_approval_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."writePreviewSchemaVersion" IS DISTINCT FROM OLD."writePreviewSchemaVersion"
    OR NEW."writePreviewHash" IS DISTINCT FROM OLD."writePreviewHash"
    OR NEW."writePreviewFields" IS DISTINCT FROM OLD."writePreviewFields"
    OR NEW."writeTargetIntegrationMode" IS DISTINCT FROM OLD."writeTargetIntegrationMode"
    OR NEW."writeTargetLenderId" IS DISTINCT FROM OLD."writeTargetLenderId"
    OR NEW."writeTargetDeploymentId" IS DISTINCT FROM OLD."writeTargetDeploymentId"
    OR NEW."writeTargetEncompassGuid" IS DISTINCT FROM OLD."writeTargetEncompassGuid"
  THEN
    RAISE EXCEPTION 'encompass sync approval preview and target are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF pg_has_role(current_user, 'freeflow_app', 'USAGE')
    AND NOT pg_has_role(current_user, 'freeflow_worker', 'USAGE')
    AND (
      OLD."status" NOT IN ('QUEUED', 'RETRYABLE_FAILURE')
      OR NEW."status" <> 'RETRYABLE_FAILURE'
      OR NEW."safeErrorCode" IS DISTINCT FROM 'QUEUE_PUBLISH_FAILED'
    )
  THEN
    RAISE EXCEPTION 'application role may only record a sync queue publication failure'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION app.enforce_encompass_sync_approval_immutable() OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.enforce_encompass_sync_approval_immutable() FROM PUBLIC;

CREATE TRIGGER encompass_sync_approval_immutable
BEFORE UPDATE ON "encompass_sync_jobs"
FOR EACH ROW EXECUTE FUNCTION app.enforce_encompass_sync_approval_immutable();

-- The worker consumes existing outbox rows; it never creates reviewer approval
-- facts. Both roles receive only the mutable columns required by their code.
REVOKE INSERT ON "encompass_sync_jobs" FROM freeflow_worker;
REVOKE UPDATE ON "encompass_sync_jobs" FROM freeflow_app, freeflow_worker;
GRANT UPDATE ("status", "safeErrorCode", "updatedAt")
  ON "encompass_sync_jobs" TO freeflow_app;
GRANT UPDATE (
  "status", "attemptCount", "reconciliationCount", "safeErrorCode",
  "providerRevision", "fieldReadback", "startedAt", "completedAt", "updatedAt"
) ON "encompass_sync_jobs" TO freeflow_worker;
