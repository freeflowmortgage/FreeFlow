# Dev Parser and Console Rollout — 2026-09-14

## Scope

This record covers deployment of the accepted multi-document wage-review and
OCR-performance iteration to the existing synthetic AWS development environment.
It is not a production approval and does not authorize real borrower data.

- AWS account: `098767424191`
- Region: `us-west-2`
- ECS cluster: `mortgage-dev-cluster`
- Company source commit: `8033b6b`
- Company PR: `freeflowmortgage/FreeFlow#16`
- Partner PR: `nwjenson/Freeflow#27`
- The two PR heads had identical Git trees at deployment time.

No portal application image, database migration, secret, network, queue, or
monitoring resource was changed in this rollout.

## Images and vulnerability gate

Both runtime images were built from a clean Git worktree as Linux/AMD64,
single-manifest images. ECR tag immutability and scan-on-push were enabled.
Direct ECR scans completed successfully with no reported findings.

| Service | Immutable image digest | ECS revision |
| --- | --- | --- |
| Income parser | `098767424191.dkr.ecr.us-west-2.amazonaws.com/mortgage-income-parser@sha256:5be2821749cd3216df4ac9fea1da5c85d0259155cdd4de6181682eb39123051e` | `freeflow-dev-income-parser:6` |
| Underwriting console | `098767424191.dkr.ecr.us-west-2.amazonaws.com/mortgage-underwriting-console@sha256:4a384d6fa2406981cf8de74b1f4429dca508377c984d9442d924d4c5b6a2d323` | `freeflow-dev-underwriting-console:8` |

Tags `236e056` and final PR commit tag `8033b6b` resolve to the same respective
digests. ECS is pinned to the digests, not the tags.

## Terraform safety review

The first full plan was rejected because pre-existing state drift would also
have changed the portal and migration task definitions, reduced the ALB idle
timeout, and recreated an alert subscription. No broad plan was applied.

Terraform was updated to preserve the deployed 180-second ALB idle timeout,
pin the parser Fargate platform to `1.4.0`, and set
`DOC_PARSER_TIMEOUT_MS=300000` on the AWS console task. A saved targeted plan
was machine-checked before apply. Its only four changed addresses were:

- `aws_ecs_task_definition.parser[0]`
- `aws_ecs_service.parser[0]`
- `aws_ecs_task_definition.console[0]`
- `aws_ecs_service.console[0]`

Task-definition replacements created new immutable revisions; the two ECS
services were updated in place under deployment circuit breakers.

## Verification evidence

- Parser and console deployments reached `COMPLETED` with desired `1`, running
  `1`, pending `0`, and failed tasks `0`.
- Both running task containers reported `HEALTHY` and their runtime
  `imageDigest` values matched the ECR digests above.
- The console task definition contains `DOC_PARSER_TIMEOUT_MS=300000` and uses
  private service discovery at `income-parser.freeflow.local:8080`.
- The new console ALB target was healthy.
- Public dev health returned HTTP `200` with engine `python-ocr`.
- A repository-generated synthetic two-page income packet traversed the public
  console and private parser in `0.379` seconds. Both pages were retained, eight
  income fields were returned, and no parser fallback flag was present.
- CloudWatch log searches covering the rollout and smoke test found no parser or
  console error, exception, traceback, or timeout events.
- Company and partner PR Terraform and portal-validation checks passed.
- A post-apply targeted Terraform plan reported `No changes` for both task
  definitions and both services. Linux provider package checksums are retained
  in the lockfile so this containerized verification remains reproducible.

The supplied real-world W-2, paystub, and tax samples were qualified locally
only. They were not uploaded to AWS because this development environment is
restricted to synthetic data.

## Remaining production boundary

This closes the stale-dev-image and synchronous-timeout regressions for the
tested AWS path. It does not close production requirements for asynchronous job
processing, concurrency/load qualification, production authentication hardening,
full observability, HA/restore evidence, or approval to process borrower PII.
