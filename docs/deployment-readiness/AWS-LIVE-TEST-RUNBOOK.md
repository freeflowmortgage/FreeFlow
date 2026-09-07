# AWS Synthetic Live-Test Runbook

## Scope and safety boundary

This runbook deploys the FreeFlow portal and income parser into the existing
`mortgage-dev-*` environment in `us-west-2`. It is a protected engineering
environment, not production approval.

- Synthetic documents and synthetic identities only.
- Encompass writes and Stripe processing remain unavailable in protected
  runtimes; their credentials are not installed.
- One task per service keeps the live-test cost low and is not high availability.
- The console and appraisal parser are not deployed in this slice.
- Raw document and OCR retention canaries are still required before production.

## Implemented topology

`dev.mb-ai.com` terminates TLS at an internet-facing ALB. The HTTPS listener
authenticates through a dedicated Cognito user pool and forwards only to the
portal task on port 8000. The portal and parser run without public IP addresses
in the two existing application subnets. The parser accepts port 8080 only from
the portal security group and registers as `income-parser.freeflow.local`.

The existing private RDS instance is reached only through the application
security group. A one-off, read-only-root-filesystem migration task consumes the
RDS-managed administrative secret and creates restricted application and
migrator logins. Runtime tasks never receive the administrative secret.

## Preconditions

1. `aws login --profile freeflow-dev-deploy` succeeds and
   `aws sts get-caller-identity --profile freeflow-dev-deploy` identifies the
   intended development account.
2. The operator controls DNS for `mb-ai.com`. If Route 53 is authoritative, set
   `hosted_zone_id`; otherwise delegate the development subdomain to a Route 53
   hosted zone before enabling the edge.
3. Docker Desktop is running.
4. The release commit passes portal, database, and Terraform CI.
5. No real borrower document or external production credential is present.

## Terraform phases

The checked-in example contains no credentials. Populate an ignored
`terraform.tfvars` locally.

1. Foundation: keep `enable_edge = false` and `enable_services = false`. Review
   and apply the plan. This creates private routes, service discovery, task
   roles, queues, secrets, logs, and ECR repositories.
2. Edge: set the Route 53 zone ID and `enable_edge = true`. Review and apply.
   Wait for ACM validation, Cognito, the HTTPS listener, and the DNS alias.
3. Images: build the portal, parser, and migration images from one reviewed
   commit. Push an immutable git-SHA tag to the Terraform output repositories.
   Resolve each ECR manifest digest.
4. Compute: set `enable_services = true` and provide all three image references
   as `repository@sha256:digest`. Terraform rejects mutable tags.

Never apply an unsaved plan. Every plan must contain zero destroys unless an
approved teardown change explicitly names the resources being removed.

## Database migration and synthetic user

Run the Terraform-output migration task definition in the application subnets
with the application security group. Wait for `STOPPED` and require exit code 0.
The task creates `mortgage_dev`, capability/login roles, and applies every
ordered migration.

Create the initial Cognito user with `admin-create-user`, set a permanent
password through the supported Cognito flow, and record the returned `sub`.
Run the migration task again with container overrides for:

```text
SEED_OIDC_SUBJECT=<Cognito sub>
SEED_EMAIL=<synthetic test user email>
```

The seed uses fixed synthetic tenant/user UUIDs and is idempotent. Do not put an
email, password, subject, or secret into Terraform variables or source control.

## Verification

1. ECS reports one healthy portal task and one healthy parser task.
2. The target group reports the portal target healthy.
3. HTTP redirects to HTTPS; unauthenticated HTTPS redirects to Cognito.
4. The synthetic user completes login and reaches the portal.
5. Anonymous API calls fail; forged identity headers fail; the seeded identity
   resolves one active tenant membership.
6. A synthetic PDF traverses portal to parser, respects the 40 MiB limit, and
   leaves no PDF/raw XML in database, queues, task filesystems, or logs.
7. Billing and Encompass endpoints return their documented protected-runtime
   `503` responses.

## Pause and cost control

For an overnight pause, set both ECS service desired counts to zero through a
reviewed Terraform variable/change. Do not destroy RDS, state, secrets, or the
hosted zone as a routine pause. ALB, NAT gateway, RDS, hosted zone, KMS, and
Secrets Manager continue to accrue cost while provisioned. Configure an AWS
Budget and billing alert before leaving the environment running unattended.

## Rollback

ECS deployment circuit breakers automatically roll back failed services. For an
application regression, restore the previous known-good image digests in
Terraform and apply a reviewed saved plan. Do not roll back an applied database
migration; deploy a forward-compatible corrective migration. Capture ECS events,
stopped-task reasons, target health, and the relevant CloudWatch log streams.

## End temporary local AWS access

After deployment work finishes:

```powershell
aws logout --profile freeflow-dev-deploy
```

GitHub OIDC and a scoped deployment role must replace root-authority local
deployment before this environment becomes a recurring team workflow.
