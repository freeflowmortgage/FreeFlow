# Weekend Burn 3 qualification evidence — 2026-09-26

## Verdict

`PARTIAL — INTERNAL BLOCKERS REMAIN`

This burn closed live identity, tenant-isolation, rollback, alarm-mechanics,
secret-rotation, and worker/connector-auth qualification. It did not complete
the customer lifecycle, live provider-outage reconciliation, or the final ZDR
canary because the authenticated document-pull API returned a redacted internal
database error before a job was created. No parser, OCR, document-reading,
classification, extraction, coordinate, page-selection, calculation, or UI code
was modified.

## Authenticated authorization matrix

All cases used the deployed Cognito Hosted UI, software-token MFA, ALB session
cookies, and deployed API routes. Tokens and MFA seeds were never logged.

| Case | Live result |
|---|---|
| Anonymous | `302` to Cognito |
| Forged `x-amzn-oidc-data` | `302` to Cognito; header did not bypass ALB |
| Expired/bogus ALB cookies | `302` to Cognito |
| Disabled Cognito user | Hosted login denied |
| Authenticated user without membership | `403 MEMBERSHIP_REQUIRED` |
| Loan officer metadata review | `403 PERMISSION_DENIED` |
| Loan officer approval | `403 PERMISSION_DENIED` |
| Loan officer sync | `403 PERMISSION_DENIED` |
| Reviewer permission boundary | Reached tenant-scoped lookup (`404 LOAN_NOT_FOUND`), not permission denial |
| Same-tenant persisted loan | Reached extraction lookup (`404 EXTRACTION_NOT_FOUND`) |
| Tenant A → Tenant B loan | `404 LOAN_NOT_FOUND` |
| Tenant A → Tenant B extraction | `404 LOAN_NOT_FOUND` |
| Tenant A → Tenant B approval | `404 LOAN_NOT_FOUND` |
| Tenant A → Tenant B document-pull job | `404 DOCUMENT_PULL_NOT_FOUND` |
| Tenant A → Tenant B sync job | `404 SYNC_JOB_NOT_FOUND` |

The matrix proves active membership, negative role enforcement, and
non-disclosure for real synthetic cross-tenant rows. It does not prove a
successful live metadata review or approval because no deployed workflow
produced an eligible extraction/calculation.

## Customer workflow

- Fresh reviewer Cognito/MFA sessions succeeded repeatedly.
- Signed HMAC connector → selected synthetic attachment → deployed parser passed
  in private subnets after aligning the connector-owned smoke harness with the
  immutable parser response field `total_pages_scanned`.
- Terraform corrected the dev connector from the incompatible Bearer stub to
  `signed-replay`, matching both deployed workers.
- The real authenticated document-pull request for the clean synthetic loan
  returned `500 INTERNAL_ERROR`; the portal logged only request ID and
  `PrismaClientUnknownRequestError`.
- No fixture success state or database-edited extraction/calculation/approval was
  used. The synthetic provider's approved-income write method also remains
  intentionally fail-closed with `SYNTHETIC_WRITE_DISABLED`.

Result: customer demo `NOT READY`.

## Rollback

- Known-good portal revision: `freeflow-dev-portal:15`, immutable digest retained.
- Controlled candidate: revision `16`, identical image digest; no rebuild.
- Candidate stabilization: **157 seconds**.
- Rollback to revision `15`: **157 seconds**.
- Final state: desired `1`, running `1`, rollout `COMPLETED`.
- Fresh Cognito/MFA login and tenant-scoped API request passed after rollback.
- No database down-migration was attempted.

## Secret rotation

- Added Terraform `connector_service_token_rotation_epoch`; changing it replaces
  only the generated non-production token and Secrets Manager version.
- Reviewed plan: two replacements only; apply completed successfully.
- Connector service was force-refreshed and stabilized.
- Fresh private task using `AWSCURRENT` completed authenticated attachment
  list/download (`exit 0`).
- Fresh private task restricted to `AWSPREVIOUS` was rejected as expected
  (`exit 1`).
- No credential value appeared in command output, source, or application logs.
- Terraform post-rotation plan: `No changes`.

## Alert mechanics

- Temporary isolated CloudWatch alarm observed `ALARM` and returned to `OK`;
  alarm was deleted afterward.
- The operations SNS subscription remains `PendingConfirmation`. Email delivery
  was therefore not claimed or qualified.

## Production configuration

`infrastructure/terraform/environments/production` now contains a non-deploying
guardrail contract. Validation rejects unsafe production values for Multi-AZ,
backup retention, deletion protection, PITR, portal/worker HA, WAF, TLS, private
compute, customer-managed KMS, queue/DLQ encryption, Secrets Manager, monitoring,
alerts, and account separation. The directory explicitly creates no resources;
a deployable production root/module is still missing.

## Release integrity

- Existing CI builds immutable commit images, scans dependencies/secrets/images,
  generates SPDX SBOMs, and validates digest-only deployment inputs.
- The rollback drill proved promotion/rollback by the same digest without rebuild.
- Repository/account-backed artifact signing and signed provenance remain absent.

## ZDR and AWS final state

- The signed connector/parser smoke held synthetic PDF bytes in memory and cleared
  its buffer.
- Exact synthetic PDF content was absent from portal, connector, document-worker,
  sync-worker, and parser CloudWatch searches.
- Sync, sync DLQ, document-pull, and document-pull DLQ each reported zero visible,
  in-flight, and delayed messages.
- This is not the requested full authenticated extraction→approval→sync ZDR
  canary because the customer workflow stopped before job creation.
- Five ECS services were active at desired/running `1/1`; the final Terraform
  plan after secret rotation and signed-auth deployment reported `No changes`.

## Test evidence

- Portal/backend: **87 passed**.
- Connector: **41 passed** after the harness contract correction; production
  connector build passed.
- Prisma schema: valid with a non-connecting synthetic URL.
- Portal production build: passed; 17 production routes; no test/fixture/debug route.
- Connector production build: passed.
- Terraform dev fmt/validate: passed.
- Terraform production guardrail validate: passed.
- Negative production plan rejected unsafe Multi-AZ, one-day retention,
  single-instance portal, and disabled WAF values.

## Internal blockers

1. Authenticated document-pull job creation returns a redacted Prisma internal
   error in the deployed environment.
2. No live successful reviewer metadata-review, calculation, approval, or sync
   was possible after that failure.
3. Synthetic approved-income writes are intentionally disabled, so a successful
   test-provider sync and live outage/reconciliation drill cannot complete.
4. Full authenticated end-to-end ZDR evidence is consequently incomplete.
5. Production has guardrails but no deployable HA Terraform stack.
6. Artifact signing/signed provenance is not configured.

## External blockers

- Confirm the operations SNS email subscription and repeat delivery verification.
- ICE sandbox/client credentials, lender field configuration, and customer binding.
- Independent security/privacy review, named on-call owner, management RPO/RTO
  approval, and production AWS account/state approval.
