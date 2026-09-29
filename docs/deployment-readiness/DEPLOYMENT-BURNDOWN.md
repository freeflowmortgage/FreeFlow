# Production Deployment Burndown

Status values: `OPEN`, `IN PROGRESS`, `BLOCKED`, `DONE`, `ACCEPTED RISK`.
`DONE` requires linked automated or runbook evidence; code merged alone is not
enough. No P0 may be accepted as risk for initial production launch.

Integration launch instructions (RapidOCR, MISMO, Encompass web vs desktop,
parser limits) live in [GO-LIVE-MAP.md](GO-LIVE-MAP.md). This file tracks
whether the work is done; that file says how to turn each surface on.

## P0 — Launch blockers

| ID | Status | Work item | Acceptance evidence | Owner |
|---|---|---|---|---|
| P0-01 | IN PROGRESS | Implement verified OIDC/session and server-derived tenant/permission context | [Weekend Burn 2 evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md) proves live anonymous, forged-header, and expired-token denial plus Cognito MFA; the live positive user and full route/object matrix remain | Security/backend TBD |
| P0-02 | IN PROGRESS | Enforce tenant-qualified repository and object authorization | Complete two-tenant API/job/share/export negative matrix passes | Backend TBD |
| P0-03 | DONE | Create one ordered database migration baseline and restricted roles | [Role bootstrap](../../packages/database/prisma/bootstrap/roles.sql), [ordered migrations](../../packages/database/prisma/migrations), and [isolation test](../../packages/database/prisma/tests/tenant-rls-isolation.sql) prove empty-DB deploy/clean drift and non-owner/non-BYPASSRLS roles | Repository evidence; reviewer required |
| P0-04 | IN PROGRESS | Add tenant columns, composite FKs/indexes, FORCE RLS to every domain table | Extraction/calculation provenance now has tenant-first keys, restricted app/worker grants, FORCE RLS, immutable triggers, cross-tenant SQL tests, clean migration-from-zero, and zero Prisma drift; complete route/object matrix remains | Database TBD |
| P0-05 | IN PROGRESS | Implement append-only approval/override audit events | Parser results are persisted as allowlisted, source-hash/version-bound extractions; calculation accepts extraction IDs only, records canonical input/rule/provenance, and approval/sync reject superseded inputs. Local PostgreSQL app-role extraction-to-calculation-to-approval evidence passes; live Cognito evidence remains ([route tests](../../apps/underwriter-portal/src/server/audit/incomeApprovals.route.test.ts), [Prisma isolation](../../apps/underwriter-portal/src/server/database/incomeApproval.integration.test.ts)) | Backend/database TBD |
| P0-06 | IN PROGRESS | Remove raw PDF/OCR/raw XML persistence and sensitive job/log fields | [Weekend Burn 2 evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md) proves a deployed connector-to-parser canary absent from PostgreSQL, queues/DLQs, seven log groups, task storage, and CI artifacts; the authenticated extraction-to-sync canary remains | Security/data TBD |
| P0-07 | IN PROGRESS | Repair API routing and remove all production demo fallbacks | Legacy Encompass pull route now fails explicitly, parser dependency failures are typed, and protected summary export fails closed until approved/versioned data exists; route contract tests and remaining endpoint migration are required | Backend TBD |
| P0-08 | IN PROGRESS | Rebuild Encompass sync around immutable approvals, outbox/SQS, idempotency | Durable sync jobs, tenant-scoped POST/GET APIs, approval/version revalidation, identifier-only SQS, bounded retry/DLQ, server mapper, private signed connector calls, safe result state/audit, duplicate delivery protection, and unknown-outcome read reconciliation are implemented. Automated replay/4xx/5xx/restart/reconciliation tests and Terraform validation pass; direct custom-connector qualification remains | Integrations TBD |
| P0-09 | OPEN | Make Stripe webhook authoritative and idempotent | Duplicate/tampered tenant/amount/currency/product tests have one correct effect | Billing/backend TBD |
| P0-10 | OPEN | Secure shared links with hashed, scoped, expiring, revocable tokens | Cross-loan/tenant, reuse, expiry, revocation, brute-force controls pass | Backend/security TBD |
| P0-11 | OPEN | Harden appraisal parser and implement real source evidence | Production rejects fixtures/non-PDF; scan behavior explicit; real coordinates tested | Appraisal TBD |
| P0-12 | DONE | Upgrade vulnerable JS and income-parser dependencies | `pnpm audit` has no high/critical findings, `pip-audit` is clean, and exact digest images pass Trivy HIGH/CRITICAL and secret scans ([evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md)) | Repository/AWS evidence; reviewer required |
| P0-13 | IN PROGRESS | Complete parser resource/admission controls | Streaming 40 MiB cap, MIME checks, multipart limits, hardened container, and private-only ECS deployment are verified; worst-case corpus/SLO evidence remains | Parser/platform TBD |
| P0-14 | DONE | Produce minimal hardened production images | Exact deployed images are digest-pinned and scan-clean; tasks are non-root, read-only, unprivileged, cap-drop ALL, bounded, and exclude dev/fixture runtime paths ([evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md)) | Repository/AWS evidence; reviewer required |
| P0-15 | IN PROGRESS | Build AWS account/network/data/edge/compute IaC | [Weekend Burn 2 evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md) proves Cognito/TLS ALB, five private digest-pinned ECS services, scoped IAM/secrets, queues, alarms, and zero Terraform drift; separate-account staging, WAF, and HA remain | Cloud TBD |
| P0-16 | IN PROGRESS | Implement CI/CD supply-chain and digest promotion | Tests/builds, migration/RLS, Terraform validation, gitleaks, audits, Trivy, SHA tags, digest checks, and SBOM generation are checked in and pass; signing/provenance policy and a retained rollback artifact drill remain ([evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md)) | Platform/security TBD |
| P0-17 | IN PROGRESS | Configure RDS security, backups, PITR, migration task, schema readiness | [Weekend Burn 2 evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md) proves restricted migration, current schema/RLS, an encrypted pre-migration snapshot, and isolated restore with measured recovery; production retention, Multi-AZ, and approved RPO/RTO remain | Database/cloud TBD |
| P0-18 | IN PROGRESS | Configure observability without sensitive data | Dashboard and 28 alarms are deployed and `OK`; a controlled alarm reached `ALARM`, but the operations email subscription still awaits confirmation ([evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md)) | SRE/security TBD |
| P0-19 | OPEN | Execute staging security/privacy qualification | Independent pen test and ZDR flow review have no unresolved critical/high | Security/privacy TBD |
| P0-20 | IN PROGRESS | Execute deploy/rollback/rotation/outage/DLQ runbooks | Database restore and bounded DLQ/redrive drills passed; application rollback, provider outage/reconciliation, secret rotation, and named on-call evidence remain ([evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md)) | SRE TBD |
| P0-21 | DONE | Separate production configuration contract from tracked development config | `.env.production` ignored, placeholder example tracked, `.env*` excluded from builds | Repository evidence |
| P0-22 | DONE | Remove suppressed build/test failures and establish hermetic CI test stages | Required builds fail on error; full JS/Python/database/connector suites, production builds, Prisma, migration/RLS, and Terraform checks pass ([evidence](WEEKEND-BURN-2-EVIDENCE-2026-09-26.md)) | Repository evidence; reviewer required |

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
| P0 | 5 | 22 | 17 |
| P1 | 0 | 8 | 8 |
| P2 | 0 | 5 | 5 |

Update this table in the same change that updates an item's status. An evidence
link and reviewer are required before changing `DONE` to release-approved.
