# Staging Foundation Evidence — 2026-09-09

## Scope

FreeFlow staging is a separate AWS Organizations member account (`977323999161`)
in `us-west-2`. It is reserved for production-like qualification with synthetic
data only. It is not production and must never receive borrower data or
production credentials.

## Access boundary

- AWS IAM Identity Center is enabled for the organization and replicated to
  `us-west-2`.
- Operator access uses the MFA-backed `AdministratorAccess` SSO assignment
  during bootstrap. No root credentials or long-lived IAM access keys are used
  for deployment.
- The staging CLI session was verified as
  `arn:aws:sts::977323999161:assumed-role/AWSReservedSSO_AdministratorAccess_*`.

## Terraform state foundation

Applied from the staging account on 2026-09-09:

| Resource | Name/control |
| --- | --- |
| S3 state bucket | `freeflow-staging-977323999161-tf-state-usw2`; versioning, KMS encryption, bucket-owner enforcement, all public access blocked, insecure transport denied |
| KMS key | `alias/freeflow-staging-terraform-state`; rotation enabled, 30-day deletion window |
| State lock | `freeflow-staging-terraform-lock`; pay-per-request, KMS encryption, point-in-time recovery |
| Remote state key | `bootstrap/staging.tfstate` |

Terraform reported `9 added, 0 changed, 0 destroyed`. The resulting state was
migrated from the one-time local bootstrap file into the encrypted S3 backend
and listed all nine managed resources afterward.

## Remaining staging gate

The account and state boundary are ready. The greenfield platform stack—VPC,
private compute/data, secrets, CI federation, ECR, edge/DNS, monitoring, and
qualification deployment—remains to be implemented and reviewed before a
staging application deployment.
