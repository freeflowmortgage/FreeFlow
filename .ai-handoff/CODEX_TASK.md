# Codex Engineering Task

## Objective

Deploy the **custom Encompass connector as a separate freeflow-dev ECS foundation** with private networking, dedicated DB identity inheriting `freeflow_worker`, durable binding DB access, health, and CloudWatch logs — still disconnected from any LOS and with **no PDF flow**.

## Authoritative Repository

freeflowmortgage/FreeFlow

## Base SHA

`d4dae8db75530620ab8c5210dd9ddb1ac2eb2e1d` (current org `main`)

## Relevant Files / Components

- `services/encompass-connector/` (Dockerfile, boot, health, PrismaBindingStore)
- `packages/database/prisma/` (bindings + RLS; freeflow_worker grants)
- `infrastructure/terraform/environments/dev/` (ECS/ALB/SG/Secrets patterns used by portal)
- Existing freeflow-dev ECS/ECR/Secrets conventions from portal/migrator rolls

## Current Behavior

- Connector package + durable binding exist on main; **no** freeflow-dev ECS service, service discovery, or connector DB login.
- Portal is live; document-pull worker OFF; DC OFF; list/download still `CONNECTOR_NOT_IMPLEMENTED`.
- Production boot refuses Bearer stub; non-prod may use stub only for local/dev.

## Required Behavior

1. freeflow-dev **ECS service/task** for `services/encompass-connector` (separate from portal).
2. **Private networking** + service discovery (or internal-only reachability) — not public internet LOS.
3. Dedicated runtime DB login that **inherits `freeflow_worker`** (SELECT bindings via RLS; no BYPASSRLS; no binding mutation).
4. Runtime can read durable bindings (`encompass_connector_bindings`).
5. **`GET /health`** live and monitored.
6. **CloudWatch** logs for the task.
7. Safe config/secrets **placeholders** (no real LOS secrets; no real borrower NPI).
8. Remains **disconnected from real LOS**; **no PDF** retrieval/persist in this slice.
9. `NODE_ENV=production` must not boot with Bearer stub (already enforced — do not regress).

## Constraints

- Follow repo root `AGENTS.md`.
- Stay in this slice only.
- Do not weaken authz/tenant isolation/security.
- No real borrower NPI; no secrets in git.
- Smallest safe change; no unrelated refactors.
- No Developer Connect enablement; no document-pull worker enable.
- No mTLS/signing/replay **implementation** beyond keeping prod Bearer refuse (full S2S authenticity is a later slice).
- No merge/deploy to production; freeflow-dev only when Ben authorizes apply.
- Do not implement synthetic LOS or PDF E2E in this packet.

## Security Requirements

- Connector DB role = freeflow_worker capabilities only (least privilege).
- No LOS credentials in task env or images.
- Binding table remains identity-only; FORCE RLS respected.
- Internal-only exposure preferred; no public LOS client.

## Acceptance Criteria

- [ ] Terraform (or existing IaC pattern) defines freeflow-dev connector ECS service/task + private net/discovery.
- [ ] Image builds from `services/encompass-connector` Dockerfile; task runs healthy (`/health`).
- [ ] Dedicated Secrets Manager / IAM path for connector DB URL using freeflow_worker-capable login.
- [ ] Task can resolve a synthetic binding row under RLS (smoke/read-only check) OR documents exact deferred smoke if apply gated.
- [ ] CloudWatch log group receives task logs.
- [ ] No LOS endpoints, no PDF download path wired.
- [ ] Prod Bearer-stub refuse still holds.
- [ ] CI for touched IaC/workflows green (or documented plan if apply is Ben-gated).

## Tests Required

- Unit/package tests unchanged green if code touched.
- Plan: `terraform plan` freeflow-dev only (no silent apply).
- After Ben-authorized apply: health check + optional binding read smoke under worker role.
- Do not run full PLTE matrix in this slice.

## Out of Scope

- Synthetic Encompass/LOS stub
- PDF pull / parser / FreeFlow persist
- Replay protection / mTLS / signed requests (next slices)
- Portal document-pull wiring
- Partner #33/#34
- Production account changes

## Expected Deliverable

PR from Base SHA with IaC + any minimal wiring; `terraform plan` evidence; package tests if needed; AGENTS.md report. **Do not apply/deploy ECS without Ben authorization in the PR or a follow-up ask.** Do not merge unless CI green and Ben says merge.
