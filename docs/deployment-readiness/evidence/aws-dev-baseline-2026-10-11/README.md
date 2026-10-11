# AWS Dev Baseline Capture — 2026-10-11

## Purpose

This is a read-only baseline for comparing a candidate deployment with the
current `app.dev.freeflowmortgage.com` application. It is not evidence that
the current deployment implements the current certification candidate.

## Capture boundary

- Target: `https://app.dev.freeflowmortgage.com`
- Capture time (UTC): `2026-10-11T21:49:14.7786274Z`
- Scope: public application shell, static-asset fingerprints, and one
  authenticated UI readiness check.
- Exclusions: no AWS configuration changes, no loan writes, no document
  upload, no export, and no interaction with an existing loan.

## Public application shell

| Observation | Captured value |
| --- | --- |
| Root response | HTTP 200 |
| HTML title | `FreeFlow Mortgage Solutions` |
| JavaScript asset | `/assets/index-DsxRtZ_W.js` |
| JavaScript bytes | 1,111,701 |
| JavaScript SHA-256 | `46b0e06a77bbfd49ec6233e59354920d830184b220c38a69237e1ee1b44c1c8e` |
| CSS asset | `/assets/index-RsqwojQn.css` |
| CSS bytes | 55,301 |
| CSS SHA-256 | `6e2e587093716bacde4a800d12dbf0a0c1c36d3f33b667873f8033fa9bb1beff` |

The public shell correctly redirected protected API requests to Cognito before
authentication. This capture does not retain tokens, headers, cookies, or
identity information.

## Authenticated UI readiness check

An authorized user completed the Cognito password and MFA steps in the
temporary Playwright browser profile. The application subsequently loaded
`/workspace?product=split`.

The candidate's sanctioned standalone lifecycle test stopped before any
business operation because the deployed UI did not contain the required
`data-testid="standalone-loan-intake"` control after 120 seconds. The deployed
surface showed the protected Income ZDR review workflow with an already bound
loan context instead.

Consequences:

- No synthetic loan was created.
- No document was uploaded.
- No calculation, approval, export, or writeback ran.
- No existing loan was changed.
- The tenant-isolation follow-up test was skipped because its prerequisite
  synthetic loan did not exist.

## Candidate comparison anchors

The candidate under evaluation was commit
`dee93ac76f4e898bbc2e160bf509cf91fd12cad4`.

Its locally built protected-web assets were different from the AWS baseline:

| Asset | Candidate fingerprint | AWS baseline fingerprint |
| --- | --- | --- |
| JavaScript | `/assets/index-C9KZWspo.js` — 1,117,109 bytes — `086d32037b1c3a83061373adf91635ae0373217e8ff19bccb77010d206c7e4cf` | `/assets/index-DsxRtZ_W.js` — 1,111,701 bytes — `46b0e06a77bbfd49ec6233e59354920d830184b220c38a69237e1ee1b44c1c8e` |
| CSS | `/assets/index-Cv9YHxu7.css` — 55,409 bytes — `b1aa04d13af62c51765defe8c4c29a53c9de6254ca9e6931519ba8c5cfb63c72` | `/assets/index-RsqwojQn.css` — 55,301 bytes — `6e2e587093716bacde4a800d12dbf0a0c1c36d3f33b667873f8033fa9bb1beff` |

Different static assets are evidence of a different build, not by themselves
proof of a functional regression. The authenticated missing-intake result is
the relevant functional incompatibility for the candidate's standalone test.

## Required comparison after candidate deployment

Deploy the immutable candidate commit to a separate synthetic-only dev or
blue/green target, then run the same authorized lifecycle against this
baseline and the candidate. Compare:

1. Independently calculated monthly and annual qualifying income.
2. Borrower associations and approved calculation snapshot fields.
3. Normalized JSON, declared-schema MISMO XML, and underwriting summary.
4. Duplicate-document, retry, and idempotency behavior.
5. Authentication, authorization, and cross-tenant denial behavior.

Retain only hashes, structured result summaries, and sanitized exports. Do not
place authentication artifacts or raw mortgage documents in this repository.
