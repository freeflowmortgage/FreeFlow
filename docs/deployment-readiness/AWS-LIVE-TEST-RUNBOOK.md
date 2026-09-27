# AWS Synthetic Live-Test Runbook

## Scope and safety boundary

This runbook deploys the FreeFlow portal and income parser into the existing
`mortgage-dev-*` environment in `us-west-2`. It is a protected engineering
environment, not production approval.

- Synthetic documents and synthetic identities only.
- Encompass uses a synthetic connector in this environment. Real ICE and Stripe
  writes remain unavailable; production credentials are not installed.
- One task per service keeps the live-test cost low and is not high availability.
- The QA console and appraisal parser are not deployed in this slice.
- A connector-to-parser retention canary passed on 2026-09-26; the full
  authenticated extraction-to-sync retention canary remains required.

## Temporary PLTE boundary (updated 2026-09-07)

- Owner: FreeFlow Mortgage engineering.
- Reason: permit production-like portal, parser, API, database, networking, and
  logging tests before the environment is approved for real borrower data.
- Data boundary: synthetic data only; no borrower PII, tax documents, SSNs, bank
  statements, or production loan files.
- Compensating controls: the temporary HTTP ALB is restricted to approved
  workstation `/32` CIDRs and development identity bypass is explicit and
  limited to that endpoint. The remediated parser runs only in private subnets,
  has no ALB target/public IP, and accepts traffic only from the portal.
- Migrator boundary: private subnets only, one-off execution, no public route,
  and required exit-code/database verification before the portal test begins.
- Parser image requirement: pin by digest and require an ECR scan with no
  critical/high findings. The currently deployed digest satisfies this gate.
- Review/expiration: 2026-09-14, or immediately before any non-synthetic pilot,
  whichever occurs first.

## Implemented topology

`dev.freeflowmortgage.com` terminates TLS at the ALB. Its HTTPS listener
authenticates through a dedicated Cognito user pool and forwards to the portal
task on port 8000. The portal, parser, synthetic connector, document-pull
worker, and sync worker run without public IPs in the two application subnets.
The QA console is disabled. Private service discovery and security groups
constrain parser and connector traffic to their required callers.

When private-DNS ECR/Logs interface endpoints are enabled for the underwriting
console, their HTTPS security group must also admit the parser task security
group. Otherwise replacement parser tasks cannot obtain ECR authorization and
remain pending even though the previous task stays healthy.

The Cognito-enabled ALB is allowed outbound HTTPS only so it can complete the
hosted-domain authorization-code exchange. Its authentication session remains
one hour; longer sessions require an explicit security review and compensating
controls.

The existing private RDS instance is reached only through the application
security group. A one-off, read-only-root-filesystem migration task consumes the
RDS-managed administrative secret and creates restricted application and
migrator logins. Runtime tasks never receive the administrative secret.

## Preconditions

1. `aws sso login --profile freeflow-dev` succeeds and
   `aws sts get-caller-identity --profile freeflow-dev` identifies the
   intended development account.
2. The operator controls DNS for `freeflowmortgage.com` in Wix. Keep Wix
   authoritative; add the ACM validation and portal CNAME records output by
   Terraform before enabling the HTTPS edge.
3. Docker Desktop is running.
4. The release commit passes portal, database, and Terraform CI. The portal
   validation job must run the API/security regression suite and a production
   portal build from the same commit that is used to create the image.
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
   commit after its validation jobs are green. Push an immutable git-SHA tag to
   the Terraform output repositories. Resolve each ECR manifest digest and
   record the commit SHA and digest together in the deployment evidence.
4. Compute: set `enable_services = true` and provide all three image references
   as `repository@sha256:digest`. Terraform rejects mutable tags.

Keep the Fargate platform version explicit during an application rollout. A
platform-version upgrade requires its own reviewed plan and verification rather
than riding along with an image change.

When the private-DNS ECR and CloudWatch Logs interface endpoints are enabled
for the console, allow the portal application security group to reach those
same endpoints on HTTPS. Otherwise portal replacement tasks resolve the private
endpoint but cannot pull ECR authorization or emit logs.

For the current protected dev boundary, set `enable_edge = true`,
`enable_cognito_edge = true`, `enable_parser = true`, `enable_console = false`,
and enable the connector and workers only with the explicit synthetic/test
provider configuration. Every image input must be a reviewed digest. Keep
`portal_desired_count = 0` for the first database-changing apply, run and
verify the private migration, then set it to `1` and apply the reviewed service
plan.

Never apply an unsaved plan. Every plan must contain zero destroys unless an
approved teardown change explicitly names the resources being removed.

## Database migration and synthetic user

Run the private database-preflight task first. Proceed only if `mortgage_dev`
is absent or it exits `0` with `PREFLIGHT_TOTAL_ROWS=0`. Exit `42` means rows
exist and the rollout must stop for the full data-disposition approval.

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

Specify unique `SEED_USER_ID` values for additional users. `SEED_TENANT_ID`
chooses their organization; use the same tenant UUID to grant controlled access
to the same synthetic workspace. `SEED_ROLE` must be an application role such
as `UNDERWRITER` or `BROKER_OWNER`. The seed is idempotent. Do not put an email,
password, subject, or secret into Terraform variables or source control. Follow
the dedicated user-access runbook for the complete procedure.

## Verification

1. ECS reports one healthy task for the portal, private parser, connector,
   document-pull worker, and sync worker.
2. The target group reports the portal target healthy.
3. HTTP redirects to HTTPS; unauthenticated HTTPS redirects to Cognito.
4. The synthetic user completes login and reaches the portal.
5. Anonymous API calls fail; forged identity headers fail; the seeded identity
   resolves one active tenant membership.
6. A synthetic PDF traverses portal to parser, respects the 40 MiB limit, and
   leaves no PDF/raw XML in database, queues, task filesystems, or logs.
7. Billing remains fail-closed and the connector identifies itself as the
   synthetic dev provider unless an approved ICE sandbox binding is installed.

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
aws sso logout
```

GitHub OIDC and a scoped deployment role must replace root-authority local
deployment before this environment becomes a recurring team workflow.
