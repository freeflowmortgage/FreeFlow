# FreeFlow Deployment Readiness

Status: **not approved for production deployment**
Assessment date: 2026-09-04
Canonical product architecture: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)

This folder turns the repository's architecture and design material into a
single production-readiness package. `ARCHITECTURE.md` v4.1 remains the product
authority. Other files already under `docs/` are historical design inputs or
examples unless this package explicitly adopts them. In particular, source-code
examples under `docs/` must not be copied into production without review and
tests.

## Documents

| Document | Purpose |
|---|---|
| [SECURITY-ASSESSMENT.md](SECURITY-ASSESSMENT.md) | Adversarial findings and release gates |
| [SECURITY-SPEC.md](SECURITY-SPEC.md) | Required production security controls and threat model |
| [BACKEND-API-SPEC.md](BACKEND-API-SPEC.md) | Authentication, tenancy, API, job, error, and audit contracts |
| [DATABASE-SPEC.md](DATABASE-SPEC.md) | Production schema, RLS, migration, retention, backup, and restore requirements |
| [APPLICATION-SPEC.md](APPLICATION-SPEC.md) | Runtime boundaries, production capabilities, and functional gaps |
| [AWS-ECS-DEPLOYMENT-SPEC.md](AWS-ECS-DEPLOYMENT-SPEC.md) | Target AWS topology and ECS/Fargate translation |
| [AWS-LIVE-TEST-RUNBOOK.md](AWS-LIVE-TEST-RUNBOOK.md) | Synthetic-data dev deployment, verification, pause, and access procedures |
| [PLTE-DEPLOYMENT-EVIDENCE-2026-09-07.md](PLTE-DEPLOYMENT-EVIDENCE-2026-09-07.md) | Recorded AWS PLTE deployment, migration, scan, and smoke-test evidence |
| [STAGING-FOUNDATION-2026-09-09.md](STAGING-FOUNDATION-2026-09-09.md) | Separate-account staging access and Terraform-state foundation evidence |
| [DEV-BASELINE-VERIFICATION-2026-09-09.md](DEV-BASELINE-VERIFICATION-2026-09-09.md) | Current synthetic-dev service, digest, and target-health baseline |
| [DEV-PORTAL-ROLLOUT-2026-09-09.md](DEV-PORTAL-ROLLOUT-2026-09-09.md) | Current portal rollout evidence; explicitly incomplete pending ECS provisioning |
| [RUNBOOKS.md](RUNBOOKS.md) | Deployment, rollback, incident, restore, rotation, and vulnerability procedures |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Ordered engineering implementation with acceptance tests |
| [DEPLOYMENT-BURNDOWN.md](DEPLOYMENT-BURNDOWN.md) | Trackable P0/P1/P2 release backlog |
| [GO-LIVE-MAP.md](GO-LIVE-MAP.md) | Integration go-live instructions: RapidOCR, MISMO, Encompass web/desktop, appraisal, billing, identity |

## Non-negotiable invariants

1. FreeFlow is B2B-only. A verified server-side identity determines tenant and
   role; caller-provided identity headers never do.
2. Income underwriting and appraisal review remain separate bounded contexts.
3. Document processing is bytes-in and structured JSON-with-coordinates-out.
   Raw PDFs, OCR text, and raw XML are not persisted or placed on queues.
4. Calculations are deterministic and versioned. Human overrides are append-only
   events containing actor, reason, source hash, prior value, and new value.
5. Encompass remains the source of truth for source documents. Only an approved,
   immutable server-side calculation can be synchronized back.
6. Production deploys immutable, scanned image digests through infrastructure as
   code; no mutable `latest` tags or console-authored infrastructure.

## Release decision

The local development stack and synthetic AWS dev foundation are not evidence
of production readiness. Verified ALB identity handling, ordered PostgreSQL
migrations, forced RLS, immutable audit events, retention migrations, and a
phased ECS dev stack now exist, but substantial P0 work remains. In particular,
provider workflows, shared links, parser output minimization, supply-chain
controls, HA/restore qualification, observability, and independent security
testing remain incomplete. All P0 items must close before production traffic or
real borrower data is allowed. Integration-by-integration launch steps
(RapidOCR, MISMO 3.4, Encompass Developer Connect vs desktop, D1C, appraisal)
are in [GO-LIVE-MAP.md](GO-LIVE-MAP.md).
