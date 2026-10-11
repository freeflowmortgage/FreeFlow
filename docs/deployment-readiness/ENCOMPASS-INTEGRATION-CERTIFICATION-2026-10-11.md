# FreeFlow Encompass Integration Certification

Assessment date: 2026-10-11  
Repository: `freeflowmortgage/FreeFlow`  
Base revision: `6d7261af55d3590aa931ebfa11fa54ca898b0f77`  
Assessment branch: `test/encompass-certification-20261011`  
Overall result: **NOT CERTIFIED FOR PRODUCTION INTEROPERABILITY OR THE COMPLETE CUSTOMER WORKFLOW**

## Executive determination

FreeFlow has a meaningful, security-conscious Encompass integration foundation and a shared income-calculation path. The code implements a private connector contract, tenant/lender binding, signed service-to-service requests, ICE OAuth, V3 attachment listing/download, protected calculation and approval, direct custom-field writeback, and an Encompass-hosted browser write path.

This assessment found no repository evidence of a successful round trip against a real, customer-authorized Encompass installation. Existing AWS, browser, connector, and hosted-bridge evidence is synthetic, mocked, or component-level. Real Encompass retrieval and write/read-back are therefore **BLOCKED**, not PASS.

The required standalone customer workflow is also incomplete. A user can upload a PDF and calculate against an already-existing FreeFlow loan, but cannot create/import a standalone loan through the protected product. The product does not provide approved-result downloads for normalized JSON or MISMO XML, and the protected underwriting-summary endpoint returns `503 SUMMARY_DATA_UNAVAILABLE`. Consequently, the stated acceptance criteria are not met.

The executed field-contract comparison also failed completeness: calculated W-2 variable and asset income are included in the total but omitted from the current approved write map, despite matching custom-field definitions elsewhere in the repository.

Operational error-log redaction also failed review. The executed worker suite printed the synthetic provider message `sensitive provider response`; current pattern-based redaction does not guarantee that arbitrary provider text or document-related detail is removed before logging.

The new deterministic harness proves one narrower claim: equivalent synthetic, post-parse records given integrated and standalone provenance produce identical financial results and exact current approved-mapper outputs through the shared production calculator. It does not execute either external document boundary, parser, persistence, or review workflow, and the current mapper is incomplete. Every generated artifact labels that boundary `POST_PARSE_SIMULATOR`; it is not proof of ICE interoperability.

No production connector behavior, feature flag, deployment, customer record, or live Encompass loan was changed during this assessment.

## Status definitions

| Status | Meaning in this report |
|---|---|
| PASS | The stated scope was actually executed successfully. The row identifies simulator/component scope where applicable. |
| FAIL | The capability was executed and did not meet its required behavior. |
| BLOCKED | Execution requires a missing external prerequisite, such as an authorized Encompass test tenant, official selected MISMO schema package, PostgreSQL test database, or Python runtime. |
| NOT IMPLEMENTED | The required operational capability is absent from the current product path. |

## Certification boundary

- All new fixture identities, UUIDs, company names, addresses, and values are synthetic.
- The new fixture contains post-parse, persisted-extraction-shaped records only. It intentionally links no PDF bytes or PDF hashes.
- Existing repository synthetic PDFs were evaluated and rejected as provenance for this fixture because their semantic values do not match all normalized records. The document-to-parser pipeline therefore remains outside the harness and BLOCKED in this environment.
- Generated evidence contains metadata and structured synthetic values only; it contains no PDF bytes, OCR text, SSNs, customer data, ICE credentials, or access tokens.
- Direct REST and hosted writeback were exercised only by existing fake-HTTP/fake-host component tests. The new in-memory field comparison exercises the mapper and object projection, not connector writeback or readback.
- No live ICE token was requested and no real Encompass field was read or written.

## 1. Implemented architecture inventory

### 1.1 Connector mechanism

The primary server-side integration is a separately deployed private connector service, reached through `CustomConnectorAdapter`. The connector contract exposes only attachment listing, original attachment download, approved-income update, and field reads (`packages/encompass-connector-contract/src/connector.ts:14-34`). It does not expose full loan import.

The direct provider implementation is `EncompassV3Connector` in `services/encompass-connector/src/connector/encompassApiClient.ts`:

| Operation | Implementation | Verified status |
|---|---|---|
| FreeFlow-to-connector authentication | HMAC timestamp, nonce, and body-hash validation (`signedReplay.ts:26-51`) | PASS in component tests; replay store remains process-local (`signedReplay.ts:12-14`) |
| Connector-to-ICE authentication | OAuth client credentials with `instance_id` and `scope=lp` (`encompassApiClient.ts:161-185`) | PASS with fake HTTP responses; real ICE authentication BLOCKED |
| Loan binding | Tenant-scoped Encompass GUID binding; hosted launch creates identity-only loan/borrower records (`hostLaunchRoute.ts:13-33`) | PASS in route tests |
| Full loan import | No connector method or protected route imports the full loan/application payload | NOT IMPLEMENTED |
| Attachment list | `GET /encompass/v3/loans/{guid}/attachments?activeOnly=true&view=Summary` (`encompassApiClient.ts:38-60`) | PASS with fake/synthetic boundary; real ICE BLOCKED |
| Original document retrieval | V3 short-lived attachment download URL followed by bounded PDF download (`encompassApiClient.ts:63-91`) | PASS with fake/synthetic boundary; real ICE BLOCKED |
| Income mapping/calculation | Persisted extraction projection plus `calculateProtectedBorrowerIncome`, backed by the shared mortgage engine (`borrowerIncomeCalculation.ts:16-37`) | PASS in component and deterministic certification tests |
| Direct writeback | V1 loan PATCH containing bounded `customFields` (`encompassApiClient.ts:94-124`) | PASS with fake HTTP; real ICE BLOCKED |
| Direct readback | V1 custom-field read; production worker reconciles only `CX.FREEFLOW.APPROVAL.ID` (`syncWorkerRuntime.ts:159-160`) | Marker PASS with fake HTTP; complete-map readback NOT IMPLEMENTED; real ICE BLOCKED |
| Hosted writeback | `elli.script` bridge rechecks active loan/read-only state, writes fields, calculates, commits, and checks approval marker (`apps/underwriting-console/src/encompass-host/bridge.ts:46-63`) | PASS with fake host; real hosted Encompass BLOCKED |

The optional Developer Connect adapter is present in the connector-contract package, but the portal factory creates only the separate custom connector client (`createEncompassConnector.test.ts:5-18`). This is consistent with the stated pluggable-connector direction, but conflicts with repository history and current documentation as described in section 6.

### 1.2 Integrated workflow as implemented

1. Hosted mode binds an authenticated FreeFlow tenant loan to an active Encompass GUID; the launch payload can include a borrower roster, but not complete loan data.
2. The portal requests selected active attachment IDs through the private connector.
3. The document-pull worker downloads one PDF at a time, parses it in memory, persists metadata/extraction data, and clears the byte buffer (`documentPullWorker.ts:36-81`).
4. The protected income route loads current tenant-scoped persisted extractions, performs metadata/freshness checks, and calls the shared calculation engine (`pages/api/income/calculate.ts:58-178`).
5. Human approval is a separate, version-checked event. Writeback is separately authorized and optional.
6. Direct sync or the hosted bridge maps only an approved calculation and writes a bounded custom-field payload.

This is attachment-led processing tied to an Encompass loan GUID, not a complete Encompass loan import.

### 1.3 Standalone workflow as implemented

1. Non-hosted protected mode requires an existing `?loanId=` and stops without it (`apps/underwriting-console/src/ProtectedApp.tsx:108-123`).
2. The user may upload an `application/pdf` directly for that existing loan (`ProtectedApp.tsx:192-210,395-400`).
3. The upload route verifies tenant ownership, retains bytes in memory, calls the same parser, calls the same persistence service with source `AUTHENTICATED_UPLOAD`, and clears the buffer (`uploadIncomeDocumentRoute.ts:19-60`).
4. Subsequent review, calculation, and approval use the same protected services as connector-originated documents.

No `POST /api/v1/loans` route, manual loan-creation UI, or supported loan-file import path exists. Therefore this is not a complete standalone customer workflow.

### 1.4 Shared and versioned models

The two document paths converge on `income-extraction-v2`, the `authoritative-extractions-v1` projection, and the shared Form 1084 calculation engine. Those are useful versioned calculation boundaries.

There is no common, version-discriminated internal model for a complete loan/application import. `LoanApplication.version` is a persistence/concurrency version, and `UnifiedIncomeCalculationPayload` is an income-calculation input rather than a full loan contract. The certification harness's normalized-loan JSON is deliberately test-only and does not close this production architecture gap.

## 2. Required certification capability matrix

| Required capability | Status | What was verified |
|---|---|---|
| Integrated loan import and calculation | NOT IMPLEMENTED | Full loan import is absent. GUID binding and the post-parse connector projection calculate successfully in component/simulator scope. |
| Real Encompass attachment retrieval | BLOCKED | Requires a customer-authorized test tenant and lender-approved credentials/binding. |
| Standalone import and calculation | NOT IMPLEMENTED | Existing-loan PDF upload and calculation components pass; customer loan creation/file import is absent. |
| Equivalent post-parse financial results | PASS — POST-PARSE HARNESS | Equivalent records with different source provenance produced identical financial results and mapped fields. Pull/upload/parser/persistence/review equivalence was not exercised. |
| Customer JSON export | NOT IMPLEMENTED | The protected product has no approved-result JSON download. |
| Harness JSON serialization | PASS — HARNESS | A deterministic, source-neutral, versioned harness result was generated and parsed. |
| MISMO XML export validation | NOT IMPLEMENTED | No approved-income MISMO artifact was produced. Official XSD/implementation-requirement validation is BLOCKED because no single schema release or implementation guide is selected. |
| Customer underwriting-summary export | NOT IMPLEMENTED | The protected endpoint intentionally returns 503; its fail-closed behavior passes its test, but the required export capability is absent. |
| Harness summary consistency | PASS — HARNESS | Harness text matched both post-parse projections. It is not a customer artifact. |
| Approved-field mapping and in-memory projection | PASS — HARNESS | The actual mapper produced the expected field object; an in-memory object overlay and comparison passed. This is not writeback/readback. |
| Approved-field contract completeness | FAIL | Executed comparison found that calculated W-2 variable income and asset income have provisioned custom-field definitions but are omitted by the approved write mapper. |
| Mocked connector/host write and marker readback | PASS — COMPONENT | Existing fake-HTTP and fake-host tests exercise write calls and approval-marker reconciliation. |
| Real Encompass writeback and readback | BLOCKED | No authorized customer test connection was available. |
| Complete operational field readback | NOT IMPLEMENTED | Direct and hosted production paths reconcile only the approval marker, not every intended field. |
| Provider error-log redaction | FAIL | Executed worker tests printed arbitrary synthetic provider response text to the operational log; allowlisted safe-code/type logging is not enforced. |
| Coherent synthetic supporting-document fixture set | NOT IMPLEMENTED | Existing repository PDFs do not semantically match all post-parse records in this certification fixture. |
| Actual document-to-parser fixture execution | BLOCKED | A coherent document set is absent and the Python parser runtime is unavailable. |
| Standalone operation with all LOS connections disabled | NOT IMPLEMENTED end-to-end | Shared upload/calculation services do not require LOS, but loan creation/import and three customer downloads are missing. |
| Graceful fallback when connector is unavailable | NOT IMPLEMENTED end-to-end | Non-hosted mode and upload exist, but the user cannot start a new loan or obtain all required exports. |
| Repeated integrated import without unintended changes | NOT IMPLEMENTED | Full integrated loan import does not exist. |
| Repeated connector attachment persistence | PASS — COMPONENT | Same attachment/hash replay and changed-hash versioning are covered by persistence tests (`documentPullWorkerRuntime.test.ts:23-92,171-238`). |
| Repeated standalone import without duplicates | NOT IMPLEMENTED | Each HTTP upload receives a new `upload-${randomUUID()}` ID (`uploadIncomeDocumentRoute.ts:47-54`), while deduplication keys on source attachment identity. |
| Repeated operational export | NOT IMPLEMENTED | The three required approved-result export endpoints do not exist. |

### Acceptance decision

| Acceptance criterion | Decision |
|---|---|
| Customer without Encompass completes analysis and downloads JSON, MISMO, and summary | **NOT MET** — loan creation/import and operational exports are not implemented |
| Customer with Encompass completes the same analysis/exports and optionally writes approved values to the correct loan | **NOT MET** — full import/exports are incomplete and real interoperability is blocked |
| Simulator success is not represented as real interoperability | **MET** — code, tests, reports, and artifacts label the boundary explicitly |

## 3. Deterministic synthetic post-parse fixture and independently expected values

Fixture: `apps/underwriter-portal/src/server/integrations/encompass/fixtures/encompass-certification-v1.json`  
Classification: `SYNTHETIC_POST_PARSE_SIMULATOR_ONLY`  
Boundary: `POST_PARSE_PERSISTED_EXTRACTION_SHAPE`

The fixture defines two synthetic borrowers and six post-parse source descriptors: paystub, matching W-2, Schedule C, Form 1065/K-1, Schedule E, and Schedule B. The W-2 record intentionally duplicates current-employment wage evidence so the existing wage-reconciliation rule is exercised.

These records are not claimed to have been derived from the repository's existing PDF fixtures. During review, the in-memory synthetic connector W-2 was found to contain a different employer and annual wage than this fixture, and the existing Schedule C PDF includes a depreciation value omitted from this fixture. Linking their hashes would create false parser provenance, so all such links were removed. A coherent document fixture set and actual parse run remain required remediation.

Expected values were stated as simple annualization/division arithmetic in the fixture before comparison with the production calculator:

| Borrower/source | Independent calculation | Expected monthly income |
|---|---:|---:|
| Primary paystub base | `30,000 / 7.5 × 12 / 12` | 4,000.00 |
| Primary paystub variable | `12,000 / 7.5 × 12 / 12` | 1,600.00 |
| Matching W-2 | 96,000 annual, excluded as duplicate | 0.00 additional |
| Co-borrower Schedule C | `96,000 / 12` | 8,000.00 |
| Co-borrower Form 1065 | `60,000 / 12` | 5,000.00 |
| Co-borrower Schedule E | `24,000 / 12` | 2,000.00 |
| Co-borrower elected Schedule B | `12,000 / 12` | 1,000.00 |
| **Total** | `67,200 / 12 + 192,000 / 12` | **21,600.00** |

Expected borrower totals are 5,600.00 and 16,000.00 monthly. The expected trend is `SINGLE_YEAR`, and the only year analyzed is 2025.

Each normalized-loan artifact contains a deterministic SHA-256 of its synthetic post-parse record, named `syntheticBoundaryHash`; it is not a document content hash. The evidence generator rejects common PDF/base64-PDF and credential/identity markers before writing files.

## 4. Test execution report

### 4.1 Commands and results

| Command | Result |
|---|---|
| `corepack pnpm --filter web exec tsx --test src/server/integrations/encompass/encompassCertification.test.ts` | PASS — 5/5 |
| `corepack pnpm --filter web exec tsc --noEmit` | PASS |
| `corepack pnpm --filter web test` | PASS — 8 script tests and 174 TypeScript tests |
| `corepack pnpm --filter @mortgage-pos/mortgage-engine test` | PASS — 23 suites, 190 tests |
| `corepack pnpm --filter @mortgage-pos/encompass-connector-contract test` | PASS — 30/30 |
| `corepack pnpm --filter @mortgage-pos/encompass-connector test` | PASS — 42/42; tests named “real connector” use injected fake HTTP |
| `corepack pnpm --filter underwriting-console test:runtime` | PASS — 29/29, including production-server check |
| `corepack pnpm --filter web exec tsx scripts/encompass-certification.ts` | PASS — ten metadata-only evidence files generated |
| Generated evidence manifest verification | PASS — all nine listed payload hashes and byte sizes matched their files |

Dependency installation and Prisma client generation completed before these tests. Neither changed the lockfile or database schema.

### 4.2 Tests not executed

| Test | Status | Reason |
|---|---|---|
| Python parser suite, including zero-retention tests | BLOCKED | Neither `python` nor `py` is installed in this environment. Existing Python tests were inspected but are not reported as executed. |
| Synthetic supporting-document fixture creation | NOT IMPLEMENTED | No semantically coherent PDF set exists for the post-parse fixture used here. |
| Document-to-parser fixture execution | BLOCKED | The supporting-document prerequisite is absent and the Python parser runtime is unavailable. |
| PostgreSQL/RLS integration suites | BLOCKED | Neither `TEST_DATABASE_URL` nor `DATABASE_URL` is configured. No database was contacted. |
| Real Encompass list/download/write/read | BLOCKED | No customer-authorized Encompass test tenant or lender-approved credentials were supplied. |
| Official MISMO XSD/implementation-guide validation | BLOCKED | No single licensed/official schema package and implementation guide is selected in the repository, and no approved-income XML exporter exists. |

### 4.3 Edge and failure coverage

| Scenario | Status | Evidence/limitation |
|---|---|---|
| Duplicate paystub/W-2 wages | PASS | New fixture produced `PAYSTUB_W2_RECONCILED` and did not double-count income. |
| Same connector attachment/hash replay | PASS — COMPONENT | Existing persistence tests prove no duplicate extraction/version. |
| Same standalone PDF uploaded twice | NOT IMPLEMENTED | Random upload IDs prevent content-hash identity from suppressing a second document. |
| Conflicting arbitrary document values | NOT IMPLEMENTED comprehensively | The wage duplicate rule is covered; no general conflict policy/certification suite exists for all document classes. |
| Missing borrower assignment | PASS | New test confirms calculation fails closed with `ExtractionMetadataRequiredError`. |
| Missing financial/document values | PASS — COMPONENT | Executed portal tests cover incomplete paystub required-field gaps (`paystubProtectedRules.test.ts:130-134`) and fail-closed missing Form 1065 K-1 income (`authoritativeExtractionInput.test.ts:209-223`). No live parser case was run. |
| Missing/invalid connector authentication | PASS — COMPONENT | HMAC authentication/replay and boot-guard tests pass. Real ICE authentication remains BLOCKED. |
| API/service cross-tenant access | PASS — COMPONENT | Executed route and connector-binding suites cover tenant mismatch and authorization failures. |
| PostgreSQL/RLS cross-tenant enforcement | BLOCKED | SQL policies/tests exist, but no database URL was available for execution. |
| Retryable/terminal connector errors | PASS — COMPONENT | Worker tests cover bounded retry, terminal 4xx, retryable 5xx, and unknown-outcome reconciliation. |
| Hosted write errors | PASS — MOCK | Read-only, changed-loan, malformed-map, and commit-failure cases pass against the deterministic host. |
| Direct write full-field readback | NOT IMPLEMENTED | Runtime reconciliation reads only the approval marker. |
| JavaScript worker document retention | PASS — COMPONENT | Executed tests cover serial in-memory processing and buffer clearing. |
| Provider/document error-log minimization | FAIL | `documentPullFailure.ts:104-116,159-178` logs `detail.message` after pattern-based redaction; the executed suite demonstrated arbitrary provider text surviving that filter. |
| Python parser and live ZDR canary | BLOCKED | Python was unavailable and no authenticated live environment was in scope. Generated evidence contains no document bytes. |

## 5. Export and writeback findings

### 5.1 JSON

The certification harness generates a deterministic `freeflow-certification-result-v1` JSON result. The integrated and standalone projections yield byte-identical result JSON because source-specific identifiers are kept in separate normalized-loan artifacts.

The production calculation endpoint returns JSON, but there is no approved, downloadable, versioned normalized-loan/result artifact for customers. Harness PASS must not be used to describe the operational product export as complete.

### 5.2 MISMO

Three disconnected implementations were found:

- URLA intake export uses `MISMOReferenceModelIdentifier="3.4.0"` (`apps/underwriting-console/src/intake/mismoExport.ts:107-146`).
- Paystub-specific XML uses `MISMOReferenceModelIdentifier="3.4.032420160128"` (`packages/mortgage-engine/src/paystubMismoMapper.ts:367-418`).
- An isolated Python prototype uses `MISMOVersionID="3.4.0"` (`services/doc-parser/src/mismo_xml_exporter.py:8-108`).

None is wired to the protected approved-income workflow, and repository tests assert selected strings rather than validating against an official XSD plus chosen implementation requirements. No MISMO XML was fabricated for this assessment. `mismo-validation.json` records `NOT_IMPLEMENTED`, `BLOCKED`, and `xmlArtifactProduced: false`.

MISMO publishes Version 3.4 and its XML schema as release assets, and implementation guides are separate artifacts. Before certification, the product must explicitly select the exact release/schema and applicable implementation guide: [MISMO XML schema](https://www.mismo.org/standards-resources/residential-specifications/reference-model/xml-schema), [MISMO Version 3.4](https://www.mismo.org/standards-resources/mismo-product/mismo-version-3-4), and [MISMO implementation guides](https://www.mismo.org/standards-resources/residential-specifications/implementation-guides).

### 5.3 Human-readable summary

The harness generates deterministic text for comparison only. The protected production route deliberately raises `503 SUMMARY_DATA_UNAVAILABLE` (`apps/underwriter-portal/src/pages/api/underwrite/summary-pdf.ts:64-80`), and its route test confirms that outcome. The console summary middleware uses demo fallback data, so it cannot be certified as an approved customer artifact.

### 5.4 Exact current approved-mapper output and completeness gap

`encompass-intended-fields.json` was generated by the actual approved mapper, not a duplicate test map. It contains:

- `CX.FREEFLOW.INCOME = 21600.00`
- `CX.FREEFLOW.TRENDING = SINGLE_YEAR`
- `CX.FREEFLOW.YEARS = 2025`
- `CX.FREEFLOW.W2.BASE = 4000.00`
- `CX.FREEFLOW.SCH.C = 8000.00`
- `CX.FREEFLOW.FORM.1065 = 5000.00`
- `CX.FREEFLOW.RENTAL = 2000.00`
- borrower 1 and 2 totals of `5600.00` and `16000.00`
- synthetic audit URL and approval ID

The exact-current-mapper assertion passes, but contract completeness fails. The approved result contains 1,600.00 monthly W-2 variable income and 1,000.00 monthly asset income, while the mapper emits neither `CX.FREEFLOW.W2.VARIABLE` nor `CX.FREEFLOW.ASSET.INCOME`. Both fields are defined in `packages/mortgage-engine/src/encompass-custom-fields.ts:63-68,105-110`, and a disconnected URLA mapper knows them, but `map-encompass-fields-v2.ts:65-78` omits them. `processing-validation-report.json` therefore records current mapper output PASS and approved-field contract completeness FAIL.

The field-projection artifact preserves an unrelated customer field and proves current-mapper object equality only in memory. Production direct and hosted reconciliation checks only the approval marker, so this is not a real or complete field readback.

## 6. Prior round-trip evidence and interface risk

### 6.1 What previously passed

| Evidence | Precise conclusion |
|---|---|
| `WEEKEND-BURN-2-EVIDENCE-2026-09-26.md:60-76,92-102` | A synthetic AWS connector-to-parser slice passed. The document explicitly says the authenticated persistence/calculation/approval/sync sequence was not proved and no live Encompass result was claimed. |
| `ENCOMPASS-HOSTED-CUSTOMER-TEST-PACKAGE.md:1-4` | Provides customer test instructions and explicitly disclaims live-Encompass qualification. |
| `apps/underwriting-console/e2e-protected/protected-workflow.spec.ts:417-420` | Protected browser workflow uses intercepted APIs; it is not a live parser or Encompass test. |
| `services/encompass-connector/tests/encompass-api-client.test.ts:10-33` | Provider URL, request, validation, and retry behavior pass against injected fake responses. |
| `real-connector-parser-smoke.test.ts:16-33` | Uses a fake fetch but emits `REAL_CONNECTOR_PARSER_SMOKE=passed`; the marker is misleading and is not accepted as real evidence. |
| `runtimeHost.test.ts:6-28` | A fake `elli.script` object validates bridge selection, not a live hosted client. |
| `run-all-encompass-mocks.sh:4-61` | Obsolete mock runner references absent targets and makes unsupported broad claims; it is excluded from certification evidence. |

No execution log or artifact in the repository proves a complete real-tenant list → download → parse → calculate → approve → write → read-back round trip.

### 6.2 Official ICE interface observations

- The OAuth request shape matches ICE's documented token flow. ICE documentation says the client-credentials grant is for authorized ISV partners, while lender contexts may require a different grant. Credential eligibility must be confirmed contractually for each deployment: [ICE authentication](https://developer.icemortgagetechnology.com/developer-connect/docs/authentication).
- V3 attachment listing/download aligns with ICE's current V3 eFolder direction. ICE's deprecation notice says V1 eFolder attachment APIs sunset in release 26.3; this code already uses V3 for attachments: [attachment download URL](https://developer.icemortgagetechnology.com/developer-connect/reference/get-download-attachment-url), [eFolder guidance](https://developer.icemortgagetechnology.com/developer-connect/docs/document-tips-and-tricks), and [deprecation notices](https://developer.icemortgagetechnology.com/developer-connect/docs/deprecation-notices).
- Write/read still use documented V1 loan endpoints. ICE recommends V3 where available and describes gradual V1 deprecation; this is migration risk, not proof that the current calls are unsupported: [V1 update loan](https://developer.icemortgagetechnology.com/developer-connect/reference/update-loan), [V3 update loan](https://developer.icemortgagetechnology.com/developer-connect/reference/update-loan-1), [V3 field writer](https://developer.icemortgagetechnology.com/developer-connect/reference/v3-field-writer), and [V1 versus V3](https://developer.icemortgagetechnology.com/developer-connect/docs/v1-vs-v3-encompass-apis-whats-the-difference-1).
- No desktop SDK, COM plugin, or SmartClient host is implemented. The hosted JavaScript bridge should not be described as a desktop SDK integration. ICE provides separate SDK-to-API migration guidance: [SDK migration guide](https://developer.icemortgagetechnology.com/developer-connect/docs/sdk-to-api-migration-getting-started-guide).

### 6.3 Product/licensing inconsistency

Git history shows that commit `12f338f` deliberately removed the licensed Encompass API integration. Commit `56ed626` later restored the Developer Connect implementation during repository unification, merged by `34a8d9b`. Current `GO-LIVE-MAP.md:198-200` still says the licensed third-party API adapter is not part of the product.

This is a release blocker requiring an explicit product/legal/architecture decision. The production connector was not silently removed, enabled, or redesigned during certification.

### 6.4 Undocumented or unverified assumptions

- Every target lender instance has provisioned the exact `CX.FREEFLOW.*` custom fields with compatible types.
- The configured credentials are legally and technically eligible for the client-credentials grant.
- The active GUID belongs to the lender/tenant binding expected by the customer workflow; FreeFlow checks its own binding, but real provider behavior remains unverified.
- V1 custom-field PATCH and read semantics produce the expected values/types in the target instance.
- Reading only the approval marker is sufficient reconciliation after an unknown write outcome.
- An in-memory replay store is sufficient; it is not sufficient for multiple production tasks without a shared atomic nonce store.

## 7. Evidence artifact inventory

Directory: `docs/deployment-readiness/evidence/encompass-certification-2026-10-11/`

| Artifact | Purpose |
|---|---|
| `artifact-manifest.json` | SHA-256 and byte size for nine payload artifacts (the manifest does not hash itself), plus source-input fingerprints |
| `synthetic-fixture-manifest.json` | Synthetic post-parse source descriptors, normalized inputs, and independent expected values; no document bytes/hashes |
| `integrated-post-parse-projection-normalized-loan.json` | Integrated-provenance projection into the common post-parse calculation input |
| `standalone-post-parse-projection-normalized-loan.json` | Standalone-provenance projection into the same post-parse calculation input |
| `normalized-income-result.json` | Source-neutral deterministic JSON result |
| `underwriting-summary.txt` | Human-readable harness summary, explicitly not a customer-approved export |
| `encompass-intended-fields.json` | Exact output of the production approved-field mapper |
| `encompass-in-memory-field-projection.json` | Mapper/object-projection comparison and unrelated-field preservation; not writeback/readback |
| `mismo-validation.json` | Honest NOT IMPLEMENTED/BLOCKED result; confirms no XML was produced |
| `processing-validation-report.json` | Machine-readable status summary and simulator warnings |

The manifest records base revision `6d7261a`, identifies the execution source as the current working tree, and fingerprints the generator, harness, test, and fixture source files. Regeneration is deterministic for matching source fingerprints and fixture. `containsRawDocumentBytes: false` is a generator assertion backed by forbidden-marker checks and review, not a general proof that arbitrary future content is non-sensitive.

## 8. Reproduction commands

From the repository root with Node 24 and Corepack:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --dir packages/database prisma:generate

corepack pnpm --filter web exec tsx --test src/server/integrations/encompass/encompassCertification.test.ts
corepack pnpm --filter web exec tsc --noEmit
corepack pnpm --filter web test
corepack pnpm --filter "@mortgage-pos/mortgage-engine" test
corepack pnpm --filter "@mortgage-pos/encompass-connector-contract" test
corepack pnpm --filter "@mortgage-pos/encompass-connector" test
corepack pnpm --filter underwriting-console test:runtime

corepack pnpm --filter web certify:encompass
```

To write evidence outside the repository:

```powershell
corepack pnpm --filter web exec tsx scripts/encompass-certification.ts C:\path\to\evidence
```

Do not add ICE credentials to the fixture, command line, evidence directory, or logs. A real interoperability run requires a separately approved customer-test procedure and authorized tenant.

## 9. Ordered remediation plan

1. **Resolve connector product/licensing policy.** Decide whether the restored Developer Connect implementation is an allowed optional adapter. Align code, feature flags, deployment config, contracts, and `GO-LIVE-MAP.md` before any live attempt.
2. **Define the versioned internal loan contract.** Add a schema-discriminated, source-neutral loan/application input model and adapters for Encompass and standalone import. Keep the calculation engine LOS-independent.
3. **Complete standalone intake.** Add tenant-scoped manual loan creation and at least one explicitly supported loan-file import, with synthetic tests and no LOS dependency.
4. **Build one approved-result export service.** From the same immutable approved calculation, generate downloadable normalized JSON, human-readable summary, and MISMO for both workflows. Do not use demo fallback data.
5. **Select and validate MISMO deliberately.** Record the exact official schema release and applicable implementation requirements, add valid/invalid golden fixtures, wire XSD plus semantic validation, and version the exporter.
6. **Fix standalone content idempotency.** Make document identity tenant/loan/content aware so identical re-uploads do not create unintended duplicate documents, while preserving provenance for legitimate revisions.
7. **Finalize the Encompass field contract.** Add or explicitly reject W-2 variable and asset/Schedule B mappings, use one allowlisted mapping source, provision/test types, and reconcile every intended field after write instead of only the approval marker.
8. **Make replay protection distributed.** Replace the connector's process-local nonce store with a shared atomic TTL store before multi-task production operation.
9. **Make operational logging allowlist-only.** Do not log arbitrary provider exception messages. Emit stable safe codes, bounded error types, correlation IDs, and approved retry metadata; add a test that captures logs and rejects synthetic sensitive text.
10. **Add complete dual-path acceptance tests.** Execute equivalent synthetic loans from the actual Encompass-boundary mock and actual standalone create/import boundary through upload/pull, review, calculation, approval, all three exports, retries, duplicates, and failures.
11. **Run real customer-authorized certification.** In a dedicated non-production lender tenant, first perform read-only authentication/list/download validation, then an explicitly approved synthetic loan write and full-field readback. Capture sanitized request IDs, timestamps, revisions, and hashes—never tokens or borrower data.
12. **Run environment-dependent security gates.** Execute PostgreSQL/RLS suites, the Python ZDR/parser suite, and a full authenticated RAM-only canary before production approval.

Until items 1-10 are complete, FreeFlow should be demonstrated as a simulator/component-tested income platform, not as certified Encompass interoperability or a complete standalone production workflow.
