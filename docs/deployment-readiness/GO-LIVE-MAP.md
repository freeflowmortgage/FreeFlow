# FreeFlow go-live integration map

Status: **not approved for production**. This is the instruction set for every
external and internal surface that must be live, fail-closed, or explicitly
out of scope before real borrower data.

Use with:

- [DEPLOYMENT-BURNDOWN.md](DEPLOYMENT-BURNDOWN.md) — P0/P1/P2 tracker
- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — engineering order
- [RUNBOOKS.md](RUNBOOKS.md) — deploy/rollback/incident
- [AWS-LIVE-TEST-RUNBOOK.md](AWS-LIVE-TEST-RUNBOOK.md) — synthetic AWS burn
- [BACKEND-API-SPEC.md](BACKEND-API-SPEC.md) — API and Encompass state machine
- [SECURITY-SPEC.md](SECURITY-SPEC.md) — auth, ZDR, provider rules

Legend: **LIVE** (code + tests, may still need a digest burn) · **PARTIAL**
(library or infra only) · **STUB** (route exists, returns fail-closed) ·
**MISSING** (no production path).

Do not put lender LOS credentials or console fixture routes into the core
application.

---

## 1. What “go live” means

FreeFlow is B2B only. Encompass remains the source of documents. FreeFlow:

1. Pulls or receives a PDF **in memory**.
2. Runs RapidOCR / native extract **in the private parser**.
3. Calculates Form 1084 **server-side**.
4. Records an **immutable approval**.
5. Syncs **only that approval** to Encompass (web API and/or MISMO file).
6. Persists **no** raw PDF, OCR dump, or raw XML.

The underwriting console (`apps/underwriting-console`) is a QA lab. It must not
see production RDS, production Encompass, or real borrower files.

---

## 2. Inventory (every integration)

| Surface | Status | Code | P0 | Go-live action |
|---|---|---|---|---|
| RapidOCR income parser | LIVE (dev digest qualified) | `services/doc-parser` | P0-13 | Current dev digest is scan-clean and private; worst-case scanned-corpus/SLO evidence remains |
| Portal → parser proxy | PARTIAL | `apps/underwriter-portal/.../process.ts` | P0-07 | Timeouts; no OCR-word dump |
| Form 1084 calculation | PARTIAL | `packages/mortgage-engine` + persisted `income_extractions` + `income-approvals` | P0-05 | W-2/Schedule E parser output is source-bound and server-calculated; immutable parser records lacking authoritative tax year fail closed pending a separate authoritative year source |
| MISMO 3.4 cash-flow XML | PARTIAL | `services/doc-parser/src/mismo_xml_exporter.py` | P0-08 | Attach after approval only |
| MISMO 3.4 URLA (1003) intake | PARTIAL | `apps/underwriting-console/src/intake/mismoExport.ts` | — | QA only; no prod persist |
| MISMO D1C vendor blocks | PARTIAL | `packages/mortgage-engine/src/mismoD1cMapper.ts` | P0-08 | No vendor APIs yet |
| ULAD | MISSING | — | — | Out of scope unless LOS requires it |
| Encompass **hosted bridge** | PARTIAL | hosted launch/write APIs + browser bridge | P0-08 | Qualify direct read/write in a customer test tenant |
| Encompass **custom connector** | PARTIAL | v1 sync/document APIs + workers + signed connector contract | P0-08 | Qualify the separately deployed direct connector against a customer test tenant |
| Encompass **eFolder pull** | PARTIAL | v1 document-pull API + worker + custom connector | P0-08 | Selected-attachment, bounded, ZDR path exists; qualify direct test-tenant retrieval |
| Encompass field PATCH map | PARTIAL | `map-encompass-fields-v2.ts` | P0-08 | Custom fields must exist in instance |
| Encompass **desktop** (SmartClient / COM / plugin) | MISSING | none | — | iframe CSP only; see §6 |
| SQS sync + DLQ | LIVE (dev qualified) | `infrastructure/terraform/.../messaging.tf` | P0-08 | Encrypted queue/DLQ redrive passed; keep real provider writes disabled until sandbox binding is supplied |
| Sync worker ECS task | LIVE (synthetic provider) | `syncWorkerRuntime.ts` + Terraform task/service | P0-08, P0-15 | Dev worker is healthy; enable live writes only with an authoritative custom connector binding |
| Appraisal / URAR 1004 | PARTIAL | `services/appraisal-parser` | P0-11 | Native/AcroForm only; no RapidOCR |
| Stripe billing | STUB in protected runtime | `billing/webhook.ts` | P0-09 | Authoritative reconcile |
| Cognito + ALB OIDC | PARTIAL | TF + `albOidc.ts` | P0-01, P0-15 | Live negative edge checks and MFA pass; positive reviewer and full object matrix remain |
| RDS + RLS | LIVE (dev qualified) | `packages/database` | P0-03 done; P0-04/17 open | All 10 migrations are deployed; restricted roles, FORCE RLS, app/worker isolation, snapshot, and isolated restore pass; production HA/retention approval remains |
| Shared links | MISSING | — | P0-10 | — |
| Credit / AUS (DU, LP, GUS) | MISSING | — | — | Out of scope for this launch |
| Plaid / Truework / Argyle / Work Number APIs | MISSING | D1C **names only** | — | Do not claim D1C live |
| Console RapidOCR lab | LIVE (QA) | `parseMiddleware.ts` | — | Separate account only |

---

## 3. RapidOCR (income parser)

### What it is

In-process ONNX RapidOCR (`rapidocr-onnxruntime`) inside `AIPDFConverter`. No
Textract, no disk sandwich PDF. Inspect first (AcroForm `/V` + native text),
classify, then OCR only keep-set pages that still need it. All-scan packets
with no labels OCR every page that `use_ocr`. Empty native AcroForms and exact
official K-1 code/reference pages bypass OCR; the Schedule E grid pass runs only
after Schedule E classification. Safe phase timings are emitted for capacity
analysis without logging document content or names.

### Limits (must stay in runbooks)

| Cap | Value | File |
|---|---|---|
| Bytes | 40 MiB | `ai_pdf_converter.py`, portal `process.ts` |
| Pages | **150** | `MAX_PAGES` |
| Render | 300 DPI | `RENDER_DPI` |
| Console client timeout | 90s | `DOC_PARSER_TIMEOUT_MS` |
| Dev Fargate | 1 vCPU / 4 GiB, count 1 | `compute.tf` |
| Spec starting size | 2 vCPU / 8 GiB | `AWS-ECS-DEPLOYMENT-SPEC.md` |

A 300-page all-scan is **rejected** at 150 pages. Do not raise the cap on the
synchronous request path. See compute notes at the end of this document.

### Go-live instructions

1. Build `services/doc-parser` from the reviewed git SHA. Pin
   `@sha256:` in `parser_image`. Never `latest`.
2. ECR enhanced scan clean (P0-12). Non-root `8888`, read-only root, cap-drop
   ALL, `/tmp/freeflow` volume (Fargate has **no tmpfs**).
3. Health: `GET /health` must remain responsive during OCR. Today RapidOCR is
   **synchronous on the uvicorn worker**. A long scan can fail ECS health and
   kill the task. Split OCR off the health worker or run a dedicated worker
   **before** inviting scanned packets.
4. Portal `fetch` to the parser currently has **no timeout**. Set connect /
   first-byte / total timeouts; on expiry return 504 and cancel work.
5. Production JSON must **not** include a full OCR word dump
   (`BACKEND-API-SPEC.md` parser contract). Ship allowlisted fields + boxes.
6. Smoke corpus (synthetic only): digital 1040, fillable W-2 `/V`, Schedule E
   Page 1 A/B/C, Form 8825 Line 14 totals (preferred over 4562), 40 MiB reject,
   empty PDF, non-PDF, 151-page reject.
7. ZDR canary: after parse, search RDS, SQS, logs, traces for PDF/OCR markers
   ([DATA-DISPOSITION-PLAN.md](DATA-DISPOSITION-PLAN.md)).
8. Console timeout 90s is a **lab** default. Production portal timeout must
   match ALB idle timeout and parser budget.

### Env

- `DOC_PARSER_URL` — portal path (`.../api/underwrite/process` or `/parse`)
- `DOC_PARSER_SERVICE_URL` — `/parse`
- `PARSER_ENABLED` — `false` fails closed
- `TMPDIR=/tmp/freeflow`
- Console only: `DOC_PARSER_TIMEOUT_MS`

### Do not

- Persist PDFs to S3/MinIO “to make OCR async.”
- Fall back to pdf.js native extract when Python OCR times out (weaker path,
  no Schedule E grid, no AcroForm).
- Run RapidOCR in the portal Node process.

---

## 4. MISMO

Three generators exist. None are on the production Encompass write path.

### 4.1 Cash-flow / 1084 entities — MISMO 3.4.0

- Code: `services/doc-parser/src/mismo_xml_exporter.py`
- `MISMOVersionID="3.4.0"`, namespace `http://www.mismo.org/residential/2009/schemas`
- Emits borrower name, loan identifier, `QualifyingMonthlyIncomeAmount`,
  `CASH_FLOW_ADJUSTMENT` (Schedule C / E / 8825-style entities).
- Test: `services/doc-parser/tests/test_doc_parser.py::test_mismo_xml_generation`
- **Not called** from `server.py` `/parse`.

**Go live:** after an immutable approval, the **sync worker** (not the browser)
builds XML in memory and either (a) attaches it as an Encompass eFolder
document of an approved type, or (b) keeps XML only as a manual lender
download that is not stored. Never log the XML.

### 4.2 URLA / 1003 intake XML

- Code: `apps/underwriting-console/src/intake/mismoExport.ts` (`buildMismo34Xml`)
- Delivery stub: `intakeDeliverMiddleware.ts` — validates in memory, **does not
  call Encompass**, returns a receipt.
- Tests: `packages/mortgage-engine/tests/urla-employment-roster.test.ts`

**Go live:** this stays a **client-delivery relay** (ZDR). If product needs
URLA into Encompass, the worker uses the tenant-bound custom connector — not
this Vite middleware. LOS credentials never enter the FreeFlow core runtime.

### 4.3 Day 1 Certainty (D1C) snippets

- Code: `packages/mortgage-engine/src/mismoD1cMapper.ts`
- Vendors named only: `PLAID`, `TRUEWORK`, `ARGYLE`, `THE_WORK_NUMBER`
- Tests: `packages/mortgage-engine/tests/mismo-d1c-mapping.test.ts`
- **No** Plaid/Truework/Argyle/Equifax API clients.

**Go live:** do not market D1C until a real verification report ID is obtained
through a contracted vendor API and the snippet is nested in a validated
MISMO message. Vendor names in XML are not an integration.

### 4.4 ULAD

**MISSING.** Product language is URLA / FNMA 1003. If a lender requires ULAD,
that is a new mapper and a new certification — not a rename of 3.4 cash-flow
XML.

### MISMO go-live checklist

- [ ] Schema-validate generated 3.4 against the official MISMO 2009 XSD (not
  string asserts only).
- [ ] Map entity types (`SCHEDULE_C`, `SCHEDULE_E_PART_1`, `FORM_8825`, K-1)
  to the lender’s expected cash-flow nodes.
- [ ] Dual-path decision: REST custom fields **and/or** MISMO attachment.
  Default: REST PATCH for 1084 numbers; MISMO file only if the lender’s
  secondary/AUS ingest requires it.
- [ ] Redact EIN/name in logs; XML lives only in worker memory.
- [ ] Golden test: one approved 1084 → XML → Encompass sandbox eFolder →
  human open in Encompass web.

---

## 5. Direct Encompass integration

FreeFlow supports two direct paths: an Encompass-hosted browser bridge and a
separately deployed custom connector. The licensed third-party API adapter is
not part of this product.

### Current code

| Piece | Behavior |
|---|---|
| `POST /api/underwrite/encompass-sync` | **503** `APPROVED_SYNC_WORKER_REQUIRED` |
| `POST /api/underwrite/pull-docs` | **503** `APPROVED_DOCUMENT_WORKER_REQUIRED` |
| `POST /api/v1/loans/{loanId}/encompass-syncs` | Creates one tenant-scoped durable job for one immutable current approval |
| `GET /api/v1/encompass-syncs/{jobId}` | Returns tenant-scoped safe job status |
| `POST /api/v1/loans/{loanId}/encompass-document-pulls` | Queues explicit selected attachment IDs through the bound connector |
| `buildEncompassFieldUpdatePayload` | Maps 1084 → `CX.FREEFLOW.*` + 1003 other-income |
| SQS + DLQ | Identifier-only dispatch, bounded exponential retry, five-delivery DLQ |
| Encompass-hosted bridge | Uses the active host loan and allowlisted custom fields |

### Implemented custom-connector flow (test-tenant qualification still required)

```
APPROVED → QUEUED → IN_PROGRESS → SUCCEEDED | RETRYABLE_FAILURE | FAILED
```

Queue payload only:

`{ tenantId, loanId, approvalEventId, expectedLoanVersion, idempotencyKey, correlationId }`

No PDF, no XML, no borrower names.

Worker:

1. Revalidate the tenant-scoped durable job and server-side connector binding.
2. Load immutable approval; abort if version stale.
3. Map with `map-encompass-fields-v2.ts` (and MISMO attach if enabled).
4. Call the lender-bound connector over authenticated, replay-protected
   service-to-service transport. FreeFlow core never receives LOS credentials.
5. The separately deployed connector performs the direct Encompass operation.
6. Conditional state update; duplicate SQS delivery is a no-op.
7. Reconcile unknown outcomes; DLQ gets safe codes only.

Implemented API:

- `POST /api/v1/loans/{loanId}/encompass-syncs` → 202 + job id
- `GET /api/v1/encompass-syncs/{jobId}`

### Encompass admin (lender instance)

Before enabling `enableEncompassSync`:

1. Install and authorize the FreeFlow hosted custom tool and/or the lender's
   separately deployed direct connector.
2. Register the exact FreeFlow hosted origin and enforce the lender's normal
   Encompass user permissions.
3. Create custom fields (must match the mapper):

   | Encompass field | Purpose |
   |---|---|
   | `CX.FREEFLOW.INCOME` | Qualifying monthly income |
   | `CX.FREEFLOW.TRENDING` | Trend flag |
   | `CX.FREEFLOW.AUDIT.URL` | In-app audit (no PII in query) |
   | `CX.FREEFLOW.YEARS` | Years analyzed |
   | `CX.FREEFLOW.SCH.C` | Schedule C monthly |
   | `CX.FREEFLOW.FORM.1120S` | 1120-S monthly |
   | `CX.FREEFLOW.FORM.1065` | 1065 monthly |
   | `CX.FREEFLOW.FORM.1120` | 1120 monthly |
   | `CX.FREEFLOW.SYNCED.AT` | Sync timestamp |

4. Standard 1003 slots used: field IDs `101` / `102` / `103` (base / other
   type / other amount). Confirm they are not overwritten unsafely vs existing
   LO entry.
5. eFolder: document type for “FreeFlow 1084 evidence” (PDF summary only,
   generated from **approved** calc). Optional MISMO `*.xml` type.
6. Grant the connector identity loan read/write **only** on folders the lender owns.
7. Test loan: sync once, inspect desktop **and** web UI, confirm no second
   write on replay.

### eFolder pull (documents in)

Worker, not the browser:

1. List attachments for the authorized loan.
2. Stream one PDF at a time into the parser (40 MiB / 150 pages).
3. Discard bytes after JSON evidence returns.
4. Never put raw PDFs on SQS.

### Env (production example)

- `ENCOMPASS_CONNECTOR_SERVICE_URL`
- `ENCOMPASS_CONNECTOR_SIGNING_KEY` (secret ARN)
- `SYNC_QUEUE_URL`, `SYNC_DLQ_URL`
- Tenant flag `enableEncompassSync` — must actually gate the worker

### Tests before prod traffic

- Replay same `idempotencyKey` → one PATCH.
- Stale `expectedLoanVersion` → no write.
- Tampered tenant on job → 403, no Encompass call.
- Provider 5xx → retryable; 4xx validation → FAILED.
- Outage drill: [RUNBOOKS.md](RUNBOOKS.md) Encompass outage section.

---

## 6. Encompass desktop (SmartClient / thick client)

**There is no Encompass desktop SDK, COM plugin, or .NET host in this
repository.** Archived checklists that mention iframe embedding are not an
integration.

### What desktop go-live would require (if a lender demands it)

FreeFlow’s supported model is the hosted bridge plus the direct custom
connector. Desktop is a **hosting shell**, not a second source of truth.

If product later embeds the portal in Encompass desktop:

1. CSP `frame-ancestors` allowlist only: `'self'` plus the exact lender-hosted
   Encompass origins confirmed during tenant onboarding.
2. ALB OIDC still authenticates the **human**. Do not trust Encompass desktop
   headers as tenant identity.
3. No COM/SmartClient field writes from the browser. All writes still go
   through the sync worker.
4. Loan GUID must come from a signed server session after the user opens the
   loan in Encompass, not from `postMessage` without origin checks.
5. Certify on the SmartClient / web hybrid version the lender
   actually runs (version pin in the runbook).
6. If a true desktop plugin is required, that is a **new signed .NET
   project**, signed, versioned, and out of this Node/Python monorepo.

Until that project exists, Encompass desktop users open the same hosted tool;
service-side work uses the custom connector only.

---

## 7. Appraisal (URAR 1004)

- Service: `services/appraisal-parser` — **native text + AcroForm, no RapidOCR**.
- Limit: 15 MiB.
- **Not deployed** on the PLTE/dev parser slice (`APPRAISAL_PARSER_URL` is a
  disabled placeholder in Terraform).
- Console fixtures (`/fixtures/urar-1004.pdf`) must never enter the portal
  production image.

**Go live:** deploy a separate Fargate service, reject text fixtures in
protected runtime, add scan handling or typed `UNSUPPORTED_SCAN`, source-
derived coordinates (P0-11), portal `POST /api/v1/appraisals/audits`.

---

## 8. Identity, data, money, edge

| Surface | Go-live instruction |
|---|---|
| Cognito + ALB | Enable `enable_cognito_edge`; verify ALB JWT signer ARN; no `ALLOW_DEV_AUTH_BYPASS` in protected runtime; two-tenant matrix (P0-01/02). |
| Origin | Exact `TRUSTED_ORIGIN` on unsafe methods. |
| RDS | App role + FORCE RLS; complete tenant columns (P0-04); Multi-AZ/PITR drill (P0-17). `api_idempotency_keys` is in place for approval mutations. Add `sync_jobs` and `webhook_events` before Stripe/Encompass workers. |
| Stripe | Protected runtime currently **503**. Implement signature + authoritative amount/currency/tenant; ignore PI metadata prices (P0-09). |
| WAF / TLS | Public ALB only; parsers private; no parser public IP. |
| Images | Digest, SBOM, scan, sign, circuit-breaker rollback (P0-14/16). |
| Console | Separate non-prod account or omit. Banner + IP allowlist if kept. |

---

## 9. Ordered launch sequence

Do not skip. Later steps assume earlier exits.

| Step | Work | Exit |
|---|---|---|
| A | Merge parser/1084/8825 code; Python + Jest green | Reviewed PR |
| B | Digest-pin income-parser in **dev**; synthetic smoke | `parse_complete` logs; no PDF in stores |
| C | OCR worker isolation + timeouts + no word dump | Health stays 200 during a 40-page scan |
| D | Cognito live + tenant matrix on every portal route | P0-01/02 evidence |
| E | `sync_jobs` schema + SQS worker ECS task | Duplicate message harmless |
| F | Encompass customer test tenant + hosted bridge/custom connector fields | One direct write + optional MISMO attach |
| G | eFolder pull → parser → discard | ZDR canary |
| H | Stripe webhook reconcile in staging | P0-09 tests |
| I | Appraisal service or explicit “not in this launch” | Written product scope |
| J | Staging pen-test + runbook drills | P0-19/20 |
| K | Production digest promotion | All P0 DONE |

Encompass **desktop** is not a launch step unless a signed plugin project is
staffed. D1C vendors, credit, and AUS are **not** this launch.

---

## 10. Compute note (RapidOCR scans)

On the current engine (sequential RapidOCR, 300 DPI, 1 vCPU):

- 300-page all-scan: **rejected** (`MAX_PAGES=150`).
- If uncapped: ~10–40 minutes wall clock, ~0.2–0.7 vCPU-hours, **one task
  monopolized**, client timeout at 90s, health-check kill risk.
- Dollar cost is cents; **capacity cost is the blocker**.
- Digital labeled packets OCR keep-set pages only (tens of pages), which is
  the path inspect-first was built for.
- The 2026-09-14 blank official non-wage corpus completed 34 pages in 12.714
  seconds total (0.201-2.605 seconds per PDF), with zero OCR and zero values.
  This is not evidence for filled scans; scanned-document latency remains the
  governing capacity constraint.

Do not advertise 300-page scan ingest on the synchronous `/parse` API.

---

## 11. Explicitly out of scope until staffed

- Encompass desktop COM/SmartClient SDK
- ULAD
- Credit bureau pulls
- Desktop Underwriter / Loan Product Advisor / GUS APIs
- Plaid / Truework / Argyle / The Work Number HTTP APIs
- Production MinIO/S3 staging of borrower PDFs
- Storing lender LOS credentials in FreeFlow core
