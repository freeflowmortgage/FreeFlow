# Production Security Specification

Normative words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** define release
requirements. The security owner must record and expire any exception.

## Trust boundaries and principal threats

| Boundary | Primary threats | Mandatory controls |
|---|---|---|
| Browser to public application | Session theft, CSRF, forged tenant/role, IDOR, malicious upload | OIDC, secure server session, CSRF protection, server-derived tenant, object authorization, strict upload limits |
| Public application to parsers | SSRF, replay, document exfiltration, parser compromise | Private networking, service authentication, TLS, body hash/timestamp, no parser egress, isolated task role |
| Application to database | Cross-tenant query, owner/RLS bypass, injection, excessive retention | Parameterized repository layer, transaction tenant context, FORCE RLS, least-privilege role, allowlisted persisted fields |
| Application to Encompass/Stripe | Credential theft, replay, forged callbacks, wrong-loan write | Secrets Manager, egress allowlist, signed webhook verification, idempotency, immutable approval source |
| Build to deployment | Dependency compromise, mutable artifact, leaked secret | Locked dependencies, SBOM, ECR enhanced scanning, signing, immutable digest, CI OIDC role |
| Logs and telemetry | NPI/PII leakage, token leakage, incident blind spots | Allowlisted structured schema, redaction, data protection policy, correlation IDs, protected audit trail |

## Identity and session

- The public application MUST authenticate with a supported OIDC provider.
  Production SHOULD use Amazon Cognito or the organization's existing workforce
  IdP through the Application Load Balancer.
- The application MUST cryptographically verify the identity assertion on every
  request. When ALB authentication is used, verify the `x-amzn-oidc-data`
  signature, expiration, expected signer ARN, and subject. The application target
  security group MUST accept traffic only from the ALB security group.
- Tenant ID and application roles MUST come from an active database membership
  for the verified subject. They MUST NOT come from `x-tenant-id`, request body,
  query string, Supabase `user_metadata`, email domain, or an unsigned claim.
- Sessions MUST use `Secure`, `HttpOnly`, and an appropriate `SameSite` setting.
  State-changing browser calls MUST have CSRF protection and an exact origin
  check. Session and refresh-token rotation MUST be supported.
- The portal API middleware enforces the exact-origin portion for protected
  `POST`, `PUT`, `PATCH`, and `DELETE` requests: a single `Origin` header MUST
  exactly match `TRUSTED_ORIGIN`; absent, duplicate, malformed, or cross-site
  values fail closed. This is not authorization and does not relax the
  verified-identity, membership, permission, or object checks.
- Authorization MUST be deny-by-default. Required permissions are operation
  names, not broad UI roles; for example `loan:read`, `income:approve`,
  `encompass:sync`, `billing:admin`, and `appraisal:review`.

## Tenant and object authorization

Every business record MUST carry `tenant_id`, including child and audit records.
Every lookup and mutation MUST use a tenant-qualified key. A request is allowed
only when all of these match:

1. authenticated subject;
2. active tenant membership;
3. required permission;
4. record `tenant_id`;
5. loan/document relationship;
6. record state permitted by the workflow.

The database connection MUST set a transaction-local tenant and actor context.
RLS is defense in depth; service-role or owner connections are prohibited for
normal request handling. CI MUST include a two-tenant matrix proving reads,
writes, joins, exports, webhooks, share links, and background jobs cannot cross
the boundary.

## Document and privacy controls

- Production MUST follow bytes-in, JSON-with-source-coordinates-out.
- Raw PDFs MUST NOT be written to PostgreSQL, Redis, SQS, object storage, logs,
  traces, crash dumps, or swap. Encompass retains source documents.
- OCR text MUST NOT be retained. Persisted results MUST be an explicit allowlist
  of calculation inputs/outputs, normalized values, page and coordinate evidence,
  source attachment ID, source SHA-256, parser/rule version, and timestamps.
- SSNs, EINs, account numbers, borrower names, emails, and addresses MUST be
  removed unless a documented workflow strictly requires them. Required fields
  MUST be field-encrypted and omitted from logs.
- Uploads MUST enforce content length, aggregate request limits, PDF magic and
  structural validation, page limits, decompression/resource limits, timeouts,
  and tenant quotas. Parser failure MUST fail closed; it MUST NOT silently switch
  to synthetic or fixture data.
- Fixture/text parsing MUST be compile-time or startup-disabled in production.
- Parser tasks SHOULD have no general internet egress and MUST have no AWS data
  permissions beyond telemetry and secret retrieval strictly required for
  service authentication.

## Secrets and cryptography

- Production secret values MUST live in AWS Secrets Manager or, for suitable
  configuration, encrypted SSM Parameter Store. ECS references them by ARN.
- `.env.production` MUST remain untracked and MUST NOT enter a Docker build
  context. `.env.production.example` contains the supported names only.
- Do not configure `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`; use separate
  task and execution IAM roles with short-lived credentials.
- Secrets MUST be scoped per environment and service, encrypted by a customer-
  managed KMS key where the threat model requires it, and rotated. Rotation of an
  ECS environment-injected secret requires a forced new deployment.
- Password-grant OAuth flows and shared global Encompass usernames/passwords are
  prohibited. Use supported client credentials or delegated flows, with tenant-
  scoped credentials when the integration requires tenant separation.
- Shared-link tokens MUST contain at least 128 bits of randomness. Store only a
  keyed hash; bind tenant, loan, purpose, expiry, maximum uses, and revocation.

## Application and platform hardening

- Production images MUST run as non-root with read-only root filesystems, all
  Linux capabilities dropped, no privilege escalation, pinned base-image digests,
  and explicit CPU/memory limits. Write-dependent libraries must be fixed or the
  exception documented; raw documents must never use persistent scratch volumes.
- Fargate does not support Docker `tmpfs`. A verified no-write parser is preferred.
  If RAM-only scratch is mandatory, use an approved ECS-on-EC2 design with tmpfs
  after a separate risk review; Fargate encrypted ephemeral disk is not RAM-only.
- Public traffic MUST terminate at TLS 1.2+ on ALB. Apply HSTS, a nonce/hash-based
  CSP without `unsafe-eval`, `X-Content-Type-Options: nosniff`, a strict
  `frame-ancestors` policy, `Referrer-Policy`, and `Permissions-Policy`.
- WAF is a supplemental control. Its limited request-body inspection cannot prove
  a PDF safe; the application/parser remains responsible for full validation.
- Errors exposed to clients MUST contain a stable code, safe message, and request
  ID only. Logs MUST use an allowlisted JSON schema and never serialize request
  bodies, headers, documents, OAuth tokens, secrets, raw upstream responses, or
  borrower-identifying fields.

## Supply chain and release policy

CI MUST run tests, type checks, linting, migration validation, secret scanning,
SAST, dependency audits, container scanning, and an SBOM generator. Required
steps MUST NOT be suppressed with `|| true`. Images MUST be built once, signed,
stored in ECR with immutable tags, and promoted by digest. Production deployment
roles MUST be assumed with short-lived CI federation and require approval.

Release is blocked by any known critical/high vulnerability unless a named owner,
exploitability analysis, compensating control, and expiration date are approved.

## Security verification suite

- anonymous, expired, wrong-issuer, wrong-audience, wrong-signer, and forged-header tests;
- two-tenant read/write/job/webhook/share-link IDOR tests;
- CSRF, replay, duplicate webhook, and duplicate sync tests;
- oversized, malformed, polyglot, encrypted, decompression-heavy, and scanned PDF tests;
- log-capture assertion that no prohibited field appears;
- container checks for user, read-only root, capabilities, image digest, and task role;
- database tests for FORCE RLS and rejected audit update/delete;
- restore drill and dependency outage behavior with no demo fallback.

## AWS control references

- [ECS task and container security best practices](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-tasks-containers.html)
- [ECS IAM roles and least privilege](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html)
- [ECS secrets from Secrets Manager](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [ALB OIDC/Cognito authentication and claim verification](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html)
- [CloudWatch Logs data protection](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/mask-sensitive-log-data.html)
- [ECR enhanced image scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-enhanced.html)
- [ECR image signing](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-signing.html)
