-- Standalone intake is an authenticated, tenant-scoped mutation. Record its
-- creation as an immutable audit event without relaxing any existing action.
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_allowed";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_allowed" CHECK ("action" IN (
  'STANDALONE_LOAN_CREATED',
  'INCOME_CALCULATION_COMPLETED', 'INCOME_APPROVED', 'INCOME_OVERRIDE',
  'ENCOMPASS_DOCUMENT_PULL_QUEUED', 'ENCOMPASS_SYNC_QUEUED',
  'ENCOMPASS_SYNC_SUCCEEDED', 'ENCOMPASS_SYNC_FAILED',
  'EXTRACTION_METADATA_REVIEWED', 'ENCOMPASS_HOST_WRITE_AUTHORIZED',
  'ENCOMPASS_HOST_WRITE_SUCCEEDED', 'ENCOMPASS_HOST_WRITE_FAILED'
));
