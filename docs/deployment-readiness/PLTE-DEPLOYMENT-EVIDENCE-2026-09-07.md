# PLTE Deployment Evidence — 2026-09-07

## Outcome

FreeFlow's synthetic-only Production-Like Test Environment (PLTE) is running in
AWS `us-west-2`. The temporary endpoint is:

`http://freeflow-dev-portal-732594126.us-west-2.elb.amazonaws.com`

This is not a production or real-data approval. The ALB security group allows
HTTP only from the operator workstation's current public IPv4 `/32`. The
allowlisted address is stored only in ignored local Terraform variables.

## Deployment evidence

- Terraform foundation/edge apply: 9 additions, 0 changes, 0 destroys.
- Migration preflight definition apply: 1 addition, 0 changes, 0 destroys.
- Portal scale apply: desired count `0 -> 1`, no destroys.
- ECS service `freeflow-dev-portal`: `ACTIVE`, desired `1`, running `1`,
  pending `0`, deployment `COMPLETED`, failed tasks `0`.
- ALB target: healthy on private task address port `8000`.
- ECS service `freeflow-dev-income-parser`: `ACTIVE`, desired `1`, running `1`.
  It has no public IP, no ALB target, and accepts port `8080` only from the
  portal security group through private service discovery.
- Parser image: immutable digest
  `sha256:1572b8eb9d1159ae0e76e54f54ee7157b50a824ce0e593927c823365fa57ced8`;
  ECR Basic scan completed with zero critical, high, medium, or low findings.
- Portal image after the stylesheet repair: immutable digest
  `sha256:6e59a381ce1b535737d0c2b6ec58d1d1b29bc9a7ff3cd285b128a6b03b2ccc1a`;
  ECR Basic scan completed with no findings.
- ECS portal task definition revision `2`: desired `1`, running `1`, pending
  `0`, deployment `COMPLETED`.

## Database evidence

- Initial private preflight: `PREFLIGHT_DATABASE=ABSENT`.
- The first bootstrap attempt stopped before schema migration because Amazon RDS
  does not permit a non-superuser administrator to alter the `SUPERUSER`
  attribute. No application migration ran.
- Second private preflight after that stopped task:
  `PREFLIGHT_TOTAL_ROWS=0`.
- The corrected RDS-compatible bootstrap was exercised twice against disposable
  PostgreSQL 18: all four migrations applied, the second run had no pending
  migrations, tenant RLS isolation passed, and all FreeFlow roles were verified
  without superuser, createdb, createrole, replication, or bypass-RLS powers.
- Corrected AWS migration task exited `0`; CloudWatch logs recorded
  `restricted_login_roles_verified`, all four ordered migrations, successful
  synthetic tenant/user seed, and `FreeFlow database migration completed
  successfully`.
- Migration and preflight task-definition revision `3` uses immutable image
  digest `sha256:2d99a7fe1d9de0c2ec62faa370ca0f4a100166b8ffcc48a6619f6573fe51e3e9`;
  its ECR scan completed with zero findings at every severity.

## Live smoke tests

- `GET /`: HTTP `200`, expected portal content present.
- `GET /_next/static/css/714e120eebfd5bd5.css`: HTTP `200`, content type
  `text/css; charset=UTF-8`, 24,546 bytes; expected Tailwind layout rules
  verified. This closes the initial unstyled-page regression.
- `POST /api/underwrite/process` with a synthetic W-2: HTTP `200`, transaction
  ID returned, one page parsed, one document extracted, classification `W-2`.
  This proves portal-to-parser communication over the private namespace.
- `POST /api/income/calculate` for a nonexistent synthetic loan: tenant-scoped
  HTTP `404` with the expected `LOAN NOT FOUND` contract, proving the restricted
  application database path and tenant context are active.
- Portal startup logs: Next.js ready on port `8000`; no startup failure.

## Accepted temporary risks and controls

- Parser and migration images have no ECR Basic findings. The parser remains
  synthetic-only until retention canaries, adversarial corpus/resource testing,
  and independent security qualification pass.
- The temporary endpoint is HTTP and uses explicit development identity bypass;
  its compensating control is the workstation `/32` allowlist. It must be
  replaced by domain-backed HTTPS and Cognito before broader access.
- No real borrower data, production credentials, document uploads, Encompass
  writes, or Stripe processing are authorized.
- Exception review/expiration: 2026-09-14 or before any non-synthetic pilot,
  whichever occurs first.

## Next gate

Confirm control of the intended domain, move/delegate DNS to Route 53, issue an
ACM certificate, enable the Cognito ALB listener, disable development identity
bypass, subscribe the operations alert destination, and retest authentication
before adding testers outside the allowlisted workstation. See
[Domain, Cognito, and User Access Runbook](DOMAIN-COGNITO-USER-ACCESS-RUNBOOK.md).

## Monitoring evidence

- CloudWatch dashboard: `freeflow-dev-operations`.
- Encrypted SNS topic:
  `arn:aws:sns:us-west-2:098767424191:freeflow-dev-operations`.
- Seven alarms are provisioned and currently `OK`: portal target 5xx, unhealthy
  targets, portal CPU, parser CPU, RDS free storage, oldest sync-queue message,
  and visible dead-letter messages.
- The email subscription is intentionally pending an approved operations email.
