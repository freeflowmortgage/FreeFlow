# FreeFlow Same-Day Standalone and Encompass Completion Report

Assessment date: 2026-10-11  
Repository: `freeflowmortgage/FreeFlow`  
Branch: `test/encompass-certification-20261011`  
Implementation revision: `3a2ec81d9d3a9051f0752328f414a67c7fde0e56`  
Deployment status: **NOT DEPLOYED**  
Production approval: **NOT GRANTED**

## Executive result

| Workflow or gate | Strict result | Determination |
|---|---|---|
| Workflow A — standalone application lifecycle | **PASS — ONE-BORROWER CONVENTIONAL STANDARD APPROVAL** | A CLI Chromium run used the actual console, portal APIs, PostgreSQL, hardened parser, shared calculator, approval service, and three download routes. Only synthetic development authentication and `/runtime-config.json` were stubbed; no business API response was mocked. JSON file import was not exercised in this live run, and the multi-borrower override path fails closed. |
| Workflow A — production certification | **BLOCKED** | Official MISMO 3.4 XSD/implementation-requirement validation, repeatable live CI, live auth-negative coverage, live JSON import, multi-borrower override consistency, and live-PDF visual QA remain open. |
| Workflow B — deterministic local connector simulation | **PASS — SIMULATOR ONLY** | Synthetic loan retrieval, 14 attachment downloads, byte hashing/scrubbing, normalization, approved mapping, one write, full readback, and all four per-field statuses executed successfully. |
| Workflow B — customer integrated application workflow | **NOT IMPLEMENTED** | The real connector deliberately has no full-loan retrieval contract, the application does not orchestrate a provider snapshot into a customer loan, the direct custom-sync UI is absent, and integrated exports cannot be completed reliably from a normal hosted launch. |
| Real Encompass authentication, documents, write, and readback | **BLOCKED** | No customer-authorized non-production Encompass connection or lender-provisioned field set was available. No real provider request was represented as passing. |
| Production release | **BLOCKED** | Integrated import, authoritative program/borrower data, distributed replay protection, official MISMO validation, override consistency, and real provider certification remain release gates. |

The requested definition of done is met only for the executed one-borrower Conventional standalone standard-approval path and the explicitly labeled local Encompass engineering simulator. It is not met for a production Encompass customer workflow or customer demonstration.

This task performed no production deployment or mutation and used no real borrower document; external production state was not queried or independently revalidated.

## Status definitions

| Status | Meaning |
|---|---|
| **PASS** | The stated boundary was actually executed and met its assertions. Component and simulator boundaries are stated explicitly. |
| **FAIL** | The stated behavior was executed and did not meet the requirement. |
| **BLOCKED** | Execution requires an unavailable external prerequisite or controlled package. |
| **NOT IMPLEMENTED** | The required operational path is absent. |

## Capability matrix

### Shared architecture

| Capability | Status | Evidence and boundary |
|---|---|---|
| LOS-independent calculator | **PASS — SCOPED** | The live standalone path and post-parse Encompass simulator use the mortgage engine; LOS adapters remain outside it. No production integrated application path exists. |
| Common versioned loan model | **PASS** | `freeflow-normalized-loan-v1` supports one to four ordered borrowers, roles, program, and optional employment (`packages/mortgage-engine/src/normalizedLoan.ts`). |
| Source-neutral approved snapshot | **PASS** | `freeflow-approved-income-snapshot-v1` binds loan version, approval, calculation, borrower totals, normalized loan, and extraction provenance (`approvedIncomeSnapshot.ts`). |
| One snapshot for JSON, XML, and PDF | **PASS** | All three protected routes serialize the same tenant-scoped immutable snapshot. Repeated component and live exports were byte-identical. |
| Post-parse calculator equivalence | **PASS — POST-PARSE SIMULATOR** | Two extraction-shaped inputs with different source provenance produced identical financial and current mapper results. This does not cover import, parser, persistence, review, or export parity. |
| Full standalone-versus-integrated parity | **NOT IMPLEMENTED** | There is no production integrated import workflow to run through the same document/parser/review/export sequence. |

### Workflow A — standalone

| Required capability | Status | What was verified |
|---|---|---|
| Manual loan creation through the application | **PASS** | Live CLI Chromium created a one-borrower Conventional loan through the real portal route. The route is tenant-scoped, versioned, audited, and idempotent. |
| Supported JSON loan-file import | **PASS — ROUTE/UI CONTRACT** | The console reads `freeflow-standalone-loan-v1` JSON and submits the same protected create route. The committed browser test is explicitly an intercepted-API UI contract; the live run used manual creation. |
| No LOS dependency | **PASS** | The live loan persisted with integration mode `NONE`; no Encompass/ICE environment was supplied. |
| Direct document upload | **PASS** | A synthetic scanned paystub was uploaded through the real route. PDF media/content/size checks, content-addressed identity, and buffer clearing executed. |
| Actual parser/OCR | **PASS** | The hardened parser processed the uploaded scan. This was not a post-parse-only test. |
| Review and reconciliation | **PASS** | The UI completed required metadata review before calculation. |
| Shared income calculation | **PASS** | The live result was `$5,721.67` monthly and `$68,660.04` annual. |
| Approval | **PASS** | The current calculation was explicitly approved through the protected approval route. |
| Normalized JSON download | **PASS** | Downloaded through the real protected route and checked against the approved snapshot. |
| MISMO XML download | **PASS — FREEFLOW PROFILE** | XML was downloaded, was well formed, declared `3.4.0`, and passed `freeflow-approved-income-mismo-3.4-profile-v1`. |
| Official MISMO XSD/implementation requirements | **BLOCKED** | `NOT_PERFORMED_OFFICIAL_XSD_NOT_BUNDLED`; no official schema or selected business implementation package was available locally. |
| Human-readable PDF download | **PASS** | Downloaded through the real route; PDF signature, content, shared snapshot, hash, and repeat-byte identity were checked. A separate deterministic PDF was rendered and visually inspected; the live-run PDF itself was not visually rendered. |
| Reopen consistency | **PASS** | Reloading retained loan, extraction, calculation, approval, and export consistency. |
| Duplicate upload/export idempotency | **PASS** | Re-uploading the same PDF retained one document and one extraction; repeated exports were byte-identical. |
| Tenant isolation | **PASS** | A second tenant received non-disclosing `404 LOAN_NOT_FOUND` for the first tenant's export. RLS and app-role suites also passed. |
| Browser anonymous/expired-token cases | **PASS — COMPONENT; NOT RUN LIVE** | Auth/session tests pass in the portal suite. The live browser used a synthetic development-auth boundary and did not execute anonymous or expired-token browser cases. |
| Multi-borrower override exports/writeback | **FAIL** | An override can change the loan total while retaining old borrower totals, so the snapshot correctly fails closed. Override binding copy also omits metadata-review provenance. Standard approval passes. |

### Workflow B — Encompass integrated

| Required capability | Status | What was verified |
|---|---|---|
| Pluggable connector boundary | **PASS — COMPONENT** | The core calls an explicit connector contract; the custom connector remains separately deployable. |
| Portal-to-connector authentication | **PASS — SINGLE PROCESS** | Signed method/path/timestamp/nonce/body hash, tenant/lender binding, and replay rejection pass locally. |
| Distributed replay protection | **NOT IMPLEMENTED** | Nonce claims use a process-local map. A multi-task ECS service could accept one captured request per task within the clock window. |
| Connector-to-ICE OAuth | **PASS — FAKE HTTP; REAL BLOCKED** | Client-credential request behavior is covered with injected fake HTTP. No real token was requested. |
| Simulated loan retrieval and normalization | **PASS — SIMULATOR** | `encompass-loan-snapshot-v1` normalized to `freeflow-normalized-loan-v1`. |
| Real full-loan retrieval | **NOT IMPLEMENTED** | `EncompassV3Connector.retrieveLoanSnapshot` deliberately throws `ENCOMPASS_LOAN_RETRIEVAL_NOT_IMPLEMENTED` until a lender-approved provider schema/field contract exists. |
| Production application import orchestration | **NOT IMPLEMENTED** | `normalizeEncompassLoanSnapshot` is called only by simulator/test code, not by a customer portal workflow. |
| Authoritative loan program import | **NOT IMPLEMENTED** | Hosted launch imports only GUID/mode; a new record otherwise defaults to Conventional. FHA/VA calculation cannot be certified. |
| Borrower/employment/income import | **NOT IMPLEMENTED** | Normal hosted launch does not import an authoritative roster or employment/income application payload. |
| Attachment list/download | **PASS — SIMULATOR/FAKE HTTP; REAL BLOCKED** | V3 list and original-download behavior, bounds, hashing, and buffer scrubbing pass locally. Real provider retrieval is blocked. |
| Document parser/persistence/review through integrated path | **NOT IMPLEMENTED end-to-end** | The `$21,600` parity fixture begins post-parse; the simulator's 14 downloaded PDFs are not sent through the production parser/persistence/review chain. |
| Exact current mapper | **PASS — SIMULATOR** | Thirteen approved custom fields, including W-2 variable, asset, and borrower totals, matched the independent expected map. |
| Lender-specific mapping | **PASS — COMPONENT** | A server-authoritative JSON override is validated against the lender/deployment binding and fails closed on missing/invalid mappings. Real lender provisioning is unverified. |
| Reviewer preview bound to exact write | **PASS — COMPONENT** | Server builds sorted fields from the immutable approval; approval ID and preview hash must match; exact fields are persisted and consumed without recomputation. |
| Direct connector full-field readback | **PASS — LOCAL COMPONENT; REAL BLOCKED** | Worker compares every intended field, returns SUCCESS/REJECTED/UNAVAILABLE/CONFLICT, and reconciles ambiguous PATCH outcomes with read-only retries. |
| Readback metadata minimization | **PASS** | Value comparison occurs in memory. Persistence/status retain only allowlisted field name, status, and reason code; raw values and low-entropy value hashes are omitted. |
| Direct custom-sync customer UI | **NOT IMPLEMENTED** | API client methods exist, but the protected UI does not display the exact preview or invoke the direct create/status flow. |
| Hosted full-field bridge comparison | **PASS — COMPONENT ONLY** | The bridge now rereads and strictly compares every approved field after commit. |
| Hosted authoritative completion | **NOT IMPLEMENTED / DISABLED** | Production HTTP authorization/completion return `503 ENCOMPASS_HOST_WRITEBACK_NOT_CERTIFIED`; a client claim cannot set `SUCCEEDED`; the UI is disabled. Legacy client-reported rows are exposed as `certified:false`, `current:false`. |
| Integrated JSON/XML/PDF workflow | **NOT IMPLEMENTED** | Normal hosted launch lacks authoritative program/roster data required by the approved snapshot, and there is no real custom-import orchestration. |
| Simulated write/readback | **PASS — SIMULATOR** | One synthetic mutation and independent full-field readback passed; separate behavior produced all four supported per-field statuses. |
| Real write/readback | **BLOCKED** | No authorized lender test tenant, provisioned fields, or written authorization was available. |
| Repeated integrated import/export | **NOT IMPLEMENTED** | Full integrated import and customer exports do not exist. Connector attachment and write idempotency pass at component scope. |

## Implemented mechanism inventory

### Standalone flow

1. `POST /api/v1/loans` validates `freeflow-standalone-loan-v1`, program, one-to-four stable borrower keys/roles, idempotency, tenant ownership, and audit creation.
2. Direct upload accepts a bounded PDF, validates signature/media type, derives `upload-sha256-{contentHash}`, calls the parser in memory, and clears all buffers on success and failure.
3. Metadata review, calculation, and approval reuse the existing protected application services and mortgage engine.
4. The approved snapshot verifies calculation freshness and that borrower totals reconcile to the loan total.
5. Protected JSON, XML, and PDF routes serialize the same snapshot.

### Encompass flow

The primary direction is a private custom connector using lender-scoped server configuration and signed service-to-service calls. The provider adapter implements OAuth, V3 attachment list/download, bounded custom-field PATCH, and field reads. It intentionally does not implement a guessed full-loan schema.

The direct sync backend is safer than the hosted path: it builds an exact server-authoritative preview, binds reviewer confirmation to a hash, persists the exact fields under tenant RLS, applies at most once, and independently reads every field. Ambiguous network/408/429/5xx outcomes enter read-only reconciliation rather than repeating PATCH.

The hosted browser bridge can compare every field locally, but it cannot provide server-verifiable provider evidence. Its production routes are therefore disabled.

## Exact simulator write map

These are repository-defined synthetic/custom mappings, not proof that a real lender has provisioned them.

| Field | Intended value |
|---|---:|
| `CX.FREEFLOW.INCOME` | `21600.00` |
| `CX.FREEFLOW.TRENDING` | `SINGLE_YEAR` |
| `CX.FREEFLOW.AUDIT.URL` | synthetic audit URL |
| `CX.FREEFLOW.YEARS` | `2025` |
| `CX.FREEFLOW.SCH.C` | `8000.00` |
| `CX.FREEFLOW.FORM.1065` | `5000.00` |
| `CX.FREEFLOW.W2.BASE` | `4000.00` |
| `CX.FREEFLOW.W2.VARIABLE` | `1600.00` |
| `CX.FREEFLOW.ASSET.INCOME` | `1000.00` |
| `CX.FREEFLOW.RENTAL` | `2000.00` |
| `CX.FREEFLOW.BORROWER.1.INCOME` | `5600.00` |
| `CX.FREEFLOW.BORROWER.2.INCOME` | `16000.00` |
| `CX.FREEFLOW.APPROVAL.ID` | synthetic approval UUID |

Preview hash: `cfb826e94ff15f15a7f977a80285eb6f0bea820dfddee50a9d6959fa35687447`.

## Live standalone acceptance

The strongest standalone result was a CLI Playwright run against live local services. It is not the committed intercepted-API UI contract test.

### Boundaries

- Full-live runtime revision: `d72c1fad75b08361859b4665d834fc4b6b755266`; subsequent branch changes were not rerun through the disposed full stack and are covered only by the reported unit/build/component gates.
- Synthetic development authentication: stubbed.
- `/runtime-config.json`: stubbed.
- Every `/api/*` request: forwarded unchanged to the live portal.
- PostgreSQL: disposable tmpfs database with current migrations and RLS.
- Parser: hardened container, real OCR/extraction.
- Business API responses mocked: `false`.
- In-app browser: unavailable; this is explicitly CLI Playwright.

### Executed sequence

1. Create a one-borrower Conventional standalone loan in the UI.
2. Upload one generated synthetic scanned paystub PDF.
3. Wait for live OCR/extraction.
4. Review employment role `CURRENT`, tax year `2023`, and six elapsed months.
5. Calculate and verify `$5,721.67` qualifying monthly income.
6. Approve the current calculation.
7. Download JSON, MISMO XML, and summary PDF.
8. Reload/reopen the loan.
9. Re-upload the same PDF and verify one document/extraction remains.
10. Download again and compare byte identity.
11. Use Tenant B to request Tenant A's export and verify non-disclosing `404 LOAN_NOT_FOUND`.

### Sanitized observed result hashes

The original run retained these hashes but intentionally destroyed the live PDF/input/output bytes during cleanup. They are execution metadata, not files that can be independently rehashed from this bundle. The separately committed component-export bundle contains retained synthetic JSON/XML/PDF artifacts.

| Item | SHA-256 |
|---|---|
| Synthetic scanned input fixture | `335fb87ed412e0850533561451391db8968e25acd8ab4d983a42c027bb4af077` |
| Approved snapshot | `637e72028503599e9901d28627368faac1c7d3b9c2fb6c2c9cb1a3a66a9a58ce` |
| JSON export | `5c4dfc1b2228037a7fbd8f73130214f4e909670f29ddf85a73061c62d86cf581` |
| MISMO XML export | `19ed0689d51463fd61702c7bcde431924d74f366abb69d66e41001c769500486` |
| Summary PDF export | `b47bb5e4a0fbd5101803fdb711f6a6bf8f6aa0f129c0f8c9890d8a01f4112622` |

Final persistence: one document, one active extraction, one calculation, and one approval. The loan was version 4 with loan status `VERIFIED`; extraction status was `ACTIVE`.

## MISMO determination

The selected reference-model identifier is `3.4.0`; the application-specific profile is `freeflow-approved-income-mismo-3.4-profile-v1`. The exporter performs deterministic structural/profile assertions and clearly embeds `NOT_PERFORMED_OFFICIAL_XSD_NOT_BUNDLED`.

MISMO's official XML page lists Version 3.4 among published schema versions and describes an official release as including the XML Schema, logical data dictionary, change list, and release notes: <https://www.mismo.org/standards-resources/residential-specifications/reference-model/xml-schema>.

The repository contains no official `.xsd`, Schematron, or selected business implementation-requirement bundle. Therefore:

- FreeFlow profile validation: **PASS**.
- Official XSD/implementation-requirement validation: **BLOCKED**.
- “MISMO-certified,” “officially schema-valid,” or equivalent customer claim: **not permitted** from this evidence.

## Security and isolation results

- Synthetic data only; no customer documents, credentials, SSNs, or production mortgage data were used.
- Parser ran as UID/GID `8888`, read-only root, all capabilities dropped, `no-new-privileges`, and tmpfs `/tmp`.
- No raw document `bytea` column exists in the document/extraction tables.
- A one-off parser/portal sensitive-content scan reported zero hits during the live run. Its raw logs, exact pattern set, and result digest were not retained, so this observation is not independently reproducible from the bundle.
- Provider failures are reduced to allowlisted safe codes and identifiers; arbitrary provider messages are not logged.
- Upload/download buffers are cleared on success and failure paths.
- Tenant-scoped queries, RLS, connector binding, and cross-tenant denial passed.
- Exact write-preview fields are stored tenant-scoped under RLS because the worker must consume the reviewer-approved immutable set. They must receive normal production database encryption, backup, and access controls.
- Field readback persistence/API output contains only field name, status, and reason code—no raw values or deterministic hashes of low-entropy income values.
- Hosted writeback cannot be authorized/completed through production HTTP and cannot transition to `SUCCEEDED` from a browser assertion.

## Tests and reproduction

### Committed deterministic commands

```powershell
corepack pnpm --filter web test
corepack pnpm --filter web exec tsc --noEmit
corepack pnpm --filter web build

corepack pnpm --filter @mortgage-pos/mortgage-engine test
corepack pnpm --filter @mortgage-pos/mortgage-engine build

corepack pnpm --filter @mortgage-pos/encompass-connector-contract test
corepack pnpm --filter @mortgage-pos/encompass-connector-contract build

corepack pnpm --filter @mortgage-pos/encompass-connector test
corepack pnpm --filter @mortgage-pos/encompass-connector build

corepack pnpm --filter underwriting-console test:runtime
$env:VITE_FREEFLOW_RUNTIME_MODE='protected-web'
corepack pnpm --filter underwriting-console build
Remove-Item Env:VITE_FREEFLOW_RUNTIME_MODE

corepack pnpm --filter underwriting-console test:e2e:standalone -- --reporter=line
corepack pnpm --filter web run certify:encompass
corepack pnpm --filter web run certify:standalone-exports
```

The reusable live suite is intentionally separate and must point at a disposable environment whose server-side development auth/proxy has already been configured for the intended synthetic tenant. The harness creates a fresh browser context and intentionally provides no `storageState`, login bootstrap, or auth injection; it does not mock business APIs:

```powershell
$env:LIVE_APP_URL='http://127.0.0.1:3014'
$env:LIVE_PHASE='main'
$env:LIVE_FIXTURE_IMAGE='<locally-built-parser-image>'
corepack pnpm --dir apps/underwriting-console run test:e2e:live

# Restart/proxy the server-side synthetic auth boundary as Tenant B first.
$env:LIVE_PHASE='cross-tenant'
$env:LIVE_LOAN_ID='<synthetic-loan-uuid-created-by-main-phase>'
corepack pnpm --dir apps/underwriting-console run test:e2e:live
```

Non-loopback targets require HTTPS; a remote main phase also requires the explicit `LIVE_ALLOW_REMOTE_SYNTHETIC_WRITES=1` safety acknowledgement. The exact Tenant A/Tenant B server-side auth orchestration used for the original one-off run was removed with its disposable stack and is not encoded in this harness, so these commands alone are not a self-contained reproduction. Use only an authorized non-production environment and synthetic data.

### Database commands

Run only against a disposable PostgreSQL database with separate migrator, app, and worker roles:

```powershell
$env:ADMIN_DATABASE_URL='<ephemeral-admin-url>'
$env:MIGRATOR_DATABASE_URL='<ephemeral-migrator-url>'
$env:APP_DATABASE_URL='<ephemeral-app-role-url>'
$env:WORKER_DATABASE_URL='<ephemeral-worker-role-url>'

# First create the capability/login roles using the two bootstrap files and
# the same role names/credentials encoded in the URLs above. The exact psql
# variable sequence is maintained in .github/workflows/database-validation.yml.
$env:DATABASE_URL=$env:MIGRATOR_DATABASE_URL
corepack pnpm --dir packages/database exec prisma migrate deploy --schema prisma/schema.prisma
corepack pnpm --dir packages/database exec prisma generate --schema prisma/schema.prisma

psql $env:ADMIN_DATABASE_URL -v ON_ERROR_STOP=1 -f packages/database/prisma/tests/tenant-rls-isolation.sql
psql $env:ADMIN_DATABASE_URL -v ON_ERROR_STOP=1 -f packages/database/prisma/tests/encompass-connector-bindings.sql

$env:DATABASE_URL=$env:APP_DATABASE_URL
corepack pnpm --dir apps/underwriter-portal exec tsx --test src/server/database/*.integration.test.ts

$env:DATABASE_URL=$env:WORKER_DATABASE_URL
corepack pnpm --filter @mortgage-pos/encompass-connector test:database-bindings
```

`ADMIN_DATABASE_URL` must remain set for the app-role suite because the standalone lifecycle fixture uses the administrator only to create its fixed synthetic tenant/user before exercising all application operations through the restricted app role. For a zero-to-head run, use `.github/workflows/database-validation.yml` as the authoritative full bootstrap sequence.

### Browser boundary

The committed `test:e2e:standalone` suite is an explicitly labeled UI contract with intercepted APIs. The separate live CLI run described above used no mocked business API. A reusable two-phase harness is now committed in `apps/underwriting-console/e2e-live/standalone-live.spec.ts`; its TypeScript check and two-test discovery pass, and its deterministic fixture-generation preflight produced SHA-256 `0c32930fafb11d3ad5ddeb205518974209468552314497eae3190ea09342dccf`. The newly committed harness was not rerun through the full disposed service stack, so the earlier live run remains the execution record. Do not substitute discovery, preflight, or the intercepted UI-contract result for a live acceptance pass.

## Evidence inventory

| Evidence | Classification | Contents |
|---|---|---|
| [`evidence/standalone-approved-income-exports-2026-10-11`](evidence/standalone-approved-income-exports-2026-10-11/) | Sanitized synthetic component execution | Approved snapshot, JSON, XML, PDF, FreeFlow-profile validation, execution report, byte/hash manifest. One borrower, `$8,000`; distinct from the live browser fixture. |
| [`evidence/encompass-certification-2026-10-11`](evidence/encompass-certification-2026-10-11/) | Post-parse and connector simulator only | Two normalized projections, `$21,600` calculator result, intended fields, simulated loan/docs/write/readback, MISMO limitation record, manifest. No XML is produced for this fixture. |
| [`evidence/same-day-certification-2026-10-11`](evidence/same-day-certification-2026-10-11/) | Sanitized execution consolidation | Strict status report, live CLI Playwright result, database/security result, test summary, and manifest binding the other evidence manifests. |

The three fixtures are intentionally separate. The `$8,000` export component, `$5,721.67` live standalone lifecycle, and `$21,600` Encompass post-parse simulator must not be combined into a false full-path parity claim.

## Database and migration impact

Three migrations are added and must deploy before the corresponding code:

1. `20261011090000_standalone_loan_creation_audit` — admits `STANDALONE_LOAN_CREATED` to the immutable audit action constraint.
2. `20261011100000_encompass_sync_field_readback` — adds sanitized per-field status/reason JSON.
3. `20261011110000_encompass_sync_approved_preview` — adds exact preview schema/hash/fields and completeness constraints.

The disposable database gate applied all migrations with no rollback/incomplete row, passed RLS/binding SQL, seven app-role tests, and three worker-role tests. No persistent database was changed.

## Deployment prerequisites

Do not enable production Encompass import or writeback yet. For a future controlled environment:

1. Deploy the migrations in order with the migration role; validate checksums and RLS before application tasks start.
2. Configure `APP_ORIGIN` as an exact HTTPS origin.
3. Configure parser service discovery and RAM-only/container hardening.
4. Configure SQS sync/document queues and DLQs without document bytes in messages.
5. Configure `ENCOMPASS_CONNECTOR_SERVICE_URL`, signed service ID/key through the approved secret store, and an authoritative tenant-to-lender/deployment binding.
6. For every production tenant, explicitly query and assert `enableEncompassSync = false` until all P0 gates below close. The development-only staging seed currently enables it; do not run that seed against production and do not infer a safe production default from it.
7. Configure `ENCOMPASS_LENDER_FIELD_MAPPINGS_JSON` only from lender-approved field IDs/types.
8. Use ECS task roles; do not inject long-lived AWS access keys.
9. Keep hosted writeback disabled. Its production routes intentionally return `503`.
10. Use only an authorized non-production lender tenant and synthetic loan for real certification; obtain written authorization before any write.

## Ordered remediation plan

### P0 — required before production/customer Encompass use

1. Define and implement the lender-approved real loan snapshot contract, including authoritative program, borrower roster, employment, and income fields; connect it to the portal import workflow.
2. Replace process-local replay claims with a shared atomic TTL store suitable for multiple ECS tasks.
3. Add a protected customer UI for direct custom-connector exact preview, explicit confirmation, job status, and per-field readback.
4. Keep hosted writeback disabled unless a trusted service-to-service/provider attestation makes full-field readback independently verifiable server-side.
5. Inventory any historical `EncompassHostWrite=SUCCEEDED`/`EXPORTED_TO_LOS` records from prior deployments and treat them as unverified. Console-context API output now marks legacy rows uncertified/non-current, but the underlying status, loan state, and immutable audit rows are not migrated.
6. Obtain the official MISMO 3.4 schema plus the selected implementation requirements, add licensed CI validation, and resolve every validation error.
7. Correct override semantics so loan and borrower totals reconcile and metadata-review provenance is retained; add multi-borrower override export/write tests.
8. Execute real authorized non-production Encompass auth, loan import, document retrieval, exact preview, one approved write, independent full-field readback, retry/idempotency, and sanitized evidence capture.

### P1 — required for production-quality standalone assurance

1. Promote the live no-business-API-mock Playwright lifecycle into repeatable CI with disposable PostgreSQL/parser services.
2. Add live browser anonymous, expired-session, insufficient-role, malformed-file, conflicting-document, and parser/provider-failure cases.
3. Run the JSON file-import path against the live backend, not only the UI contract.
4. Expand semantic PII/evidence scanning beyond exact forbidden strings.
5. Render and visually inspect the live-run summary PDF in CI in addition to signature/content/hash checks.

### P2 — operational hardening

1. Add evidence signing/retention policy and automated manifest verification.
2. Add dashboards/alarms for reconciliation exhaustion, RLS denials, parser failures, and disabled hosted-write attempts without logging mortgage data.
3. Re-run restore, rollback, multi-task replay, and connector blast-radius exercises before production approval.

## Final deployment decision

- Standalone development/customer demonstration: the one-borrower Conventional standard-approval path is **functionally executable with synthetic data**; JSON file import lacks a live run, multi-borrower override fails closed, and the XML must not be marketed as officially MISMO validated.
- Standalone production approval: **BLOCKED** pending official MISMO validation and the remaining production-readiness program outside this bounded task.
- Encompass customer demonstration: **BLOCKED**. The deterministic simulator is engineering evidence only and must not be presented as a customer workflow or ICE interoperability.
- Encompass production: **NOT IMPLEMENTED/BLOCKED** as detailed above.
- AWS deployment performed by this task: **none**.
