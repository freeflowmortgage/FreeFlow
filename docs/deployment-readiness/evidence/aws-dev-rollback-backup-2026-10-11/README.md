# AWS Dev Rollback Backup — 2026-10-11

## Scope

This manifest records the known-good, currently deployed AWS development
release before any candidate repository changes are pushed or deployed. It is
an operational rollback record, not a copy of customer or application data.

- AWS account: `098767424191`
- Region: `us-west-2`
- ECS cluster: `mortgage-dev-cluster`
- Capture date: `2026-10-11`
- Application baseline: `https://app.dev.freeflowmortgage.com`

## Database recovery point

| Field | Value |
| --- | --- |
| Source instance | `mortgage-dev-postgres` |
| Manual snapshot | `freeflow-dev-pre-candidate-20261011` |
| Status at capture | `available` |
| Engine | PostgreSQL |
| Allocated storage | 20 GiB |
| Encrypted | Yes |
| Snapshot created (UTC) | `2026-10-11T22:07:46.536000+00:00` |

This is a manual, encrypted RDS snapshot. Do not delete it until the candidate
release has passed its agreed acceptance period. Restoring it creates a new
database instance; it does not modify the current instance in place.

## Deployed ECS rollback point

All images below are referenced by immutable ECR digest. The task-definition
revisions remain directly usable for an emergency service rollback.

| Service | Task definition | Image |
| --- | --- | --- |
| Document-pull worker | `freeflow-dev-document-pull-worker:15` | `mortgage-api@sha256:8062f30ee1944e80fb2d053563699f0fd0fd1fa6b21feeda2909d600f79f3661` |
| Encompass sync worker | `freeflow-dev-encompass-sync-worker:10` | `mortgage-api@sha256:8062f30ee1944e80fb2d053563699f0fd0fd1fa6b21feeda2909d600f79f3661` |
| Portal | `freeflow-dev-portal:39` | `mortgage-api@sha256:8062f30ee1944e80fb2d053563699f0fd0fd1fa6b21feeda2909d600f79f3661` |
| Underwriting console | `freeflow-dev-underwriting-console:41` | `mortgage-underwriting-console@sha256:a59f6d82aea631fbddbce06932158d915c21548636b045d3668a5cb90bc0c2f8` |
| Income parser | `freeflow-dev-income-parser:18` | `mortgage-income-parser@sha256:3373f040f817894ab06e59d0b48e27e1d67582f5e7fe935889b4fcdca52eab7f` |
| Encompass connector | `freeflow-dev-encompass-connector:20` | `mortgage-encompass-connector@sha256:ab0d2586f6f4882b2998ce70d4eb94952cf386f757aafb9afa0560cacf6d8861` |

ECR retention anchors at capture:

| Repository | Digest | Existing immutable commit tag(s) |
| --- | --- | --- |
| `mortgage-api` | `8062f30ee1944e80fb2d053563699f0fd0fd1fa6b21feeda2909d600f79f3661` | `6d7261af55d3590aa931ebfa11fa54ca898b0f77` |
| `mortgage-underwriting-console` | `a59f6d82aea631fbddbce06932158d915c21548636b045d3668a5cb90bc0c2f8` | `6d7261af55d3590aa931ebfa11fa54ca898b0f77` |
| `mortgage-income-parser` | `3373f040f817894ab06e59d0b48e27e1d67582f5e7fe935889b4fcdca52eab7f` | `6d7261af55d3590aa931ebfa11fa54ca898b0f77`, `8a98ca5e5c7430b2d024d8fad84086e09c128da7` |
| `mortgage-encompass-connector` | `ab0d2586f6f4882b2998ce70d4eb94952cf386f757aafb9afa0560cacf6d8861` | `3e6f28d9f156ffbdce42e3c6ffff77a34bd977b7` |

## Rollback procedure

1. Prefer the normal infrastructure path: restore the above image digests in
   the reviewed dev Terraform inputs, create a saved plan, verify it has no
   unintended changes, and apply it.
2. For a time-critical application-only rollback, an authorized operator can
   update each ECS service to the corresponding task-definition revision above,
   wait for steady state and target health, then reconcile Terraform to the
   same revisions/digests. Do not use this shortcut for database changes.
3. Do **not** roll back schema migrations by restoring the application alone.
   Use a forward-compatible corrective migration unless a separately approved
   database restore from the snapshot is required.
4. After rollback, run authenticated synthetic smoke, calculation, export, and
   tenant-isolation checks before declaring recovery complete.

## Safety notes

- This manifest contains no credentials, tokens, borrower data, or raw
  documents.
- No AWS resource was changed except creation of the named manual RDS snapshot.
- Static UI comparison evidence is retained separately in
  `../aws-dev-baseline-2026-10-11/README.md`.
