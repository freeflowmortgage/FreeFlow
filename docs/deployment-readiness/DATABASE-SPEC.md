# Database Specification

## Current-state decision

The existing Prisma schema is a design input, not a production baseline. The
running development PostgreSQL instance contains no application tables and the
repository has no ordered migrations. APIs also reference missing tables and
columns. Production data work must therefore start with an explicit versioned
baseline migration; `prisma db push` is prohibited outside disposable local use.

## Production platform

- Amazon RDS for PostgreSQL 16 or the current organization-approved supported
  major, private subnets across at least two Availability Zones, Multi-AZ,
  customer-managed KMS encryption, deletion protection, automated backups, and
  point-in-time recovery.
- TLS is required (`rds.force_ssl=1`), certificate validation is required, and
  clients use a current AWS RDS trust bundle.
- RDS Proxy is optional. Adopt it only after load testing ORM connection behavior
  and transaction-local RLS context; it must require TLS and use least-privilege
  credentials or IAM database authentication where supported by the chosen
  client path.
- Security-group ingress comes only from approved application/worker security
  groups and the controlled migration task. No public endpoint.

References: [RDS PostgreSQL SSL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html) and
[RDS Proxy security](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.howitworks.html).

## Roles

| Role | Purpose | Restrictions |
|---|---|---|
| `freeflow_owner` | Owns schema objects | No application login; break-glass only |
| `freeflow_migrator` | Executes reviewed migrations | Assumed only by one-off ECS migration task |
| `freeflow_app` | Portal transactions | No ownership, superuser, `BYPASSRLS`, DDL, or unrestricted table grants |
| `freeflow_worker` | Queue/sync transactions | Same restrictions; only necessary tables/actions |
| `freeflow_readonly` | Approved operational diagnostics | RLS constrained; time-bound access; no raw sensitive columns |

Normal services MUST NOT use the PostgreSQL superuser or a Supabase service-role
key. Credentials are unique per environment and role.

## Minimum logical model

All IDs are UUID/ULID, all timestamps are UTC `timestamptz`, money is integer
cents, ratios/rates use bounded numeric types, and every mutable table has a
monotonic `version` for optimistic concurrency.

| Table | Required purpose and constraints |
|---|---|
| `tenants` | Organization state, policy version, status; unique stable slug |
| `principals` | Verified OIDC subject and issuer; unique `(issuer, subject)` |
| `tenant_memberships` | Principal-to-tenant permissions/status; unique `(tenant_id, principal_id)` |
| `loans` | Tenant-scoped workflow identity and external Encompass GUID; unique `(tenant_id, id)` and `(tenant_id, encompass_guid)` |
| `source_documents` | Metadata only: tenant, loan, Encompass attachment ID, type, SHA-256, page count; no bytes, object key, or OCR text |
| `income_extractions` | Allowlisted normalized inputs plus coordinate evidence, source hash, schema/parser version; no full OCR payload |
| `income_calculations` | Deterministic outputs, rule version, canonical input hash, status and version |
| `appraisal_audits` | Separate appraisal extraction/rule result and source evidence; tenant-scoped |
| `audit_events` | Append-only actor/action/reason, entity, previous/new hashes or allowlisted delta, rule/schema version, request ID, occurred-at |
| `shared_link_tokens` | Keyed token hash, tenant, loan, purpose, expiry, max/used count, revoked-at |
| `sync_jobs` | Approval event reference, idempotency key, expected loan version, state, attempt count, safe error code |
| `webhook_events` | Provider, event ID, received/processed state, payload hash; unique `(provider, event_id)`; do not retain full payload by default |
| `billing_ledger` | Tenant/loan/provider references, integer amount/currency/product, immutable entry type; unique provider transaction keys |
| `integration_configs` | Non-secret settings and Secrets Manager ARN references only; no client secret/password value |

Every child table has `tenant_id` and uses a composite foreign key such as
`(tenant_id, loan_id) -> loans(tenant_id, id)`. This makes an accidental
cross-tenant relationship invalid at the database layer. Indexes begin with
`tenant_id` for tenant-filtered access paths. Foreign keys define explicit delete
behavior; financial and audit history is never cascade-deleted.

## Tenant context and RLS

At the start of every transaction, the application sets validated values with
parameterized statements:

```sql
SET LOCAL app.tenant_id = '<server-validated-uuid>';
SET LOCAL app.principal_id = '<server-validated-uuid>';
```

Policies compare `tenant_id` to `current_setting('app.tenant_id', true)::uuid`.
Every tenant table enables and **forces** RLS. The application role owns no table
and has no `BYPASSRLS`. Missing or malformed context denies access. Policy logic
does not read user-editable identity metadata.

Repository methods require `RequestContext` and tenant-qualified identifiers.
Direct unrestricted ORM access is prohibited in route handlers. Background jobs
set the same context from a previously validated tenant/job relationship.

## Immutable audit

`audit_events` is insert-only for application roles. A database trigger rejects
`UPDATE` and `DELETE`; retention/archive is a separately authorized procedure.
Each decision or override records:

- tenant, actor principal/membership, service identity, request/trace ID;
- entity type/ID/version and action;
- reason code and required human narrative for override;
- canonical input hash, previous event hash, result hash;
- parser, rule, API schema, and application versions;
- source-document metadata reference and timestamp.

The hash chain is tamper-evidence, not a substitute for backups or authorization.
Export periodic signed checkpoints to a locked compliance archive only if the
approved retention policy requires it; never export raw document/OCR content.

## Transactions and idempotency

- Calculation approval, audit append, and state change occur atomically.
- Stripe events are claimed by unique provider event ID before effects run.
- API idempotency stores `(tenant_id, operation, key, request_hash, response_code,
  response_reference, expires_at)` with a unique constraint.
- Sync jobs uniquely reference the approval event and expected target/version.
- Retry workers use `SELECT ... FOR UPDATE SKIP LOCKED` only for DB queues; the
  preferred external queue remains SQS with database state as authority.
- No external API call is held inside a long database transaction. Use an outbox
  record committed with state, then dispatch and reconcile.

## Migrations and compatibility

1. Generate SQL migrations and review them; do not let production application
   startup mutate schema.
2. CI creates an empty database, applies every migration, validates Prisma/schema
   generation, runs RLS/constraint tests, and verifies a clean schema diff.
3. Deploy backward-compatible expand changes first, application code second, and
   contract/drop changes only after old tasks are drained and rollback expires.
4. A one-off ECS migration task assumes the migrator role. Exactly one migration
   executes; advisory locking and a migration ledger prevent concurrency.
5. Application readiness verifies a compatible schema version, not merely a TCP
   connection.

## Retention, backup, and recovery

- A data inventory assigns owner, purpose, classification, retention, deletion,
  and legal-hold handling to every column and log field before launch.
- Raw PDFs/OCR text/raw XML have retention **zero** in FreeFlow-managed stores.
- Operational/idempotency records have short explicit retention; financial and
  decision audit retention is approved by legal/compliance, not guessed in code.
- Automated backup retention, PITR target, cross-region copy, and any archive lock
  are parameterized in IaC. A recommended starting objective is RPO <= 5 minutes
  and RTO <= 60 minutes, subject to business approval and a measured restore.
- Restore drills run at least quarterly into an isolated account/VPC, validate
  checksums/migrations/RLS/application smoke tests, and record achieved RPO/RTO.
