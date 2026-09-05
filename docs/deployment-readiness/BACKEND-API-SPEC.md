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
| `POST /api/v1/loans/{loanId}/income-approvals` | `income:approve` | Append approval/override event with reason and optimistic version; never update history |
| `GET /api/v1/loans/{loanId}/income-summary` | `loan:read` | Return only real tenant-scoped state; 404/503 rather than fixture fallback |
| `GET /api/v1/loans/{loanId}/income-summary.pdf` | `loan:read` | Render from an approved/versioned calculation; `no-store`; audit export |
| `POST /api/v1/loans/{loanId}/encompass-syncs` | `encompass:sync` | Enqueue approved audit ID and expected version; return 202 and job ID |
| `GET /api/v1/encompass-syncs/{jobId}` | `encompass:sync` | Return tenant-scoped job state and safe failure code |
| `POST /api/v1/appraisals/audits` | `appraisal:review` | Strict PDF extraction plus versioned rules; domain-isolated storage |
| `POST /api/v1/share-links` | `share:create` | Generate purpose-bound, expiring token; store only hash |
| `POST /api/v1/webhooks/stripe` | Provider signature | Verify signature over raw body, claim event once, reconcile authoritative amount/currency/tenant, then acknowledge |
| `GET /health/live` | Internal health check | Process liveness only, no sensitive detail |
| `GET /health/ready` | ALB/orchestrator | Schema compatibility and required dependencies; generic 200/503 only |

`map-encompass-fields` is a library function, not an HTTP endpoint. Queue
construction and worker startup are separate processes, not Pages API modules.

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

## Observability contract

Every request/job emits request ID, trace ID, service, environment, route name,
tenant surrogate (keyed hash, not raw tenant ID where avoidable), result code,
latency, and version. Never log bodies or borrower/document metadata. Required
metrics include auth failures, denied cross-tenant attempts, parser limit rejects,
parser latency/error by safe class, queue age/depth/DLQ, sync outcomes, webhook
duplicates, DB pool saturation, 5xx rate, and audit append failures.
