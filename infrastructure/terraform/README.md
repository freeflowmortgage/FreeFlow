# FreeFlow Terraform

Terraform is the only planned source of truth for FreeFlow AWS infrastructure.
Console changes are limited to the one-time state bootstrap, break-glass incident
response, and an explicitly recorded import/reconciliation workflow. A console
change is never a substitute for a reviewed Terraform change.

## Environment boundary

| Environment | Purpose | AWS boundary | Current status |
| --- | --- | --- | --- |
| `dev` | Synthetic-data engineering and integration testing | Existing `mortgage-dev-*` account/VPC in `us-west-2` | Transitional Terraform live-test stack manages new resources around inventoried legacy resources |
| `staging` | Production-like qualification and drills | Separate non-production account/VPC | State foundation created 2026-09-09; platform stack not yet created |
| `production` | Customer workload | Dedicated production account/VPC | Not created |

`dev` must never receive production borrower data. Production does not inherit
the development Free Tier constraints: it requires multi-AZ compute and data,
durable backups/PITR, protected state, monitoring, and a paid operating budget.

## Layout

```text
infrastructure/terraform/
  bootstrap/                 # one-time protected Terraform state resources
  environments/              # checked-in, non-secret per-environment contracts
```

Infrastructure slices are added and qualified in this order:

1. account baseline and CI deployment identity (state foundation implemented;
   GitHub OIDC remains);
2. network (transitional dev routes and service security groups implemented;
   full VPC import/endpoints/flow logs remain);
3. data (dev runtime secrets and SQS/DLQ implemented; full RDS ownership and
   production backup posture remain);
4. edge (phased Route 53, ACM, ALB, and Cognito dev resources implemented; WAF
   and production HA remain);
5. compute (digest-gated portal, parser, and migration tasks implemented;
   qualification and worker/appraisal services remain);
6. observability (encrypted SNS topic, dashboard, and seven dev alarms deployed;
   subscription/drill and log-masking evidence remain) and delivery policy.

This order is intentional: no task definition, image, or service is production
ready until its network, identities, secrets, database, and alarms exist.

## One-time state bootstrap

`bootstrap/` creates an encrypted S3 state bucket and DynamoDB lock table. It
starts with local state because the remote state does not exist yet. Use an
approved administrative identity in the target AWS account; it must not be the
long-lived root user and its credentials must not be placed in this repository.

1. Copy `bootstrap/terraform.tfvars.example` to a local
   `bootstrap/terraform.tfvars` and choose a globally unique bucket name.
2. Run `terraform init -backend=false`, review the plan in the intended account,
   and apply it. This is the only permitted local-state bootstrap step.
3. Immediately run `terraform init -migrate-state` with an environment-specific
   S3 backend key such as `bootstrap/staging.tfstate`; confirm migration before
   deleting the local bootstrap state file.
4. Configure each platform backend from
   `environments/<environment>/backend.hcl.example`. Bootstrap and platform
   state keys must remain distinct.
5. Commit only backend examples and non-secret contracts. Never commit a state
   file, plan file, populated tfvars file, secret, account credential, or
   Cognito client secret.

The backend S3 bucket is intentionally distinct from application buckets. It
contains sensitive infrastructure metadata and is not an artifact store.

## Existing development environment

Do not run `terraform apply` against the manually created `mortgage-dev-*`
resources until an import inventory has been reviewed. The safe sequence is:

1. Inventory actual resource IDs, tags, routes, security-group rules, RDS
   configuration, ECR settings, and S3 settings.
2. Write Terraform that matches the approved desired configuration.
3. Import one resource at a time into the `dev` state.
4. Run `terraform plan` until it is either empty or contains explicitly approved
   corrective changes.
5. Apply only those approved changes and record the result in the deployment
   runbook.

For staging and production, prefer clean creation from Terraform rather than
imports. Production must use separate state, credentials, and account boundary.

## Domain and identity decisions

Approved hostname pattern:

| Environment | Portal | API | Cognito domain |
| --- | --- | --- | --- |
| production | `app.freeflowmortgage.com` | `api.freeflowmortgage.com` | `auth.freeflowmortgage.com` |
| development | `dev.freeflowmortgage.com` | `api-dev.freeflowmortgage.com` | AWS-hosted Cognito domain initially |

Each environment has its own Cognito user pool and app client. Cognito proves
identity; FreeFlow's application/database membership model continues to resolve
tenant and role authorization. ALB authenticates users with Cognito and the
portal verifies the resulting signed identity assertion server-side.

Wix remains authoritative for `freeflowmortgage.com`; do not change its
nameservers. Domain activation is deliberately two-phase: first set
`enable_https_certificate = true` while Cognito remains disabled, apply, and add
the output ACM validation CNAME in Wix. Once ACM issues the certificate, set
`enable_cognito_edge = true`, apply, and add the output portal CNAME in Wix.
See the [domain and user-access runbook](../../docs/deployment-readiness/DOMAIN-COGNITO-USER-ACCESS-RUNBOOK.md).

## Required inputs before an environment apply

- AWS account ID and owner for each environment;
- Route 53 hosted-zone ownership for `mb-ai.com`;
- approved regions and disaster-recovery decision;
- alert destination and on-call ownership;
- RPO/RTO, backup retention, and retention/legal requirements;
- permitted external egress requirements for Encompass and Stripe;
- image digests and migration compatibility for the release.

See [`docs/deployment-readiness/AWS-ECS-DEPLOYMENT-SPEC.md`](../../docs/deployment-readiness/AWS-ECS-DEPLOYMENT-SPEC.md)
and [`docs/deployment-readiness/RUNBOOKS.md`](../../docs/deployment-readiness/RUNBOOKS.md)
for the production acceptance criteria.
