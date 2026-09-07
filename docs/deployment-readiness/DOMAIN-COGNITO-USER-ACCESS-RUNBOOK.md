# Domain, Cognito, and User Access Runbook

## Purpose

This runbook replaces the IP-restricted HTTP PLTE endpoint with
`https://dev.mb-ai.com`, Cognito MFA, and explicit application/database
memberships. It does not authorize real borrower data.

## Required operator decisions

Before applying either phase, record:

- confirmation that FreeFlow controls `mb-ai.com` at its registrar and can
  change nameservers;
- the approved operations-alert email address;
- each tester's email, application role, tenant, and access owner.

Do not infer ownership from parked Afternic nameservers. Do not create users or
send invitations until the intended recipients are approved.

## Phase 1: delegate DNS

1. In the ignored development `terraform.tfvars`, set:

   ```hcl
   domain_name           = "mb-ai.com"
   portal_hostname       = "dev.mb-ai.com"
   create_hosted_zone    = true
   enable_cognito_edge   = false
   operations_alert_email = "approved-operations-address@example.com"
   ```

2. Create and review a saved Terraform plan. It must create the Route 53 public
   hosted zone and email subscription without replacing live compute.
3. Apply the saved plan. Copy `public_hosted_zone_name_servers` from Terraform
   output.
4. At the domain registrar, replace the current authoritative nameservers with
   all four Route 53 nameservers exactly as output.
5. Confirm the SNS subscription from the approved mailbox.
6. Wait until public `NS mb-ai.com` queries return the Route 53 nameservers from
   multiple resolvers. DNS propagation can take hours; do not enable phase 2
   merely because the registrar UI says the change was saved.

## Phase 2: HTTPS and Cognito

1. Keep `create_hosted_zone = true` and set `enable_cognito_edge = true`.
2. Review the saved plan. Expected changes include ACM validation records and
   certificate, the Cognito pool/client/domain, authenticated ALB security
   group/listeners, portal DNS alias, and a new portal task definition with
   identity bypass disabled. Investigate any unexpected destroy.
3. Apply and wait for the ECS deployment and ACM certificate to become healthy.
4. Verify HTTP redirects to HTTPS, anonymous HTTPS redirects to Cognito, and
   direct requests with forged identity headers are denied.

The user pool requires administrator-created users and MFA. Cognito authenticates
the human; FreeFlow's database remains authoritative for tenant and role access.

## Add a controlled tester

1. Create the Cognito user without a password in source control:

   ```powershell
   $poolId = terraform output -raw cognito_user_pool_id
   aws cognito-idp admin-create-user `
     --user-pool-id $poolId `
     --username tester@example.com `
     --user-attributes Name=email,Value=tester@example.com Name=email_verified,Value=true `
     --desired-delivery-mediums EMAIL `
     --profile freeflow-dev-deploy `
     --region us-west-2
   ```

2. Retrieve the immutable Cognito `sub` with `admin-get-user`; never use email
   as the authorization identity.
3. Generate a unique user UUID. Choose the approved tenant UUID and the
   least-privileged role. Run the private migration task definition once with
   container environment overrides for:

   ```text
   SEED_OIDC_SUBJECT=<Cognito sub>
   SEED_EMAIL=<tester email>
   SEED_TENANT_ID=<approved tenant UUID>
   SEED_USER_ID=<new user UUID>
   SEED_FIRST_NAME=<first name>
   SEED_LAST_NAME=<last name>
   SEED_ROLE=<least-privileged role>
   ```

4. Wait for the task to stop; require exit code `0` and the successful seed log
   marker. A Cognito user without an active database membership must still be
   denied application access.
5. Have the tester use the emailed temporary-password flow, enroll MFA, log in,
   and validate only the intended synthetic tenant and permissions.

Passwords and MFA factors belong only in Cognito. Never pass them through ECS
overrides, Terraform variables, logs, tickets, or Git.

## Remove or suspend access

For an immediate suspension, disable the Cognito user and deactivate the
database membership. Verify a subsequent request is denied. Deleting a Cognito
user alone does not replace preserving the application audit trail. Record the
requester, operator, time, tenant, role removed, and validation evidence.

## Acceptance checklist

- `https://dev.mb-ai.com` presents a valid certificate.
- Port 80 redirects and the old unrestricted path is absent.
- Anonymous, forged, expired, wrong-audience, and disabled-user cases deny.
- Every tester has MFA and exactly one approved active membership.
- Cross-tenant negative tests pass.
- All seven operational alarms are `OK`, the SNS subscription is confirmed,
  and a controlled alarm notification has been received.
- Synthetic data is the only data used in the PLTE.
