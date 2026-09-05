# Adversarial Security and Backend Assessment

Assessment date: 2026-09-04
Scope: repository code, local Docker runtime, API behavior, database state,
dependency manifests, parser services, and existing ECS artifacts.
Method: source review, unauthenticated and forged-header requests against the
local stack, route checks, database inspection, container inspection, unit-test
execution, and package vulnerability audits. This is a deployment-gating review,
not a substitute for an independent authenticated penetration test.

## Executive result

**Production release is blocked.** The highest-risk failure is that the running
application has no trustworthy authentication boundary: APIs accept identity and
tenant context from arbitrary headers or request bodies. That makes cross-tenant
access, forged privileged actions, and unauthorized document processing plausible.
The data layer is also not deployable: the development database contains no
application tables, there is no migration history, and several code paths and the
Prisma schema disagree.

Positive foundations include non-root container users, parser size/page limits,
`no-store` behavior in the appraisal service, webhook signature verification in
concept, deterministic calculation tests, and a clear zero-document-retention
goal. Those controls are not yet joined into an enforceable production system.

## Confirmed adversarial observations

These requests were issued without a login against the local development stack:

- Console fixture PDF download returned 200.
- Console summary-PDF generation returned 200.
- Console income processing returned 200.
- Portal income processing returned 200 when arbitrary `x-tenant-id`,
  `x-underwriter-id`, and role headers were supplied.
- Appraisal audit returned 200 with arbitrary identity headers and non-PDF text.
- The portal returned a fabricated demo summary for a nonexistent loan when its
  database path failed.
- Three files exposed as Pages Router APIs returned 500 because they are library
  code or App Router handlers rather than valid Pages API handlers.

Do not repeat these probes against any environment containing real borrower data
until authorization and test-data controls are in place.

## Findings

| ID | Severity | Finding | Evidence / impact | Required disposition |
|---|---|---|---|---|
| SEC-001 | Critical | No verified authentication boundary | Live endpoints accept requests without a session; identity is read from client-controlled headers. An attacker can impersonate a tenant, underwriter, or role. | Implement OIDC; verify ALB/JWT signatures, issuer, audience, expiry, signer, and nonce/state as applicable; derive tenant/role server-side. |
| SEC-002 | Critical | Broken object-level authorization and tenant isolation | Loan and share-token lookups are not consistently tenant-scoped; a service-role Supabase client bypasses RLS. | Require tenant context in every repository method and composite key; add negative cross-tenant tests. |
| SEC-003 | Critical | Untrusted client data can drive Encompass writes | The sync route accepts calculation payloads and spoofable roles rather than loading an approved locked audit. Replays are not idempotent. | Sync only immutable approved calculation IDs; require idempotency key and compare-and-set state transitions. |
| SEC-004 | Critical | No deployable database schema | The running PostgreSQL database has zero application tables and the repo has no migrations. APIs reference models/tables that do not agree. | Establish a baseline migration, validate schema drift, use a separate migrator role, and block startup/readiness on incompatible schema. |
| SEC-005 | High | Zero-retention policy is contradicted by storage models and queues | Models retain OCR payloads/raw values and document keys; Redis jobs can contain raw XML, borrower name, and broker email. | Remove raw document/OCR/XML fields and payloads; store allowlisted results, hashes, coordinate evidence, and external attachment references only. |
| SEC-006 | High | Production route failures are hidden or fabricated | Invalid Pages API modules return 500; summary generation silently returns demo borrower data on DB failure or a missing loan. | Return typed 404/503 errors; prohibit demo fallback in production; make readiness dependency-aware. |
| SEC-007 | High | Dependency vulnerabilities exceed release policy | Production audit found 34 JavaScript advisories (12 high) and the income parser audit found 81 known issues across four packages. The appraisal parser audit found none at assessment time. | Upgrade and lock dependencies; generate SBOM; rescan; release threshold is zero critical/high known vulnerabilities unless an approved time-bound exception exists. |
| SEC-008 | High | Billing webhook is not idempotent and trusts metadata for money/tenant | Retry can duplicate ledger activity; tenant, amount, and tier are accepted from payment metadata without authoritative reconciliation. | Persist unique provider event/payment IDs; reconcile amount, currency, product, loan, and tenant from server records in one transaction. |
| SEC-009 | High | Shared-link authorization is incomplete | Token queries are not tenant-scoped, token storage appears plaintext, and token metadata is not bound to the requested loan. | Store token hashes, bind tenant/loan/purpose, enforce one-time/expiry/revocation, and audit use. |
| SEC-010 | High | Appraisal parser accepts text fixtures as production input | Non-PDF text can be treated as a successful appraisal. Coordinates are template positions rather than source-derived evidence. | Gate fixture parsing behind explicit test mode; strictly validate PDF; implement trustworthy extraction/OCR coordinates or fail closed. |
| SEC-011 | High | Console image is a development/test server | Production-stage container starts Vite and exposes fixture/demo middleware without auth. | Keep console private and QA-only, or replace it with a compiled production service with authentication and no fixtures. |
| SEC-012 | High | Resource-exhaustion controls are incomplete | Upload bodies are buffered before enforcement; OCR at 300 DPI/150 pages is CPU and memory intensive; eFolder pulls lack aggregate bounds. | Enforce limits at first byte where possible, cap aggregate pages/bytes/time, isolate parser tasks, limit concurrency, apply quotas and cancellation. |
| SEC-013 | High | Audit history is mutable and incomplete | Current RLS examples permit updates/deletes; audit records omit consistent actor, reason, rule version, request ID, and hashes. | Use append-only event tables and DB triggers that reject update/delete; add hash chain or immutable archive evidence. |
| SEC-014 | Medium | Secrets/configuration boundaries are unsafe for image builds | `.env.development` is tracked by design and was included in Docker build contexts. It currently contains mock/example values, but the pattern risks future leakage. | `.dockerignore` all `.env*`; keep a placeholder production contract; inject production secrets through ECS secret references. |
| SEC-015 | Medium | Containers are only partially hardened | Containers run non-root, but root filesystems are writable and default capabilities/security options remain. Images are floating tags. | Read-only root, drop all capabilities, no-new-privileges where supported, digest pinning, image scan/signing, and resource limits. |
| SEC-016 | Medium | Sensitive detail can leak through errors and logs | Internal error messages, loan GUIDs, document titles, attachment IDs, names, and email data are logged or returned. | Structured allowlisted logs, stable public error codes, correlation IDs, log data protection, and security review of every field. |
| SEC-017 | Medium | Network and browser hardening is absent/inconsistent | All development dependencies are host-published; the unused Nginx config has incorrect upstreams and permissive CSP. Live responses lack a coherent security-header policy. | Public ALB only; private task/database/cache subnets; target SG restrictions; CSP/HSTS/frame policy at ALB/app; trusted proxy configuration. |
| SEC-018 | Medium | Test and build behavior can conceal failures | A Docker build suppresses a package build failure; one portal test suite cannot resolve a cross-app import in the runtime image; Python images omit test suites. | No `|| true` for required builds; dedicated CI test stages; hermetic package boundaries; artifact and migration verification. |

## Dependency evidence

- JavaScript production tree: 34 advisories: 0 critical, 12 high, 19
  moderate, 3 low. Notable resolved versions included Next.js 14.2.35,
  Nodemailer 6.10.1, and PostCSS 8.4.31.
- Income parser: 81 known vulnerabilities reported across `pypdf` 4.2.0,
  `python-multipart` 0.0.9, Pillow 10.3.0, and Starlette 0.37.2.
- Appraisal parser: no known vulnerabilities reported by the same audit method.
- JavaScript unit tests: 8 suites/33 assertions passed; one suite failed at
  compilation because it imports source from another application that is not in
  the portal runtime image.
- Python tests were not runnable from the production images because tests and
  pytest are not included. CI needs a separate test image/stage; production
  images should remain minimal.

Audit counts are a dated snapshot, not a guarantee. CI must regenerate the
evidence on every pull request and immediately before promotion.

## Release gates

Production may proceed only when:

1. SEC-001 through SEC-013 have passing automated acceptance evidence.
2. No endpoint trusts caller-provided tenant, user, role, price, or approval state.
3. Cross-tenant and unauthenticated tests fail closed for every route.
4. Database migration, restore, rollback, and schema-drift drills pass in staging.
5. Images are reproducible, digest-pinned, scanned, signed, and deployed from CI.
6. A staging penetration test and ZDR data-flow review find no unresolved critical
   or high issue.
