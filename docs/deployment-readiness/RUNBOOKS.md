# Production Runbooks

Every execution records incident/change ID, operator, timestamps, environment,
git SHA, image digests, migration version, evidence links, and outcome. Commands
must be generated from the chosen IaC/CI system; do not copy placeholder ARNs or
credentials from documentation.

## Deploy and verify

**Preconditions:** approved change, green release gates, immutable signed image
digests, completed ECR scan, backward-compatible migration, staging evidence,
healthy backups, and named rollback owner.

1. Confirm production plan changes only approved resources and image digests.
2. Run the one-off migration task with the migrator role. Verify its exit code,
   migration ledger, schema compatibility, RLS tests, and no long blocking lock.
3. Deploy parser and worker-compatible changes before portal code that requires
   them. Enable ECS deployment circuit-breaker rollback and alarm rollback.
4. Watch target health, deployment events, 5xx/latency, task restarts, DB pool,
   queue age, parser errors, auth denials, and log-redaction alarms.
5. Run authenticated synthetic smoke tests plus anonymous/forged-tenant negative
   tests. Use synthetic data only.
6. Confirm audit events, one idempotent sync in the Encompass sandbox, webhook
   deduplication, and absence of document/OCR content in logs/queues/storage.
7. Record the stable digest/task-definition revision and close the change after
   the observation window.

## Roll back application

1. Declare/associate incident and freeze additional deployments.
2. If automatic rollback has not started, redeploy the last-known-good task
   definition by digest. Do not rebuild or use a mutable tag.
3. Keep additive database changes in place. Never down-migrate destructively
   during an outage unless the database owner approves a tested recovery plan.
4. If the new version emitted incompatible work, pause affected SQS consumers;
   preserve identifiers and safe error metadata, never raw documents.
5. Verify authentication negatives, tenant isolation, health, core calculation,
   queue age, and error rate. Document data reconciliation required after recovery.

## Rotate a secret

1. Identify consuming task roles/services and provider coordination requirements.
2. Create a new Secrets Manager version; support overlap where the provider allows.
3. Force a new deployment of each consumer because ECS environment-injected
   secrets do not refresh in running tasks.
4. Verify new tasks, provider authentication, and absence of auth-error increase.
5. Revoke the old credential, monitor, and record rotation evidence. If exposure
   is suspected, follow the incident runbook and rotate signing/encryption material
   according to its dedicated cryptographic migration plan.

## Authentication or cross-tenant incident

1. Page security/on-call; preserve CloudTrail, WAF, ALB, application, database,
   and audit logs under legal guidance. Never copy raw borrower content to tickets.
2. Contain: disable the affected route/permission or ALB rule; revoke sessions,
   links, and credentials as scoped. Prefer targeted containment to destroying data.
3. Determine verified subjects, tenants, object IDs, actions, and time range from
   audit IDs and hashes. Treat caller-provided identity fields as untrusted.
4. Check Encompass writes, billing effects, exports, and share-link uses. Reconcile
   with authoritative provider records.
5. Notify privacy/legal/compliance and affected parties according to approved
   obligations. Engineering does not invent notification thresholds during an incident.
6. Patch, add a regression test reproducing the boundary failure, deploy, monitor,
   and complete root-cause/corrective-action review.

## Suspected raw-document/OCR retention

1. Stop the offending workflow and isolate affected tasks/queues/log groups while
   preserving legally required evidence.
2. Identify every sink: container filesystem, crash dump, log, trace, SQS/DLQ,
   Redis, database, object store, CI artifact, and support ticket.
3. Engage security/privacy/legal to determine controlled deletion versus evidence
   preservation. Do not manually purge a production store without authorization.
4. Rotate credentials if the content or logs exposed secrets. Correct the path,
   add automated canary-marker assertions, and prove new runs leave no prohibited data.
5. Record scope, retention duration, deletion verification, and prevention changes.

## SQS backlog or DLQ

1. Alarm on oldest-message age and any DLQ message. Check worker health,
   deployment, provider status/rate limits, database saturation, and safe error codes.
2. Pause redrive if failures are deterministic, authorization-related, or could
   repeat an external write. Scale only when downstream capacity and rate policy allow.
3. For an unknown external outcome, reconcile by idempotency/correlation ID before
   retry. Never blindly replay Encompass writes.
4. Fix and deploy. Redrive a bounded sample, validate state/audit, then redrive in
   controlled batches. Queue/DLQ payloads must contain identifiers only.

## Database restore drill

1. Select a recovery point and restore into an isolated account/VPC with no
   provider egress and no production credentials.
2. Record restore start/end and achieved RPO. Apply only migrations compatible
   with the application digest being tested.
3. Validate encryption, row/table counts, constraints, schema drift, RLS/FORCE
   RLS, append-only triggers, and representative tenant-negative queries.
4. Run synthetic application smoke tests, audit-chain checks, and billing/sync
   reconciliation in disabled/dry-run mode.
5. Destroy the isolated restore through approved IaC retention workflow after the
   evidence period. Track actual RTO/RPO and remediate misses.

## Dependency or image vulnerability

1. Confirm affected digest/package/runtime and exploit preconditions from primary
   vendor/advisory sources. Do not dismiss a scanner result without evidence.
2. For exploited or critical exposure, contain and rotate relevant credentials;
   otherwise set severity/SLA under vulnerability policy.
3. Update direct/transitive dependency or base digest, run the complete regression
   and parser corpus, produce new SBOM, scan, sign, and deploy the new digest.
4. Verify old vulnerable tasks are drained and the old digest cannot be promoted.
   Preserve the exception record if risk was temporarily accepted.

## Encompass outage

1. Stop new sync dispatch while preserving approved job identifiers. Continue
   review/calculation only if the UI clearly states sync is delayed.
2. Monitor provider status and exponential backoff. Do not store source PDFs or
   raw XML locally as a workaround.
3. On recovery, reconcile ambiguous external outcomes before retry, drain at an
   approved rate, and verify approval versions are still current.
