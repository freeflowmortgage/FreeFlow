# Application and Functionality Specification

## Current capability assessment

| Area | Current state | Production gap |
|---|---|---|
| Local orchestration | Seven Docker services can run and report healthy | Databases/parsers are host-published; health does not establish functional readiness |
| Portal | Next.js demo UI and API prototypes | No real authentication/session; demo fallback; invalid route modules; incomplete workflow persistence |
| Underwriting console | Vite UI with fixture middleware | Starts a development server in its runtime image and exposes synthetic content; QA-only |
| Income parser | PDF/OCR path with byte/page limits | Vulnerable dependencies, expensive synchronous OCR, full OCR word output, incomplete admission controls |
| Appraisal parser | Structured rule/audit prototype | Text-fixture acceptance in production path, no dependable scanned-document OCR, non-source coordinate boxes |
| Calculations | Deterministic modules and 33 passing assertions | Cross-app test import failure; rule/version/audit lifecycle not integrated end to end |
| Encompass | Pull/sync prototypes | Credential/model drift, caller-controlled writes, no durable idempotent worker/outbox |
| Billing | Stripe signature concept and fee model | Route wiring failure, metadata trust, duplicate-event risk, no authoritative reconciliation |
| Database | Prisma design and manual RLS examples | Zero live app tables, no migrations, incomplete tenant/audit model |

## Production product boundaries

### Portal

The portal is the only public product runtime. It provides authenticated loan
selection, document processing initiation, source-linked review, deterministic
calculation, human override/approval, summary export, and Encompass sync status.
It never contains fixture responses in the production build.

### Income workflow

1. User selects an authorized tenant-scoped Encompass loan/attachment or uploads
   within policy.
2. Bytes stream to the isolated income parser and are discarded after response.
3. UI presents normalized fields with actual page/coordinate evidence and parser
   warnings.
4. Deterministic rules calculate using a pinned ruleset version.
5. Reviewer confirms or enters an explained override; the backend appends an
   immutable approval event.
6. Sync worker writes only that approved event to Encompass and reconciles result.

### Appraisal workflow

Appraisal review is a separate module and permission set. It requires strict PDF
validation, actual source evidence, supported form detection, explicit
unsupported/scanned-document handling, deterministic rules, and human resolution
of findings. An empty extraction cannot be presented as a completed audit.

### QA console

The console is an internal synthetic-data laboratory. It is either omitted from
production entirely or deployed into a separate non-production account behind
workforce authentication, an IP/access policy, and an unmistakable environment
banner. It has no route to production RDS, production Encompass credentials, or
real borrower documents.

## Functional correctness requirements

- Missing loans return 404; unavailable dependencies return 503. No fabricated
  borrower/document/calculation data is ever returned outside explicit QA fixtures.
- Calculations use decimal-safe deterministic arithmetic, versioned field maps,
  canonical inputs, and stable golden tests. Money never uses binary floating
  point or trusts client-calculated values.
- Source evidence is derived from the actual page, not a static template. The UI
  distinguishes extracted, calculated, overridden, approved, synced, failed, and
  stale states.
- An upstream source/version change invalidates downstream approval and requires
  re-review. Stale approval cannot sync.
- Every external write and billable operation is idempotent and visible in an
  operator-safe status page.
- Accessibility target is WCAG 2.2 AA: keyboard workflow, visible focus, semantic
  labels/headings, non-color-only states, appropriate live regions, and automated
  plus manual testing.
- Responsive behavior supports the defined workstation/tablet range. Loan review
  need not pretend to be fully functional on an unsafe viewport; communicate the
  supported minimum clearly.

## Configuration and environment rules

- `.env.development` is the local-development configuration and may remain
  tracked with mock-only values. `.env.example` remains its source template.
- `.env.production` is ignored and never shipped. `.env.production.example`
  defines names, classification, and placeholders only.
- Production ECS task definitions separate non-secret environment variables from
  Secrets Manager/SSM references. No `NEXT_PUBLIC_*` variable may contain a
  credential or authoritative price/security decision.
- Business fees, tenant policy, supported forms, and rule activation are
  versioned server-side configuration, not caller input or mutable public env.
- Startup validates required configuration and exits with a field name plus safe
  error class; it never prints the value.

## Definition of done for a production capability

A capability is complete only when its API schema, authorization matrix,
tenant-negative tests, deterministic/domain tests, failure behavior, audit event,
metrics/alerts, migration, rollback path, runbook, and data-retention classification
are present. A clickable UI backed by fixtures is a prototype, not completion.

## Later frontend/usability phase

After all P0 deployment and data-integrity controls are closed, evaluate task
completion time, review accuracy, exception recovery, accessibility, cognitive
load, source-evidence navigation, responsive layout, empty/loading/error states,
and operator workflows. Do not polish screens in ways that hide an unimplemented
or unsafe backend state.
