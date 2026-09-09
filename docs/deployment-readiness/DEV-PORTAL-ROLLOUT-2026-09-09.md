# Dev Portal Rollout Evidence — 2026-09-09

## Scope

Synthetic-dev rollout of the portal security and release-validation changes.
The income parser, database, and mortgage-calculation code were out of scope.

## Repository and artifact

- Release branch: `feat/aws-production-access`.
- Infrastructure/release commit: `9d131ec`.
- Portal security commit: `5ba364d`.
- Portal image:
  `098767424191.dkr.ecr.us-west-2.amazonaws.com/mortgage-api@sha256:50b9f99a7f5b83afc6efd6c6f13918a7704ad49064ca495592464dd1544e98a2`.
- Portal API/security tests: 24 passed.
- Portal production Docker build: passed from an isolated clean worktree.
- Console TypeScript check and production Vite build: passed.

## Reviewed Terraform scope

The saved dev plan contained only:

1. a replacement portal task definition using the immutable image digest;
2. an in-place portal-service update to that task definition; and
3. a description-only normalization of the existing Cognito HTTPS egress rule.

The portal Fargate platform was explicitly pinned to the verified `1.4.0` value
before planning so no platform upgrade could ride along with the application
rollout.

## Current result: incomplete — do not mark deployed

Terraform applied the reviewed plan and ECS registered portal task-definition
revision `5`. The replacement task received a private ENI and has network
connectivity, but remains `PENDING` before container start/image pull, with no
container reason or stop reason. The previous portal task-definition revision
`3` remains `RUNNING` and `HEALTHY`; the portal target remains healthy.

The income-parser service remains on revision `2` and was not modified.

Do not treat this entry as a successful deployment or production-readiness
closure. Continue with ECS/Fargate provisioning diagnosis, then record a new
healthy-task, target-health, authenticated synthetic smoke, and negative-test
result before accepting the rollout.
