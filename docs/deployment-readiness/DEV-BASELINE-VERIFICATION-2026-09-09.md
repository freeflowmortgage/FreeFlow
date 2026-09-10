# Dev Baseline Verification — 2026-09-09

## Scope

Read-only verification of the synthetic FreeFlow AWS development environment in
`us-west-2`. This is operational evidence only; it does not approve production
use or authorize real borrower data.

## Verified state

- AWS account: `098767424191`.
- ECS cluster: `mortgage-dev-cluster`.
- `freeflow-dev-portal`: `ACTIVE`, desired/running/pending `1/1/0`, deployment
  revision `3`, rollout `COMPLETED`.
- Portal image:
  `098767424191.dkr.ecr.us-west-2.amazonaws.com/mortgage-api@sha256:6e59a381ce1b535737d0c2b6ec58d1d1b29bc9a7ff3cd285b128a6b03b2ccc1a`.
- The portal target at port `8000` is `healthy` in target group
  `freeflow-dev-portal`.
- `freeflow-dev-income-parser`: `ACTIVE`, desired/running/pending `1/1/0`,
  deployment revision `2`, rollout `COMPLETED`.
- Parser image (not changed by the portal rollout):
  `098767424191.dkr.ecr.us-west-2.amazonaws.com/mortgage-income-parser@sha256:ee64e6b2d4e73f5043bbd442ad4c41dfa530671e7f48070595d9766716958e36`.

## Release decision

The currently running portal does not contain uncommitted repository changes.
Before a portal change is considered installed, record all of the following in
a follow-up deployment evidence entry:

1. reviewed repository commit SHA;
2. green portal, database, and Terraform validation results;
3. new immutable ECR image digest built from that SHA;
4. reviewed Terraform plan that changes only the portal task definition/image;
5. ECS rollout and target-health result; and
6. authenticated synthetic smoke and negative-test results.

The parser image and service remain out of scope unless its owner explicitly
approves a parser release.
