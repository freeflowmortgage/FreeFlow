# Domain, Cognito, and User Access Runbook

## Purpose

This runbook replaces the IP-restricted HTTP PLTE endpoint with
`https://dev.freeflowmortgage.com`, Cognito MFA, and explicit application/database
memberships. It does not authorize real borrower data.

## Required operator decisions

Before applying either phase, record:

- confirmation that FreeFlow controls `freeflowmortgage.com` in Wix and can add
  DNS records;
- the approved operations-alert email address;
- each tester's email, application role, tenant, and access owner.

Do not change Wix nameservers or migrate the existing marketing site. Do not create users or
send invitations until the intended recipients are approved.

## Phase 1: validate the certificate in Wix

1. In the ignored development `terraform.tfvars`, set:

   ```hcl
   domain_name               = "freeflowmortgage.com"
   portal_hostname           = "dev.freeflowmortgage.com"
   dns_managed_externally    = true
   enable_https_certificate  = true
   create_hosted_zone        = false
   enable_cognito_edge   = false
   operations_alert_email = "approved-operations-address@example.com"
   ```

2. Create and review a saved Terraform plan. It must create only the ACM
   certificate and make no live listener, compute, database, or DNS changes.
3. Apply the saved plan. Copy `external_acm_validation_records` from Terraform
   output.
4. In Wix DNS, add each output CNAME exactly. Do not change Wix nameservers.
5. Confirm the SNS subscription from the approved mailbox.
6. Wait for ACM to report the certificate `ISSUED`. DNS propagation can take
   hours; do not enable phase 2 merely because Wix shows the record as saved.

## Phase 2: HTTPS and Cognito

1. Keep `enable_https_certificate = true`,
   `dns_managed_externally = true`, and set `enable_cognito_edge = true`.
2. Review the saved plan. Expected changes include ACM validation records and
   certificate, the Cognito pool/client/domain, authenticated ALB security
   group/listeners, and a new portal task definition with
   identity bypass disabled. Investigate any unexpected destroy.
3. Apply and copy `external_portal_dns_record` from Terraform output. Add that
   CNAME in Wix, then wait for it to resolve publicly.
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

   Configure an approved tenant integration mode in a separate private task
   invocation using only `SEED_TENANT_ID` and
   `SEED_ENCOMPASS_INTEGRATION_MODE`. The supported mode-only path does not
   reseed or modify the tester.

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
