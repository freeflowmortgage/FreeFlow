# Deployment Implementation Plan

This sequence minimizes rework by fixing trust and data boundaries before AWS
scale-out or frontend polish. Work items map to `DEPLOYMENT-BURNDOWN.md`.

## Phase 0 — Contain prototype behavior

1. Add a production startup guard that rejects fixture/demo modes, local/mock
   provider URLs, placeholder secrets, development servers, and missing required
   configuration.
2. Remove library/worker files from Pages API routing and make all unimplemented
   production paths return safe explicit errors.
3. Disable public access to the QA console. Keep synthetic fixtures in a package
   and build graph that cannot enter a portal production image.
4. Remove build-error suppression and repair package boundaries/tests.

Exit: a production-mode build fails closed and contains no fixture route or
synthetic borrower response.

## Phase 1 — Identity, tenancy, and API foundation

1. Implement OIDC/session middleware and verified ALB/JWT claim handling.
2. Add principals, tenant memberships, permissions, and a single immutable
   `RequestContext`. Delete all authorization use of caller identity headers.
3. Introduce a tenant-required repository layer. Route handlers cannot access the
   unrestricted ORM/service-role client.
4. Add schema validation, safe errors, correlation IDs, CSRF/origin protection,
   idempotency middleware, limits, and rate/tenant quotas.
5. Write the full anonymous/forged/two-tenant test matrix before migrating routes.

Exit: every production endpoint fails closed without a verified identity and
cannot access a second tenant under automated tests.

## Phase 2 — Database baseline and immutable workflows

1. Replace drifted/manual schema fragments with one Prisma schema and ordered SQL
   migrations. Apply from empty DB in CI.
2. Add tenant IDs/composite FKs/indexes, FORCE RLS, restricted roles, transaction
   context, append-only audit triggers, idempotency, webhook, outbox, sync-job,
   and token-hash tables.
3. Remove raw PDF keys, full OCR payload/value blobs, raw XML job payloads, and
   plaintext integration secrets. Write a migration/data-disposition plan before
   deleting any real data.
4. Integrate deterministic calculations with rule/source hashes and immutable
   approval events. An input change makes approval stale.
5. Make billing reconciliation transactional/idempotent and authoritative.

Exit: migration-from-zero, drift, RLS, audit immutability, duplicate webhook,
stale approval, and cross-tenant tests pass.

## Phase 3 — Parser and Encompass hardening

1. Upgrade the income parser dependency set and re-run its representative golden,
   malicious, malformed, scanned, and resource-exhaustion corpus.
2. Stream/bound inputs before allocation where the framework permits; cap aggregate
   pages/bytes/time/concurrency and return typed failures.
3. Remove production full-word OCR output. Prove neither parser writes documents
   or logs sensitive material under normal, timeout, crash, and malformed cases.
4. Gate appraisal text fixtures behind test-only startup/build behavior and add
   real scanned-document handling or fail as unsupported. Produce source-derived
   coordinates.
5. Implement SQS/outbox sync worker that loads an immutable approval, maps fields
   server-side, conditionally transitions state, and reconciles ambiguous results.

Exit: ZDR canary markers are absent from all FreeFlow stores/logs, parsers pass
read-only-filesystem tests, and replaying any sync message has one external effect.

## Phase 4 — Production images and AWS IaC

1. Create minimal multi-stage images: Next standalone portal, isolated parsers,
   and worker. Pin base digests; non-root; read-only root; drop capabilities; health
   checks; no source/dev dependencies/test fixtures.
2. Select Terraform or CDK, bootstrap protected remote state/deployment roles,
   then implement the seven stacks/modules in `AWS-ECS-DEPLOYMENT-SPEC.md`.
3. Create separate task/execution roles and explicit security groups. Make only
   ALB public. Configure RDS, SQS/DLQ, KMS, Secrets Manager, endpoints/egress,
   Route 53, ACM, WAF, OIDC, logs, alarms, backups, and dashboards.
4. Add CI federation, ECR immutable tags/enhanced scans/signing, SBOM/provenance,
   staged migration, digest promotion, circuit-breaker rollback, and policy gates.
5. Populate Secrets Manager directly through an approved secret workflow. Never
   generate or upload a populated `.env.production` artifact.

Exit: a clean AWS staging account is reproducibly created from IaC and accepts
only the documented paths/roles; destroy/recreate and drift checks pass.

## Phase 5 — Staging qualification and production launch

1. Load test representative/worst-case PDFs and provider latency to set task sizes,
   concurrency, autoscaling, ALB timeouts, quotas, and cost alarms.
2. Execute deploy/rollback, secret rotation, Encompass outage, DLQ, database
   restore, and ZDR incident runbooks. Record achieved RPO/RTO.
3. Complete an independent staging penetration test, privacy/data-flow review,
   accessibility baseline, threat-model signoff, and operational readiness review.
4. Run a synthetic-data canary release, observe, then enable limited production
   tenants through a server-side rollout control with a documented abort threshold.

Exit: every P0 burndown item is accepted by its owner, no unresolved critical/high
finding remains, and launch approval is recorded.

## Suggested pull-request slices

1. `prod-config-contract` — already started by `.env.production.example`, ignore rules.
2. `auth-request-context` — OIDC verification, memberships, middleware, negative tests.
3. `database-baseline` — roles, migrations, tenant constraints, FORCE RLS.
4. `audit-idempotency` — immutable events, request keys, outbox/webhook claims.
5. `api-v1-migration` — validated tenant-scoped route contracts and safe errors.
6. `parser-zdr-hardening` — dependencies, fixtures, bounds, coordinates, no-word output.
7. `sync-worker` — SQS/outbox, approval loading, reconciliation.
8. `production-images` — standalone/minimal/read-only images and container tests.
9. `aws-foundation-iac` — accounts/network/data/edge/compute/observability/delivery.
10. `staging-qualification` — performance, DAST/pen test, drills, launch evidence.
