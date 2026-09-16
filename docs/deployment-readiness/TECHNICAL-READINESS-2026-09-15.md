# FreeFlow Technical Readiness and Go-Live Burndown

> Progress update — September 15, 2026: the tenant-scoped Encompass eFolder
> pull API, durable SQS job, V3 provider client, bounded metadata-only worker,
> database migration, least-privilege AWS task definition, and automated tests
> are implemented. The worker remains feature-gated. It is not production-ready
> until ICE sandbox credentials are supplied, the supported OAuth flow is
> confirmed, ICE's live response is captured in a contract test, and an
> end-to-end synthetic-loan run passes in AWS dev.

Assessment date: 2026-09-15  
Evidence cutoff: commit `784fd90` on `fix/w2-ocr-field-handoff`  
Target dates: sellable design-partner demo by 2026-09-20; hard production decision by 2026-09-30

## Executive decision

FreeFlow is a strong working prototype and a credible controlled sales demo. It
is not approved to process real borrower data in production.

The September 19-20 weekend target is achievable only if "sellable" means an
honest income-underwriting design-partner demo or paid sandbox pilot using
synthetic or explicitly sanitized documents. The demo must not represent
Encompass sync, billing, secure sharing, appraisal scanning, or production data
handling as complete.

A narrow income-only production pilot by September 30 is possible but red-risk.
It requires immediate scope freeze, at least three parallel engineering tracks,
external security review availability, and no dependency on an unprovisioned
Encompass tenant. A broad production launch with automated Encompass pull/sync,
Stripe, shared links, appraisal, and full supported-form qualification is not a
credible 15-day commitment.

## Readiness scorecard

These are engineering estimates, not a compliance certification. Scores are
based on repository evidence, runnable tests, the local stack, and the recorded
AWS dev deployment.

| Outcome | Current readiness | Meaning |
| --- | ---: | --- |
| Controlled sales demo | **85%** | The console, parsers, calculations, and synthetic workflows run; packaging and claim discipline remain. |
| Sellable design-partner sandbox | **60%** | A customer can evaluate a bounded workflow, but production data, integrations, support, and operating guarantees remain excluded. |
| Narrow income-only production pilot | **35%** | Security foundations exist, but production workflow, staging qualification, supply chain, integrations, HA, and operational gates are incomplete. |
| Broad production platform | **25%** | Encompass, billing, sharing, appraisal productionization, capacity, and full corpus qualification are not complete. |

The weighted technical-maturity estimate is **54%**:

| Dimension | Weight | Earned | Evidence summary |
| --- | ---: | ---: | --- |
| Product story and demo UX | 15 | 13 | Strong console and demos; portal home is still a demo component and several actions imply unavailable capabilities. |
| Document ingestion, OCR, and evidence | 15 | 10 | Live parser, page filtering, coordinate evidence, and 78 tests; adversarial corpus, WVOE, scans, and async capacity remain. |
| Deterministic calculations and mappings | 10 | 8 | 91 mortgage-engine tests and MISMO/paystub mapping; approved-result binding and broader domain sign-off remain. |
| Production portal and workflow | 15 | 5 | Authenticated APIs and approval events exist; the public portal UI is not a real end-to-end production workflow. |
| Security, tenancy, and ZDR | 15 | 7 | OIDC verification, tenant transactions, RLS, audit events, and retention migrations exist; route matrix, canaries, dependency risk, and independent testing remain. |
| External integrations and billing | 10 | 2 | Encompass pull now has a feature-gated worker and deployment path, but lacks ICE sandbox qualification; Encompass writeback and Stripe remain disabled. |
| Infrastructure and release engineering | 10 | 5 | Good dev Terraform and digest-pinned dev evidence; staging has state only, and production IaC/promotion is absent. |
| QA, reliability, and operations | 10 | 4 | Useful unit coverage and runbooks; incomplete CI, browser E2E, load, restore, rollback, and on-call evidence. |
| **Total** | **100** | **54** | Overall engineering maturity, not production authorization. |

The canonical P0 list contains 2 `DONE`, 12 `IN PROGRESS`, and 8 `OPEN`
items. Counting `IN PROGRESS` as half complete gives **36% P0 completion**:
`(2 + 12 x 0.5) / 22`. This is why a polished demo can be near-ready while a
production launch remains far behind.

## Evidence collected on 2026-09-15

- `freeflowmortgage/main` is 14 commits behind the assessed branch. None of the
  current work is releasable from the company main branch until it is reviewed
  and merged.
- The exact portal CI sequence passed: Prisma generation, mortgage-engine type
  check, 45 portal/config/security tests, and the Next.js production build.
- Mortgage-engine: 15 suites and 91 tests passed.
- Income parser: 78 tests passed in an ephemeral production-image environment.
- Appraisal parser: 10 tests passed only after manually installing undeclared
  test dependencies (`pytest`, `httpx`, and `pytest-asyncio`). It has no CI job.
- Underwriting console TypeScript and Vite production build passed. The main
  JavaScript bundle is approximately 962 kB before gzip and triggers Vite's
  large-chunk warning.
- The complete local stack reports healthy and the portal, income parser, and
  appraisal parser return HTTP 200. The local PostgreSQL database contains zero
  application tables because Compose does not run migrations; the portal root
  works because it is a demo UI.
- The live dev endpoint redirects unauthenticated requests to Cognito.
- Current `pnpm audit --prod` reports 40 advisories: **2 critical, 13 high, 22
  moderate, and 3 low**. Critical advisories affect Next.js 14.2.35.
- The production Next.js route manifest includes
  `/api/underwrite/process.test` and `/api/underwrite/summary-pdf.test`. Both
  return HTTP 500 and should never be deployed as public routes.
- The portal root response exposes `X-Powered-By: Next.js` and no coherent
  application security-header policy in local runtime evidence.
- Recorded AWS evidence shows a healthy Cognito-fronted synthetic dev stack and
  digest-pinned parser/console images. It explicitly does not authorize real
  borrower data. Staging has an account and protected Terraform state, but no
  application platform.

## What is genuinely working

1. The underwriting console provides a compelling visual income, 1003, and
   appraisal demonstration.
2. The income parser handles native and OCR documents, mixed packets, W-2s,
   paystubs, and several tax forms with page/coordinate evidence.
3. Deterministic income calculations, MISMO mapping, paystub earnings mapping,
   and several agency rules have meaningful automated coverage.
4. The portal verifies ALB OIDC assertions, ignores caller-supplied tenant and
   role headers, requires trusted Origin on unsafe methods, and uses
   tenant-qualified database transactions.
5. Ordered migrations, restricted roles, RLS foundations, append-only audit
   events, approval idempotency, and zero-retention migrations exist.
6. Dev AWS infrastructure includes private ECS tasks, digest-pinned images,
   non-root/read-only task settings, Cognito, alarms, encrypted secrets, and
   deployment circuit breakers.

## Adversarial findings that still block production

| ID | Attack or failure scenario | Current behavior | Required exit |
| --- | --- | --- | --- |
| ADV-01 | Attacker targets a known framework RCE | Next.js 14.2.35 has two current critical advisories | Upgrade to a supported patched line; rerun tests/build/audit with zero critical/high release findings or an approved, narrowly proven non-applicability exception. |
| ADV-02 | Internet scanner discovers test endpoints | Two `*.test.ts` files compile into public API routes and return 500 | Move tests outside `pages/`; assert the production route manifest contains no tests/fixtures. |
| ADV-03 | Buyer assumes visible buttons are real | Shared-link UI creates a random mock token; Encompass, billing, and summary export are unavailable in protected runtime | Hide or label unavailable actions; never sell mocks as implemented features. |
| ADV-04 | Real user signs in but cannot complete work | Portal home renders `UnderwriterSplitViewDemo-v7`; protected summary export fails 503; Encompass and billing fail 503 | Build one complete production workflow: upload/pull, parse, review, calculate, approve/override, and export/sync status. |
| ADV-05 | Fresh environment passes health but has no schema | Local Compose starts healthy with zero application tables | Add a migration/preflight service, seed only synthetic data, and make readiness fail on incompatible or missing schema. |
| ADV-06 | Authenticated user submits manipulated calculation inputs | `/api/income/calculate` accepts client-provided `documentData` | Bind calculations to server-held/hashed parser results and loan version; reject values not derived from the approved source set. |
| ADV-07 | Cross-tenant path exists outside the tested routes | Strong tests cover auth and approval paths, not a complete object/route matrix | Generate and execute a two-tenant negative matrix for every API, job, export, share, and object lookup. |
| ADV-08 | Sensitive OCR words leak through responses/logging | Parser output minimization and ZDR runtime canaries are incomplete | Allowlist response/log fields; prove no PDF/OCR/raw XML in DB, queue, cache, files, logs, traces, or crash dumps. |
| ADV-09 | Large scans monopolize the only parser task | Parsing is synchronous; dev parser desired count is one; no autoscaling/load evidence | Add async job boundary or strict supported-size SLO, concurrency limits, cancellation, quotas, load tests, and autoscaling. |
| ADV-10 | Appraisal accepts a fake non-PDF | Text fixtures and fallback parsing remain in the service path | Disable fixtures in protected runtime; strict PDF admission; source-derived evidence or explicit unsupported status. |
| ADV-11 | Dependency or build compromise reaches production | CI covers portal/database/Terraform only; no parser/console/appraisal audit, SBOM, signing, or provenance policy | Add all-service CI, dependency/image scanning, SBOM, signing, provenance, immutable promotion, and enforcement. |
| ADV-12 | One task/AZ/database failure causes outage | Dev uses single desired tasks; staging platform, Multi-AZ, PITR restore, and production account evidence are absent | Deploy production-like staging; test HA, backup, restore, rollback, and dependency outage behavior. |
| ADV-13 | Borrower data enters a demo surface | QA console serves fixtures and development middleware; Terraform can route authenticated HTTPS to it | Keep console synthetic-only in non-prod; production must serve the portal and private parsers only. |
| ADV-14 | Duplicate/ambiguous external writes charge or modify twice | Stripe and Encompass workers are not implemented | Use durable event/outbox tables, idempotency, state machines, replay tests, reconciliation, and DLQs. |
| ADV-15 | Release cannot be reproduced from main | Assessed branch is 14 commits ahead of company main | Review/merge, require CI, tag the release candidate, and deploy only that immutable commit. |

## Product scope required for the weekend

The weekend offer must be deliberately narrow:

- Product: **FreeFlow Income Review design-partner sandbox**.
- Data: synthetic or explicitly sanitized documents only.
- Entry: manual PDF upload in the authenticated demo environment.
- Supported demo documents: the pinned W-2, paystub, and selected tax packet
  corpus that has exact expected outputs.
- Output: extracted evidence, deterministic income review, and clearly labeled
  draft results.
- Excluded: real borrower data, production SLAs, automated Encompass pull/write,
  Stripe billing, shared links, D1C vendors, appraisal scans, Encompass desktop,
  AUS/credit integrations, and claims of every tax form/layout.

This scope is marketable because it demonstrates the differentiated workflow
without pretending the production control plane is complete.

## Weekend burndown: September 15-20

Every item below is required for the weekend definition of sellable. Estimated
effort is engineering time and assumes parallel execution.

| ID | Priority | Work | Acceptance evidence | Estimate | Owner track |
| --- | --- | --- | --- | ---: | --- |
| W-01 | Stop-ship | Freeze the weekend scope above and remove contrary sales claims | One-page scope signed by product/partner; UI and demo script use the same claims | 0.5 day | Product/technical lead |
| W-02 | Stop-ship | Merge the assessed branch into `freeflowmortgage/main` | Reviewed PR; required CI green; release candidate tag points to reviewed commit | 0.5-1 day | Release |
| W-03 | Stop-ship | Remove deployed test API routes | Production route manifest has no `*.test`, fixture, debug, or source-map routes | 0.25 day | Backend |
| W-04 | Stop-ship | Upgrade critical/high production dependencies | Locked install, all tests/builds green, `pnpm audit --prod` meets release policy | 1-2 days | Platform/backend |
| W-05 | Stop-ship | Remove or clearly disable mock/non-working actions | No unlabeled fake share link, sync, billing, export, or appraisal-production action | 0.5-1 day | Frontend/product |
| W-06 | Must | Add environment banner and synthetic-data guardrails | Persistent `DEMO - SYNTHETIC DATA ONLY`; upload copy and access policy prohibit PII | 0.5 day | Frontend/security |
| W-07 | Must | Create one deterministic golden demo packet | Checked-in manifest records hashes, exact fields, pages, entities, coordinates, and expected calculations | 1 day | Parser/QA |
| W-08 | Must | Add a browser smoke for the exact sales path | Login/handoff, upload, parse, select document/entity, inspect evidence, calculate, and reset all pass | 1-2 days | QA/frontend |
| W-09 | Must | Add parser, appraisal, and console CI | Locked test dependencies; Python suites, console build, route-manifest check, and audits run on PR | 1 day | Platform |
| W-10 | Must | Make local/demo database boot deterministic or remove DB-dependent claims | Compose migration/preflight succeeds from empty volume; health/readiness distinguishes missing schema | 0.5-1 day | Backend/database |
| W-11 | Must | Add baseline security headers and remove framework disclosure | CSP appropriate to demo, frame policy, nosniff, referrer policy, permissions policy; no `X-Powered-By` | 0.5 day | Backend/security |
| W-12 | Must | Rebuild and deploy immutable demo images | Digest-pinned images scan clean, ECS reaches steady state, unauthenticated edge redirects to Cognito | 0.5-1 day | Platform |
| W-13 | Must | Execute the demo twice from a clean browser and once after restart | Recorded timestamps, commit/digests, screenshots, response times, no fallback or console errors | 0.5 day | QA/product |
| W-14 | Must | Prepare demo failure handling | Script covers unsupported document, parser timeout, reset, and explicit manual-review messaging | 0.5 day | Product/QA |

Total: approximately **8-13 engineer-days**. This fits four to five calendar
days only with at least three parallel contributors. With one engineer, keep
W-01 through W-07, W-11 through W-14, and defer broader UI polish.

## September 30 narrow-production burndown

These items are in addition to the weekend list. They are ordered by dependency,
not by team preference.

### Gate 1 - one real production workflow

| ID | Work | Acceptance evidence | Estimate |
| --- | --- | --- | ---: |
| P-01 | Replace portal demo home with a tenant-scoped loan/work queue and review flow | Authenticated user completes upload -> parse -> evidence review -> calculate -> approve/override | 4-7 days |
| P-02 | Bind calculations and exports to immutable source/result versions | Tampered client values, stale loan versions, and changed documents cannot approve or export | 2-4 days |
| P-03 | Implement approval-backed summary PDF | Protected runtime exports only the selected immutable approval; replay is deterministic | 1-2 days |
| P-04 | Finish tenant/object authorization matrix | Two-tenant negative suite covers every route, repository, job, export, and attachment reference | 2-3 days |
| P-05 | Disable shared links, Stripe, appraisal, and Encompass unless separately completed | Feature flags fail closed; unavailable capability is absent from production UI | 0.5-1 day |

### Gate 2 - production-like environment and data safety

| ID | Work | Acceptance evidence | Estimate |
| --- | --- | --- | ---: |
| P-06 | Build the staging platform, not only its state backend | Clean separate-account create, deploy, drift check, and destroy/recreate evidence | 3-5 days |
| P-07 | Production configuration and account foundation | Production account/state, DNS/TLS, Cognito, private networking, secrets, WAF, and least-privilege IAM reviewed | 3-5 days |
| P-08 | Database HA and recovery | Multi-AZ/PITR/deletion protection configured; measured isolated restore meets agreed RPO/RTO | 2-3 days |
| P-09 | Prove zero-document retention | Canary document leaves no bytes/OCR/XML in DB, queue, cache, disk, logs, traces, dumps, or backups beyond approved metadata | 2-3 days |
| P-10 | Harden runtime images | Minimal runtime, pinned bases, non-root, read-only, cap-drop, no fixtures/tests/dev deps; SBOM, signature, provenance | 2-3 days |

### Gate 3 - correctness, capacity, and operations

| ID | Work | Acceptance evidence | Estimate |
| --- | --- | --- | ---: |
| P-11 | Define a supported document matrix for launch | Each admitted type has pinned clean, filled, scanned, degraded, and mixed-packet ground truth | 3-8 days |
| P-12 | Execute parser adversarial qualification | Exact value/page/entity/coordinate results or explicit manual-review; no confident wrong values | 4-10 days |
| P-13 | Capacity and timeout qualification | Cold/warm SLOs, memory, concurrency, quotas, cancellation, and cost envelope approved | 2-4 days |
| P-14 | Observability and safe logging | Structured allowlisted logs, dashboards, alerts, correlation IDs, and an alert drill without PII | 1-2 days |
| P-15 | Run deploy/rollback/outage/DLQ/secret-rotation drills | Recorded staging results, named on-call, escalation path, and rollback artifact | 2-3 days |
| P-16 | Independent security and privacy review | No unresolved critical/high findings; ZDR flow and tenant boundaries reviewed | External lead time |

### Gate 4 - optional launch integrations

| ID | Work | Acceptance evidence | Estimate |
| --- | --- | --- | ---: |
| I-01 | Encompass eFolder pull worker | **Code complete / external qualification blocked:** tenant binding, V3 client, 40 MiB bound, byte discard, replay state, SQS/DLQ, and AWS task are implemented; obtain ICE sandbox access, confirm OAuth entitlement, capture the live response contract, and pass a synthetic end-to-end run | 1-3 days after ICE access |
| I-02 | Encompass approval sync worker | Durable `sync_jobs`, outbox/SQS state machine, stale-version check, idempotent PATCH, reconciliation/DLQ | 5-10 days plus ICE access |
| I-03 | Stripe billing ledger | Signature, server-side price/tenant reconciliation, unique events, duplicate/tamper tests | 2-4 days |
| I-04 | Secure shared links | Hashed scoped tokens, expiry, revocation, rate limits, cross-tenant tests, audit | 2-4 days |
| I-05 | Production appraisal | Strict PDF-only input, scan policy/OCR, source coordinates, isolated service deployment, qualification corpus | 5-10 days |

Do not put Gate 4 on the September 30 critical path unless a signed design
partner requires that integration. Manual invoicing and explicitly disabled
integrations are safer than rushed external writes.

## Recommended staffing and sequence

Minimum parallel staffing for the narrow September 30 pilot:

1. Product/frontend/full-stack: W-01, W-05-08, P-01, P-03, P-05.
2. Backend/security/data: W-03-04, W-10-11, P-02, P-04, P-09.
3. Platform/QA: W-02, W-09, W-12-14, P-06-08, P-10, P-13-15.
4. Parser/domain support: W-07 and P-11-12.
5. External: independent security reviewer and, only if required, ICE Encompass
   tenant administrator.

Estimated remaining effort is **35-55 engineer-days** for a narrow borrower-data
pilot, excluding Encompass, Stripe, sharing, and production appraisal. The
calendar target is possible only through parallelism and strict scope. A single
engineer should target a sellable sandbox by the weekend and production-like
staging by September 30, not real borrower-data go-live.

## Calendar execution plan

| Date | Primary outcome | Exit condition |
| --- | --- | --- |
| Sep 15 | Scope and release control | Weekend product promise frozen; branch-to-main PR open; owners assigned across three tracks |
| Sep 16 | Remove immediate security/release defects | No deployed test routes; critical/high dependency plan landed; unfinished UI actions disabled |
| Sep 17 | Make the demo deterministic | Golden packet, exact expected outputs, browser smoke, demo banner, and failure states pass |
| Sep 18 | Deploy the candidate | Reviewed main commit built, scanned, digest-pinned, deployed, and smoke-tested behind Cognito |
| Sep 19 | Rehearse and repair | Two clean-browser rehearsals and one restart rehearsal pass; only stop-ship fixes allowed |
| Sep 20 | Sellable design-partner demo | Demo and partner brief delivered with synthetic-only and feature-scope disclosures |
| Sep 21-23 | Build the real narrow workflow | Portal loan/review/approval/export path works against migrated staging data |
| Sep 24-26 | Close tenant, ZDR, supply-chain, and corpus gates | Negative matrix, retention canary, signed images, and supported-document qualification pass |
| Sep 27 | Exercise operations and independent review | Restore, rollback, outage, alert, and security/privacy review evidence recorded |
| Sep 28 | Remediate | All production critical/high findings closed and regression suite green |
| Sep 29 | Freeze release candidate | Immutable commit/digests, clean drift plan, rollback artifact, and go/no-go packet ready |
| Sep 30 | Go/no-go | Launch narrow pilot only if every production gate passes; otherwise continue the paid sandbox |

## Go/no-go rules

### Weekend sellable-demo go

Go only if W-01 through W-14 are complete, the environment is synthetic-only,
and the demo script contains no unsupported claims.

### September 30 production-pilot go

Go only if all weekend items plus P-01 through P-16 are complete. No P0 is
accepted as risk for real borrower data. If any gate fails, continue as a paid
design-partner sandbox and schedule production after closure.

### Immediate no-go conditions

- any critical/high exploitable dependency finding;
- any test/fixture/debug endpoint in the production route manifest;
- any client-controlled tenant, role, price, approval, or authoritative result;
- any real borrower document routed through the QA console;
- no measured restore or rollback;
- no independent security/privacy review;
- any confident wrong extraction in the supported launch corpus;
- unmerged or unreviewed release code.

## Sources inside this repository

- [Canonical P0/P1/P2 burndown](DEPLOYMENT-BURNDOWN.md)
- [Adversarial security assessment](SECURITY-ASSESSMENT.md)
- [Adversarial document qualification](ADVERSARIAL-DOCUMENT-QUALIFICATION.md)
- [Go-live integration map](GO-LIVE-MAP.md)
- [Application specification](APPLICATION-SPEC.md)
- [Dev parser/console rollout evidence](DEV-PARSER-CONSOLE-ROLLOUT-2026-09-14.md)
- [Dev portal rollout evidence](DEV-PORTAL-ROLLOUT-2026-09-09.md)
- [Staging foundation evidence](STAGING-FOUNDATION-2026-09-09.md)
