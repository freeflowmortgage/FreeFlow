# Backend and API Specification

## Service boundaries

| Service | Exposure | Responsibility | Prohibited responsibility |
|---|---|---|---|
| `portal-api` | Public through ALB | OIDC session, authorization, workflow APIs, orchestration, approved summaries | OCR implementation, fixture/demo fallback, direct trust of caller identity |
| `income-parser` | Private only | Ephemeral PDF validation, OCR/extraction, coordinate evidence | Persistence, public access, business approval, Encompass writes |
| `appraisal-parser` | Private only | Ephemeral appraisal extraction and source evidence | Fixture parsing in production, final review decision |
| `sync-worker` | Private, queue-driven | Idempotent approved Encompass updates and result events | Raw document/XML queue payloads, accepting browser-generated calculations |
| `underwriting-console` | Private QA only | Synthetic fixture and parser evaluation | Production borrower workflows or public exposure |

Income and appraisal data MUST use separate modules, tables, permissions, events,
and API namespaces. Shared infrastructure utilities may be reused, but one domain
must not acquire write access to the other's records.

## Request context

Middleware creates an immutable request context:

```ts
type RequestContext = {
  requestId: string;
  subject: string;
  tenantId: string;
  membershipId: string;
  permissions: readonly Permission[];
  authTime: Date;
};
```

Only verified identity plus an active database membership can create this object.
Route handlers MUST receive it from middleware and MUST NOT reconstruct it from
headers or request data. Internal calls additionally require service identity,
timestamp, body digest, and replay protection.

In protected runtimes, the middleware also applies an exact-origin browser
control to every `POST`, `PUT`, `PATCH`, and `DELETE`: the request MUST supply a
single `Origin` header exactly equal to `TRUSTED_ORIGIN`. Missing, duplicate, or
cross-site origins fail closed with `ORIGIN_REQUIRED` or `ORIGIN_NOT_ALLOWED`.
This check runs before a route handler can read a request body. The middleware
also sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: no-referrer` for protected API responses.

## API conventions

- Base path: `/api/v1`. JSON uses `application/json`; upload endpoints accept
  only documented PDF media types.
- All IDs in paths MUST pass strict UUID/ULID validation before use.
- Every mutation requires `Idempotency-Key`; uniqueness is scoped to tenant and
  operation. Store request hash and response. Reuse with a different request is
  `409 IDEMPOTENCY_CONFLICT`.
- Writes use database transactions and explicit compare-and-set version/state
  checks. Concurrent stale writes return 409.
- Pagination is cursor-based with a maximum server-defined limit. Lists are
  always tenant-filtered.
- The maximum public upload is the lower of endpoint policy and parser policy.
  Aggregate pages, files, decompressed bytes, processing seconds, and concurrent
  jobs are also bounded.
- Return `Cache-Control: no-store` for borrower/workflow data and PDFs. Summary
  filenames derive from validated identifiers, never raw caller text.
- Browser mutations require an exact `Origin` equal to `TRUSTED_ORIGIN`; do not
  add an origin exception for an embedded UI without a separately reviewed
  anti-CSRF design.
- Demo fixtures and fallback data MUST be unavailable when
  `NODE_ENV=production`.

## Error envelope

```json
{
  "error": {
    "code": "LOAN_NOT_FOUND",
    "message": "The requested loan was not found.",
    "requestId": "01J..."
  }
}
```

Use 400 for validation, 401 for no/invalid identity, 403 for known but forbidden,
404 for tenant-qualified missing objects, 409 for workflow/idempotency conflicts,
413 for request limits, 422 for a valid request that cannot be processed, 429 for
quota, 503 for a required dependency outage, and 504 for a bounded upstream
timeout. Never expose stack traces, SQL, upstream bodies, filesystem paths, or
exception messages.

## Required production endpoints

| Method and path | Permission | Behavior |
|---|---|---|
| `POST /api/v1/income/extractions` | `income:process` | Stream/validate a PDF to the private parser; return allowlisted extraction and evidence; persist no raw document/OCR text |
| `POST /api/v1/loans/{loanId}/income-calculations` | `income:calculate` | Load tenant-scoped loan and validated extraction; run versioned deterministic rules server-side |
| `POST /api/v1/income/borrower-split` | `income:calculate` | Stateless per-borrower W-2 method and 1084 split for callers that hold their own loan file; no database reads or writes; see below |
| `POST /api/v1/loans/{loanId}/income-approvals` | `income:approve` | Append approval/override event with reason and optimistic version; never update history |
| `GET /api/v1/loans/{loanId}/income-summary` | `loan:read` | Return only real tenant-scoped state; 404/503 rather than fixture fallback |
| `GET /api/v1/loans/{loanId}/income-summary.pdf` | `loan:read` | Render from an approved/versioned calculation; `no-store`; audit export. Until that source exists, protected runtimes return `503 SUMMARY_DATA_UNAVAILABLE` rather than render synthetic fields |
| `POST /api/v1/loans/{loanId}/encompass-syncs` | `encompass:sync` | Enqueue approved audit ID and expected version; return 202 and job ID |
| `GET /api/v1/encompass-syncs/{jobId}` | `encompass:sync` | Return tenant-scoped job state and safe failure code |
| `POST /api/v1/appraisals/audits` | `appraisal:review` | Strict PDF extraction plus versioned rules; domain-isolated storage |
| `POST /api/v1/share-links` | `share:create` | Generate purpose-bound, expiring token; store only hash |
| `POST /api/v1/webhooks/stripe` | Provider signature | Verify signature over raw body, claim event once, reconcile authoritative amount/currency/tenant, then acknowledge |
| `GET /api/v1/webhooks/endpoint` | `webhooks:manage` | Return the tenant's outbound income webhook endpoint (URL, enabled flag, version, secret version); never the secret |
| `PUT /api/v1/webhooks/endpoint` | `webhooks:manage` + recent sign-in | Create or update the endpoint with `expectedVersion` and `Idempotency-Key`; first creation returns the signing secret once |
| `POST /api/v1/webhooks/endpoint/rotate-secret` | `webhooks:manage` + recent sign-in | Rotate the signing secret; returns the new secret once |
| `GET /api/v1/webhooks/deliveries` | `webhooks:manage` | Cursor-paged delivery outbox (50 per page): status, attempts, last response status, safe error code |
| `POST /api/v1/webhooks/deliveries/{deliveryId}/redeliver` | `webhooks:manage` + recent sign-in | Requeue a `SUCCEEDED` or `FAILED` delivery with `Idempotency-Key`; returns 202 |
| `GET /health/live` | Internal health check | Process liveness only, no sensitive detail |
| `GET /health/ready` | ALB/orchestrator | Schema compatibility and required dependencies; generic 200/503 only |

`map-encompass-fields` is a library function, not an HTTP endpoint. Queue
construction and worker startup are separate processes, not Pages API modules.

### Stateless borrower income split

`POST /api/v1/income/borrower-split` runs the same W-2 base and variable method
math and per-borrower split as the underwriting console's Wages tab
(`@mortgage-pos/mortgage-engine`, `w2-income-methods.ts`). It is for systems
that keep their own loan file, such as Mortgage-POS, and is not a
loan-scoped calculation of record: it reads no extraction, writes no audit row,
and does not log the body. Because it changes no state it does not take an
`Idempotency-Key`. It still runs behind the request context middleware, so
protected runtimes require the verified identity and exact `Origin`.

The body is `borrower-income-v1` (`BorrowerIncomeRequestSchema`), capped at
64 KB, and unknown keys are rejected:

```json
{
  "borrowers": [{ "id": "b1" }, { "id": "b2" }],
  "priorEmployer": { "box5Wages": 78500, "box12Bonus": 18000, "box14Overtime": 6000 },
  "w2Employers": [
    { "id": "w2-apex", "borrowerId": "b1", "payFrequency": "SEMIMONTHLY", "hourlyRate": 45,
      "weeklyHours": 40, "currentPeriodBasePay": 3600, "baseYtd": 54000,
      "bonusYtd": 12500, "overtimeYtd": 4200, "monthsAtJob": 8 },
    { "id": "w2-meridian", "borrowerId": "b2", "payFrequency": "BIWEEKLY", "wageDocSource": "WVOE",
      "hourlyRate": 22, "weeklyHours": 12, "currentPeriodBasePay": 528, "baseYtd": 7920,
      "wvoeMonths": 24, "monthsAtJob": 29, "w2Year1Box5": 11440 }
  ],
  "selfEmployed": [{ "id": "s1", "borrowerId": "b2", "kind": "SCHEDULE_C", "monthly": 1500 }],
  "rentalMonthly": 900,
  "assetIncomeMonthly": 0
}
```

Rules the caller should know:

- Borrowers are in 1003 order; the first is the primary. Income without a
  `borrowerId` is the primary's, and a `borrowerId` not on the request is a 400.
- `priorEmployer` is the primary borrower's previous employer from the 1003.
  It merges into the 24-month variable average only for the primary, only when
  they are under 12 months at the job, and only when it has wages, bonus or
  overtime. A co-borrower's variable income always uses their own job.
- `baseMethod` (`hourly`, `period`, `ytd`, `prior`, `not_used`) and
  `variableMethod` (`current`, `avg24`, `not_used`) are the underwriter's
  choices; omit them for the guideline recommendation. The YTD average divides
  by `ytdMonthsElapsed`, default 7.5.
- Rental and asset income are joint and credited once, to the primary.
- Self-employed `monthly` is cash flow the caller has already calculated.
- Amounts are monthly and unrounded except the YTD, W-2 and WVOE figures, which
  are as reported. Round when displaying or writing to the LOS.

The 200 response is the engine's `BorrowerIncomeResult` plus provenance:

| Field | Meaning |
|---|---|
| `schemaVersion`, `ruleVersion` | `borrower-income-v1` and the W-2 method rule version |
| `borrowers[]` | Each borrower's `w2BaseMonthly`, `w2VariableMonthly`, `selfEmployedMonthly` and `qualifyingMonthlyIncome`, in request order |
| `employers[]` | Chosen and recommended method and monthly amount per employer, plus `warnings` |
| `totals` | Sums across borrowers; `qualifyingMonthlyIncome` equals the sum of the borrower rows |
| `requestId` | Same as the `X-Request-Id` header |
| `inputHash` | SHA-256 of the validated request with defaults filled, keys sorted |

`W2_RECOMMENDED_BASE_ZERO` in `employers[].warnings` means the recommended base
came out to zero while another method did not, which is what a salaried stub
without an hourly rate produces. Send an explicit `baseMethod` after review.

Errors use the envelope above: 400 `INVALID_BORROWER_INCOME_REQUEST` with
`issues[]` of `{ path, message }` (no submitted values), 401/403 from the
middleware, 405 for anything but `POST`, and 500
`BORROWER_INCOME_CALCULATION_FAILED`.

The result is calculation evidence, not an approval or a credit decision.
Callers that rely on it for an ability-to-repay determination keep the
response, `inputHash`, `ruleVersion` and `requestId` with their loan record
(Reg Z §1026.43 and the record retention in §1026.25(c)(3)).

Services outside this workspace can consume the engine as a package:
`pnpm --filter @mortgage-pos/mortgage-engine build:dist` compiles CommonJS and
declarations to `packages/mortgage-engine/dist`, and `pnpm pack` points `main`
and `types` there. The workspace `build` stays `tsc --noEmit`, which the
Dockerfiles run.

## Parser contract

Public code sends a bounded byte stream plus an internal signed envelope. Parser
output is schema-versioned and contains only:

- document type and confidence;
- normalized allowlisted field values;
- page number and source-derived bounding boxes;
- warnings and safe machine error codes;
- parser/model version and source SHA-256.

It MUST NOT contain a full OCR word dump in production. Parser clients enforce
connect, first-byte, total, and idle timeouts. A timeout or parser outage returns
a typed error and never invokes a less trustworthy fallback. For long OCR, prefer
a controlled fetch from Encompass by an isolated worker; do not place uploaded
raw PDF bytes in SQS or object storage merely to make the call asynchronous.

Native AcroForms are authoritative when they expose an intact text layer and
fillable widgets. If those widgets are empty, the parser MUST preserve native
text and return no borrower values; it MUST NOT OCR printed line/box numbers as
data. Official K-1 code/reference pages with an exact reference-page signature
also remain native. Flattened or scanned forms do not satisfy this bypass and
continue through the bounded OCR path. The parser logs only safe phase latency
(inspect, convert/OCR, specialized extraction, field extraction, total), never
document names, text, or values.

For W-2s, a page is eligible for W-2 extraction only when its OCR contains a
front-page wage or tax-cell signature. A title-only back or instruction page is
excluded before extraction. Hybrid forms with native value overlays are OCR'd
for their rendered labels, while excluded pages are never passed to field
extraction; these filters do not alter normalized income values or underwriting
calculations. A W-2 wage record also requires a peer wage/withholding field so a
blank copy cannot promote an EIN or box number into Box 5. W-2 images embedded
sideways in an otherwise upright PDF page may receive a bounded orientation
retry; the retry stops when a horizontal W-2 label set is established.

Digitally generated paystubs with an ordered earnings table MUST use their
native text layer. They MUST NOT be sent through OCR merely because the page is
long and numeric: OCR can scramble Hours, Rate, Current Amount, YTD Hours, and
YTD Amount. Scanned paystubs continue through the bounded OCR path. Extraction
must preserve per-row provenance while accumulating only the explicitly
classified base or variable-income rows.

## Encompass synchronization state machine

`APPROVED -> QUEUED -> IN_PROGRESS -> SUCCEEDED | RETRYABLE_FAILURE | FAILED`

- Queue payload: `{tenantId, loanId, approvalEventId, expectedLoanVersion,
  idempotencyKey, correlationId}`. No raw XML, PDF, names, or email.
- The worker reauthorizes the tenant relationship, loads the immutable approved
  event, maps fields server-side, and uses a provider idempotency/correlation key.
- State transitions use conditional updates. A duplicate message is harmless.
- Retries use bounded exponential backoff with jitter. Terminal failures go to an
  encrypted DLQ and contain safe codes only.
- External success and local audit completion must be reconcilable. A scheduled
  reconciliation job detects unknown outcomes without blindly repeating writes.

## Outbound income webhooks (standalone loans)

Standalone loans (`integrationMode = NONE`) have no LOS to sync to, so a tenant
may register one HTTPS endpoint that receives each approved income result.
Encompass-linked loans are never queued; they continue through the Encompass
sync worker above.

`APPROVED -> PENDING -> IN_PROGRESS -> SUCCEEDED | RETRYABLE_FAILURE | FAILED | SUPERSEDED`

- **Enqueue.** The approval transaction inserts an outbox row holding only IDs
  (tenant, loan, approval event, approved loan version, endpoint) plus an
  `OUTBOUND_WEBHOOK_QUEUED` audit event. No payload is stored.
- **Send.** The worker claims due rows with a conditional update fenced by a
  claim token, then rebuilds the payload from the approved calculation at send
  time. If the loan has been re-approved or edited since, the row becomes
  `SUPERSEDED` and nothing is sent; the newer approval has its own delivery.
- **Retries.** 408, 425, 429, 5xx, timeouts, and network/TLS errors are retried
  after 30s, 1m, 2m, 5m, 15m, 30m, 1h, then 2h (each ±20% jitter). After 8
  attempts the row is `FAILED` (dead letter) and an
  `OUTBOUND_WEBHOOK_FAILED` audit event is written. Redirects and other 4xx
  responses fail immediately. A claim abandoned for 2 minutes is reclaimed.
- **Egress.** URLs must be `https`, with no credentials, query, or fragment. In
  protected runtimes the host must appear in `OUTBOUND_WEBHOOK_ALLOWED_HOSTS`,
  the port must be 443, and IP literals are refused. The worker resolves DNS,
  rejects the target if any answer is private, loopback, link-local, CGNAT,
  multicast, or metadata space, and connects to the vetted address while still
  verifying the certificate for the hostname. Response bodies are not read.
- **Secrets.** Each endpoint's signing secret is stored in AWS Secrets Manager
  at `{OUTBOUND_WEBHOOK_SECRET_PREFIX}/{tenantId}/{endpointId}`. The database
  holds only the ARN. The portal can create and rotate; only the worker can read.
- **Admin controls.** Mutations require `webhooks:manage` (super admin and broker owner),
  an `Idempotency-Key`, the expected version, and in protected runtimes an
  asserted IdP `auth_time` no older than 15 minutes
  (`403 REAUTHENTICATION_REQUIRED` otherwise). Endpoint changes are written to
  the append-only `outbound_webhook_endpoint_audit_events` table; queueing,
  delivery, failure, supersession, and redelivery requests are written to the
  hash-chained `audit_events` ledger.
- **Logs.** Only safe codes and HTTP status: `webhook_delivery_success`,
  `webhook_delivery_retry`, `webhook_delivery_failure`. Never URLs, bodies,
  borrower data, or secrets.

### Receiver contract

Each delivery is `POST` with `Content-Type: application/json` and:

| Header | Value |
|---|---|
| `FreeFlow-Webhook-Id` | Delivery UUID. Stable across retries and manual redelivery; use it to deduplicate |
| `FreeFlow-Webhook-Timestamp` | Unix seconds when this attempt was signed |
| `FreeFlow-Webhook-Signature` | `v1=<hex>`; during the 24 hours after a rotation, two space-separated `v1=` values (new and previous secret) |
| `FreeFlow-Event-Type` | `income.approved` |

Body:

```json
{
  "id": "<delivery id>",
  "type": "income.approved",
  "apiVersion": "freeflow-webhook-v1",
  "createdAt": "<ISO-8601>",
  "data": { "...": "the approved-income JSON export for the loan" }
}
```

To verify, compute `HMAC-SHA256(secret, "{id}.{timestamp}.{rawBody}")` as
lowercase hex, where `secret` is the full `whsec_...` string, and compare it in
constant time against each `v1=` value. Reject when no value matches or when
the timestamp is more than 300 seconds from the receiver's clock. Respond with
any 2xx within 10 seconds; do work asynchronously. Deliveries for different
approvals may arrive out of order, so compare `data` versions before
overwriting.

## Observability contract

Every request/job emits request ID, trace ID, service, environment, route name,
tenant surrogate (keyed hash, not raw tenant ID where avoidable), result code,
latency, and version. Never log bodies or borrower/document metadata. Required
metrics include auth failures, denied cross-tenant attempts, parser limit rejects,
parser latency/error by safe class, queue age/depth/DLQ, sync outcomes, webhook
duplicates, DB pool saturation, 5xx rate, and audit append failures.
# Tenant-bound document processing

`POST /api/underwrite/process` requires `income:process`. In protected
runtimes, `x-loan-id` is required and is resolved through a tenant-scoped
database transaction before document bytes are forwarded to the parser. Missing
loan IDs return `400 LOAN_ID_REQUIRED`; absent and cross-tenant IDs both return
`404 LOAN_NOT_FOUND` to prevent resource enumeration. This gateway check does
not change parser behavior or calculation logic.
