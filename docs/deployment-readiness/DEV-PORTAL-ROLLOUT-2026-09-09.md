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

## Initial result: incomplete

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

## Remediation and verified availability

The stopped replacement task reported an ECR authorization timeout. The console
had created private-DNS ECR and CloudWatch Logs interface endpoints whose
security group admitted only the console. Portal tasks resolved those endpoints
but were denied their HTTPS path.

Commits `c6567d7` and `5de301b` retain the existing endpoint security group
and attachments, then add the portal application security group to its existing
HTTPS ingress rule. The reviewed remediation plan was one in-place security
group update with no resource replacement.

After the remediation:

- ECS started portal task-definition revision `5`.
- The new portal container is `RUNNING` and `HEALTHY` on image digest
  `sha256:50b9f99a7f5b83afc6efd6c6f13918a7704ad49064ca495592464dd1544e98a2`.
- The new target is healthy; the old portal target is draining normally.
- A header-only unauthenticated request to `https://dev.freeflowmortgage.com/`
  returned an ALB `302` to the configured Cognito hosted domain, not portal
  content.
- The income-parser remains on revision `2` and was not modified.

ECS subsequently reached `COMPLETED` steady state on portal revision `5`. The
deployment is verified healthy at the infrastructure and unauthenticated-edge
layers. Authenticated synthetic smoke and protected-route negative-test
evidence remain required before it can be counted as a fully verified dev
rollout.
