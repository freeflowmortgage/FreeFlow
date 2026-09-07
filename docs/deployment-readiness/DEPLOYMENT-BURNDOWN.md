# Production Deployment Burndown

Status values: `OPEN`, `IN PROGRESS`, `BLOCKED`, `DONE`, `ACCEPTED RISK`.
`DONE` requires linked automated or runbook evidence; code merged alone is not
enough. No P0 may be accepted as risk for initial production launch.

## P0 — Launch blockers

| ID | Status | Work item | Acceptance evidence | Owner |
|---|---|---|---|---|
| P0-01 | IN PROGRESS | Implement verified OIDC/session and server-derived tenant/permission context | Forged, anonymous, expired, wrong issuer/audience/signer tests all deny | Security/backend TBD |
| P0-02 | IN PROGRESS | Enforce tenant-qualified repository and object authorization | Complete two-tenant API/job/share/export negative matrix passes | Backend TBD |
| P0-03 | DONE | Create one ordered database migration baseline and restricted roles | [Role bootstrap](../../packages/database/prisma/bootstrap/roles.sql), [ordered migrations](../../packages/database/prisma/migrations), and [isolation test](../../packages/database/prisma/tests/tenant-rls-isolation.sql) prove empty-DB deploy/clean drift and non-owner/non-BYPASSRLS roles | Repository evidence; reviewer required |
| P0-04 | IN PROGRESS | Add tenant columns, composite FKs/indexes, FORCE RLS to every domain table | Direct Prisma and SQL isolation tests pass; worker/admin and complete joined-path matrix remain | Database TBD |
| P0-05 | IN PROGRESS | Implement append-only approval/override audit events | Append-only calculation event schema, RLS, restricted grants, mutation trigger, and transaction-local hash chain are implemented; approval/override flows and complete evidence remain | Backend/database TBD |
| P0-06 | IN PROGRESS | Remove raw PDF/OCR/raw XML persistence and sensitive job/log fields | [Zero-data-retention disposition plan](DATA-DISPOSITION-PLAN.md), contract migration, and DB column assertions are in place; runtime canary coverage across DB, queue, cache, files, logs, traces, and dumps remains | Security/data TBD |
| P0-07 | IN PROGRESS | Repair API routing and remove all production demo fallbacks | Legacy Encompass pull route now fails explicitly and parser dependency failures are typed; route contract tests and remaining endpoint migration are required | Backend TBD |
| P0-08 | OPEN | Rebuild Encompass sync around immutable approvals, outbox/SQS, idempotency | Replay/unknown-outcome/stale-approval/provider-outage tests pass | Integrations TBD |
| P0-09 | OPEN | Make Stripe webhook authoritative and idempotent | Duplicate/tampered tenant/amount/currency/product tests have one correct effect | Billing/backend TBD |
| P0-10 | OPEN | Secure shared links with hashed, scoped, expiring, revocable tokens | Cross-loan/tenant, reuse, expiry, revocation, brute-force controls pass | Backend/security TBD |
| P0-11 | OPEN | Harden appraisal parser and implement real source evidence | Production rejects fixtures/non-PDF; scan behavior explicit; real coordinates tested | Appraisal TBD |
| P0-12 | IN PROGRESS | Upgrade vulnerable JS and income-parser dependencies | Parser and migration images are digest-pinned with clean ECR scans; remaining JS/image audits must reach the same gate | Platform TBD |
| P0-13 | IN PROGRESS | Complete parser resource/admission controls | Streaming 40 MiB cap, MIME checks, multipart limits, hardened container, and private-only ECS deployment are verified; worst-case corpus/SLO evidence remains | Parser/platform TBD |
| P0-14 | OPEN | Produce minimal hardened production images | Non-root, read-only, cap-drop, immutable digest; no dev server/fixture/source/dev deps | Platform TBD |
| P0-15 | IN PROGRESS | Build AWS account/network/data/edge/compute IaC | [Terraform foundation](../../infrastructure/terraform/README.md), [synthetic live-test runbook](AWS-LIVE-TEST-RUNBOOK.md), and [recorded PLTE deployment](PLTE-DEPLOYMENT-EVIDENCE-2026-09-07.md) cover protected state, phased dev networking/secrets/queues/IAM/ECR, an IP-restricted ALB, digest-pinned ECS, and migration tasks; Cognito/ACM/DNS activation, clean separate-account staging create/drift/destroy, WAF/HA, and full observability evidence remain | Cloud TBD |
| P0-16 | OPEN | Implement CI/CD supply-chain and digest promotion | Tests/scans/SBOM/signing/provenance/policy/approval and rollback demonstrated | Platform/security TBD |
| P0-17 | IN PROGRESS | Configure RDS security, backups, PITR, migration task, schema readiness | [PLTE deployment evidence](PLTE-DEPLOYMENT-EVIDENCE-2026-09-07.md) proves private preflight, RDS-compatible restricted roles, ordered migration, and synthetic seed; Multi-AZ, production retention/deletion protection, PITR, and measured restore drill remain | Database/cloud TBD |
| P0-18 | IN PROGRESS | Configure observability without sensitive data | CloudWatch dashboard, encrypted SNS topic, and seven alarms are deployed and `OK`; alert subscription/drill plus structured-log masking tests remain | SRE/security TBD |
| P0-19 | OPEN | Execute staging security/privacy qualification | Independent pen test and ZDR flow review have no unresolved critical/high | Security/privacy TBD |
| P0-20 | OPEN | Execute deploy/rollback/rotation/outage/DLQ runbooks | Recorded staging drill evidence and named on-call ownership | SRE TBD |
| P0-21 | DONE | Separate production configuration contract from tracked development config | `.env.production` ignored, placeholder example tracked, `.env*` excluded from builds | Repository evidence |
| P0-22 | IN PROGRESS | Remove suppressed build/test failures and establish hermetic CI test stages | Required builds fail on error; all JS/Python/integration suites run green | Engineering TBD |

## P1 — Required operational maturity

| ID | Status | Work item | Acceptance evidence | Owner |
|---|---|---|---|---|
| P1-01 | OPEN | Load/capacity/cost test all services | Approved SLO, task size/count, scaling, timeout, quota, monthly cost envelope | Platform/product TBD |
| P1-02 | OPEN | Encompass reconciliation and operator view | Synthetic missing/duplicate/ambiguous outcomes resolve safely | Integrations/ops TBD |
| P1-03 | OPEN | Data inventory, retention, deletion, legal hold | Column/log/backup inventory approved by privacy/legal/security | Privacy TBD |
| P1-04 | OPEN | Key/secret rotation automation and evidence | Rotation succeeds without outage; stale credential rejected | Security/SRE TBD |
| P1-05 | OPEN | Threat-model review and abuse monitoring | Signed review plus alerts for auth/tenant/upload/share/webhook abuse | Security TBD |
| P1-06 | OPEN | Business continuity and regional recovery decision | Approved region strategy and measured recovery objective | Leadership/SRE TBD |
| P1-07 | OPEN | Dependency update automation and vulnerability SLA | Automated PR/scans route findings to owners and enforce SLA | Platform TBD |
| P1-08 | OPEN | API version/schema documentation and generated contract tests | Published OpenAPI/internal schemas match deployed behavior | Backend TBD |

## P2 — Post-foundation product and usability work

| ID | Status | Work item | Acceptance evidence | Owner |
|---|---|---|---|---|
| P2-01 | OPEN | Underwriter workflow usability study | Representative users complete core tasks; findings prioritized | Product/design TBD |
| P2-02 | OPEN | WCAG 2.2 AA remediation | Automated and manual keyboard/screen-reader audit passes | Frontend/design TBD |
| P2-03 | OPEN | Source-evidence navigation and exception recovery | Tested task flows for low-confidence, unsupported, stale, failed sync states | Product/frontend TBD |
| P2-04 | OPEN | Responsive and supported-viewport behavior | Defined browser/device matrix passes without hiding decision state | Frontend/QA TBD |
| P2-05 | OPEN | Safe tenant administration and integration setup | Least-privilege admin tests, reauth, audit, rotation, and recovery pass | Product/security TBD |

## Progress summary

| Priority | Done | Total | Remaining |
|---|---:|---:|---:|
| P0 | 2 | 22 | 20 |
| P1 | 0 | 8 | 8 |
| P2 | 0 | 5 | 5 |

Update this table in the same change that updates an item's status. An evidence
link and reviewer are required before changing `DONE` to release-approved.
