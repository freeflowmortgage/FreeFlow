# FreeFlow Encompass Hosted Customer Test Package

This package is for synthetic customer testing of FreeFlow hosted mode. It is
not evidence of qualification against a live ICE/Encompass tenant.

## Customer configuration

- FreeFlow Custom Tool URL: `https://dev.freeflowmortgage.com/`
- FreeFlow tenant integration mode: `ENCOMPASS_HOSTED`
- Approved frame origin for this dev test: `https://dev.freeflowmortgage.com`
- Encompass Loan scripting permissions: read the active loan identifier and
  read-only state; read and set the listed custom fields; calculate the loan;
  commit the loan; and read back `CX.FREEFLOW.APPROVAL.ID`.
- The tool must be launched with an active synthetic loan. The user must have
  write permission when testing write-back.

Hosted mode does not require a FreeFlow ICE Developer Connect license or
customer Developer Connect credentials. Developer Connect remains an optional
fallback integration and is not required by this test path.

## Required custom fields

Create these fields in Encompass under the indicated formats. Decimal fields
use two decimal places.

| Field | Format | Maximum length |
| --- | --- | ---: |
| `CX.FREEFLOW.INCOME` | Decimal | 20 |
| `CX.FREEFLOW.W2.BASE` | Decimal | 20 |
| `CX.FREEFLOW.W2.VARIABLE` | Decimal | 20 |
| `CX.FREEFLOW.SCH.C` | Decimal | 20 |
| `CX.FREEFLOW.FORM.1120S` | Decimal | 20 |
| `CX.FREEFLOW.FORM.1065` | Decimal | 20 |
| `CX.FREEFLOW.FORM.1120` | Decimal | 20 |
| `CX.FREEFLOW.SCH.F` | Decimal | 20 |
| `CX.FREEFLOW.ASSET.INCOME` | Decimal | 20 |
| `CX.FREEFLOW.RENTAL` | Decimal | 20 |
| `CX.FREEFLOW.RENTAL.LIABILITY` | Decimal | 20 |
| `CX.FREEFLOW.HOUSING.ADJ` | Decimal | 20 |
| `CX.FREEFLOW.TRENDING` | String | 64 |
| `CX.FREEFLOW.YEARS` | String | 32 |
| `CX.FREEFLOW.PROGRAM` | String | 32 |
| `CX.FREEFLOW.AUDIT.URL` | String | 255 |
| `CX.FREEFLOW.SYNCED.AT` | Date | 32 |
| `CX.FREEFLOW.APPROVAL.ID` | String | 36 |
| `CX.FREEFLOW.SOURCE` | String | 16 |

## Synthetic test procedure

1. Sign in through the FreeFlow Cognito prompt and launch the Custom Tool on a
   synthetic active Encompass loan.
2. Confirm the displayed active-loan context, then bind the host loan. Repeat
   the launch and confirm that the same FreeFlow loan identifier is returned.
3. Upload only a repository-approved synthetic income PDF. Review extracted
   evidence and satisfy any required metadata review.
4. Calculate income, review the result, and approve it.
5. Request write-back. Confirm that the tool revalidates the active loan and
   write permission, writes only `CX.FREEFLOW.*`, calculates, commits, and
   verifies the approval marker.
6. Repeat from a fresh authenticated session. Also verify read-only rejection,
   active-loan-change rejection, stale-approval rejection, duplicate-request
   replay, and cross-tenant denial.

Expected results are a single tenant-scoped host binding, an approval-derived
field map, one durable write authorization/result per idempotency key, and no
borrower identity created merely by host launch. Raw PDF, OCR text, XML, and
provider payloads must not appear in database, logs, queues, or task storage.

## Disable and rollback

- Disable hosted access by changing the tenant integration mode away from
  `ENCOMPASS_HOSTED`; do not delete or rewrite audit records.
- Disable console framing by removing the approved frame origin and applying a
  reviewed Terraform plan.
- For an application regression, restore the prior portal and console image
  digests through a reviewed saved Terraform plan. Database migrations are
  forward-only; use a corrective migration rather than rolling one back.
- ECS deployment circuit breakers remain enabled for automatic failed-rollout
  rollback.
