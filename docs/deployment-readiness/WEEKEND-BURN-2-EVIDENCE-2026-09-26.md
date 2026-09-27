# Weekend Burn 2 deployment evidence — 2026-09-26

This record covers the synthetic `freeflow-dev` qualification in AWS account
`098767424191`, region `us-west-2`. It is not production approval. The backend
feature set and parser contract were frozen; no parser, OCR, classification,
extraction, coordinate, page-selection, document-reading, calculation, or UI
behavior was changed.

## Release identity

- Branch: `codex/weekend-burn-2`
- Qualification commits: `c348d6c`, `aa3025a`, `2273a02`
- Portal image: `sha256:75735a61cde253c2a21abba63d8daf7f45a145461cfa90b5b38551b2c59dc975`
- Parser image: `sha256:592f6e13c2738793d4b8ca7f41839420393c409c2c4faf0239aaad5a6d52416e`
- Migration image: `sha256:f18ec176dbaf47e3e1288d6e35e3f26bd7ec7b834ae782f64617704c04edc7b6`
- Connector image: `sha256:7599636cf2cafbacabdcda00157b4c2ba8debfb671ff95c0831c5636693edcfb`

## Database deployment and recovery

- The preflight found 19 existing rows and correctly stopped with exit `42`.
- Encrypted snapshot `mortgage-dev-pre-burn2-20260926-190311` was available
  before migration and remains retained.
- Restricted migration task revision 15 exited `0` and installed all 10 ordered
  migrations, including the approved-sync, authoritative-extraction, and
  authoritative-metadata migrations. `prisma db push` was not used.
- Restricted-role checks, FORCE RLS, SQL isolation/retention checks, five app
  integration tests, and three connector database tests passed.
- An isolated restore became available in 337 seconds. A corrected read-only
  verification reported 7 pre-snapshot migrations, 16 tables, 15 FORCE RLS
  tables, 3 tenants, 6 users, 1 connector binding, and 0 audit events. Verified
  recovery took approximately 7 minutes 30 seconds. The restored instance was
  deleted after verification.

## Deployment and runtime

- Terraform converged with the QA console disabled and the portal, parser,
  connector, document-pull worker, and sync worker enabled.
- Final ECS state was 1 desired / 1 running / 0 pending for all five services,
  with one completed deployment each. The portal target was healthy.
- A final `terraform plan -detailed-exitcode` returned `0` with no changes.
- Every deployed task uses an immutable digest, a distinct task role, a
  non-root user, read-only root filesystem, no privileged mode, dropped Linux
  capabilities, and bounded CPU/memory. Runtime secret injection is scoped by
  service. The QA console is not deployed.
- Corrected worker bundles resolve Prisma from their deployed working
  directory. No parser source was modified.

## Authentication and tenant isolation

- HTTP redirected to HTTPS. Anonymous root/API requests, forged ALB identity
  headers, and an expired synthetic bearer token were denied by redirect to
  Cognito.
- Cognito MFA is ON with software-token MFA enabled. Six users were confirmed;
  one user remained in `FORCE_CHANGE_PASSWORD` state.
- The full live positive reviewer and object-level matrix was not completed
  because the authenticated in-app browser session was unavailable to the test
  runner. Automated route, cross-tenant, app-role, worker-role, and database
  isolation tests passed, but they do not replace the required live matrix.

## ZDR canary

- A unique synthetic in-memory PDF canary traversed the deployed connector and
  unmodified deployed parser. The canary task exited `0`; parser result metadata
  reported one completed request and no retained OCR pages.
- Thirty-five CloudWatch searches (seven FreeFlow log groups by five marker
  classes) found no raw marker values.
- A read-only scan of every public PostgreSQL text, varchar, char, JSON, and
  JSONB column completed with `ZDR_DB_MATCHES=0`.
- Both source queues and both DLQs were empty after the drill. The canary task
  filesystem was destroyed; deployed tasks expose only read-only roots and
  bounded temporary storage. No trace/cache service or canary CI artifact was
  present.
- This proves the connector-to-parser slice and managed sinks inspected above.
  It does not prove the entire authenticated persistence, calculation,
  approval, and sync sequence, which remains blocked with the live positive
  authorization/demo matrix.

## Queues, alarms, and operational drills

- A metadata-only poison message reached the sync DLQ after receives 1 through
  5. A bounded redrive returned it to the source queue; it was consumed and
  deleted with no provider effect. All four queues ended at zero visible,
  in-flight, and delayed messages.
- All 28 CloudWatch alarms ended `OK` with actions enabled. A controlled auth
  denial alarm entered `ALARM` and was restored to `OK`.
- The operations SNS email subscription remains `PendingConfirmation`, so
  human notification delivery is not yet qualified.
- The previous portal digest was identified, but its task definition is
  inactive. An application rollback, Encompass outage/reconciliation drill,
  and test-secret rotation were not executed.

## Connector and Encompass boundary

- The deployed connector is explicitly synthetic and private. A provider-
  boundary smoke covered missing/invalid authorization, wrong tenant/lender/
  deployment, forbidden credential input, deterministic list/download, PDF
  signature, and content hash. It exited `0`.
- The deployed connector-to-parser smoke exited `0`.
- Live ICE qualification requires a sandbox client ID/secret/instance ID, the
  authoritative tenant-to-lender/deployment binding, one synthetic loan GUID,
  a supported synthetic attachment, the custom fields, and least-privilege API
  permissions. No live ICE result is claimed.

## CI and local qualification

- Turbo monorepo: 6/6 test tasks and 5/5 build tasks passed.
- Portal: 87 tests and a production build with 17 routes passed.
- Connector contract: 30 tests passed. Connector service: 41 tests passed.
- Parser: 324 tests passed; one fixture-dependent test skipped. The parser was
  exercised from a disposable writable copy because its fixture suite writes
  generated artifacts; source remained unchanged.
- PostgreSQL 16 blank-database migration and all database qualifications passed.
- Prisma validation/generation, Terraform formatting/validation, actionlint,
  full-history gitleaks, and `pip-audit` passed.
- `pnpm audit` has no high/critical findings (two moderate findings remain).
- Trivy scans of the exact deployed images found no HIGH/CRITICAL findings and
  no embedded secrets. Release CI now includes tests/builds, migration/RLS,
  Terraform validation, secret/dependency/container scanning, SHA image tags,
  digest deployment checks, and SBOM generation.

## Verdict

`PARTIAL — INTERNAL BLOCKERS REMAIN`

Largest internal execution scope: complete the live authenticated reviewer,
membership/role, and cross-object matrix and repeat the real synthetic customer
flow from fresh sessions. Alert-email confirmation, rollback, outage, and
secret-rotation evidence also remain. ICE sandbox qualification is external.
