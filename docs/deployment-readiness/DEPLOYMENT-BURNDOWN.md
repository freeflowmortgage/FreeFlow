# Production Deployment Burndown

Status values: `OPEN`, `IN PROGRESS`, `BLOCKED`, `DONE`, `ACCEPTED RISK`.
`DONE` requires linked automated or runbook evidence; code merged alone is not
enough. No P0 may be accepted as risk for initial production launch.

## P0 — Launch blockers

| ID | Status | Work item | Acceptance evidence | Owner |
|---|---|---|---|---|
| P0-01 | OPEN | Implement verified OIDC/session and server-derived tenant/permission context | Forged, anonymous, expired, wrong issuer/audience/signer tests all deny | Security/backend TBD |
| P0-02 | OPEN | Enforce tenant-qualified repository and object authorization | Complete two-tenant API/job/share/export negative matrix passes | Backend TBD |
| P0-03 | OPEN | Create one ordered database migration baseline and restricted roles | Empty DB migrates; clean drift; app role has no owner/BYPASSRLS | Database TBD |
| P0-04 | OPEN | Add tenant columns, composite FKs/indexes, FORCE RLS to every domain table | Constraint/RLS tests cover direct, joined, worker, and admin paths | Database TBD |
| P0-05 | OPEN | Implement append-only approval/override audit events | DB rejects update/delete; actor/reason/version/hash evidence verified | Backend/database TBD |
| P0-06 | OPEN | Remove raw PDF/OCR/raw XML persistence and sensitive job/log fields | Canary markers absent from DB, queue, cache, files, logs, traces, dumps | Security/data TBD |
| P0-07 | OPEN | Repair API routing and remove all production demo fallbacks | Route contract tests pass; missing/dependency cases return typed 404/503 | Backend TBD |
| P0-08 | OPEN | Rebuild Encompass sync around immutable approvals, outbox/SQS, idempotency | Replay/unknown-outcome/stale-approval/provider-outage tests pass | Integrations TBD |
| P0-09 | OPEN | Make Stripe webhook authoritative and idempotent | Duplicate/tampered tenant/amount/currency/product tests have one correct effect | Billing/backend TBD |
| P0-10 | OPEN | Secure shared links with hashed, scoped, expiring, revocable tokens | Cross-loan/tenant, reuse, expiry, revocation, brute-force controls pass | Backend/security TBD |
| P0-11 | OPEN | Harden appraisal parser and implement real source evidence | Production rejects fixtures/non-PDF; scan behavior explicit; real coordinates tested | Appraisal TBD |
| P0-12 | OPEN | Upgrade vulnerable JS and income-parser dependencies | Fresh audits have zero critical/high or approved exception (not allowed at launch) | Platform TBD |
| P0-13 | OPEN | Complete parser resource/admission controls | Worst-case corpus stays within task limit/SLO and fails closed | Parser/platform TBD |
| P0-14 | OPEN | Produce minimal hardened production images | Non-root, read-only, cap-drop, immutable digest; no dev server/fixture/source/dev deps | Platform TBD |
| P0-15 | OPEN | Build AWS account/network/data/edge/compute IaC | Clean staging create/drift/destroy evidence; only ALB public; least-privilege SG/IAM | Cloud TBD |
| P0-16 | OPEN | Implement CI/CD supply-chain and digest promotion | Tests/scans/SBOM/signing/provenance/policy/approval and rollback demonstrated | Platform/security TBD |
| P0-17 | OPEN | Configure RDS security, backups, PITR, migration task, schema readiness | TLS/private/Multi-AZ/deletion protection plus measured restore drill | Database/cloud TBD |
| P0-18 | OPEN | Configure observability without sensitive data | Dashboards/alarms trigger; structured-log allowlist and masking tests pass | SRE/security TBD |
| P0-19 | OPEN | Execute staging security/privacy qualification | Independent pen test and ZDR flow review have no unresolved critical/high | Security/privacy TBD |
| P0-20 | OPEN | Execute deploy/rollback/rotation/outage/DLQ runbooks | Recorded staging drill evidence and named on-call ownership | SRE TBD |
| P0-21 | DONE | Separate production configuration contract from tracked development config | `.env.production` ignored, placeholder example tracked, `.env*` excluded from builds | Repository evidence |
| P0-22 | OPEN | Remove suppressed build/test failures and establish hermetic CI test stages | Required builds fail on error; all JS/Python/integration suites run green | Engineering TBD |

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
| P0 | 1 | 22 | 21 |
| P1 | 0 | 8 | 8 |
| P2 | 0 | 5 | 5 |

Update this table in the same change that updates an item's status. An evidence
link and reviewer are required before changing `DONE` to release-approved.
