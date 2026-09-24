# Fast, Reproducible Dev Deployments

This workflow shortens repeat AWS dev deployments without removing runtime
components or bypassing release controls. It retains immutable image tags and
digests, ECR vulnerability scanning, saved Terraform plans, bounded Terraform
targets, ECS deployment circuit breakers, and steady-state verification.

## What makes it faster

- One persistent BuildKit builder retains dependency and image layers between
  local deployments.
- Docker Bake builds independent selected services concurrently.
- Existing immutable images for the same Git commit are reused instead of
  rebuilt or pushed again.
- Only explicitly selected task definitions and ECS services enter the saved
  Terraform plan.
- All selected ECR scans progress concurrently while the script polls them.
- One Terraform plan/apply updates all selected services, followed by one ECS
  stability wait.

The first build remains a cold build. The largest improvement appears on the
second and later deployments, especially when lockfiles and base images have
not changed.

## Preconditions

1. Work from a reviewed commit with a clean tracked worktree.
2. Docker Desktop must be running with Buildx support.
3. Install AWS CLI and Terraform.
4. Authenticate the least-privileged development profile:

   ```powershell
   aws login --profile freeflow-dev-deploy
   ```

5. Initialize the existing dev Terraform configuration and ignored backend and
   variable files according to `AWS-LIVE-TEST-RUNBOOK.md`.

## Deploy only what changed

Build, push, scan, and create a saved plan for the parser and console:

```powershell
./infrastructure/scripts/Deploy-FreeFlowDev.ps1 `
  -Service parser,console
```

Review the saved plan printed by the script. Then repeat with `-Apply`; images
already published for the commit are reused, so the second invocation proceeds
directly to the plan, apply, and ECS wait:

```powershell
./infrastructure/scripts/Deploy-FreeFlowDev.ps1 `
  -Service parser,console `
  -Apply
```

Available service names are `portal`, `parser`, `console`, `migration`, and
`connector`. Omitting `-Service` selects all five. Select `migration` whenever
database migrations or the Prisma schema changed. Select `portal` when the
document-pull worker changed because both use the portal image.

The script uses the full Git commit as the immutable ECR tag. If that tag is
already present, its digest is verified and reused. ECR scans must complete
with zero critical and zero high findings before Terraform planning begins.

## Safety behavior

- Modified or untracked non-ignored files stop the deployment before any image
  is built, so an image cannot contain content absent from its Git commit.
- Untracked local Terraform plans do not enter the image because `.dockerignore`
  excludes Terraform plans and state.
- The Terraform plan is rejected if it changes an address outside the selected
  service set or contains a delete-only action.
- Applying requires the explicit `-Apply` switch and PowerShell confirmation.
- Services remain digest-pinned; mutable tags are never passed to ECS.
- Buildx provenance attestations are disabled on this path so pushed artifacts
  retain the existing Linux/AMD64 single-manifest contract.
- Migration tasks are registered but never run automatically. Continue using
  the database preflight and migration procedure in the live-test runbook.

## Cache maintenance

The builder is named `freeflow-deploy`. Its cache lives in Docker rather than
the repository and survives normal builds. Inspect disk use with:

```powershell
docker buildx du --builder freeflow-deploy
```

Prune this cache only when intentionally trading the next deployment's speed
for local disk space. Cache removal is not part of the normal deployment path.

## Measuring improvement

The script reports total elapsed time. Docker's plain build output identifies
cached and executed layers. Record four values for the first cold deployment
and a later warm deployment:

1. build and push time;
2. ECR scan completion time;
3. Terraform plan/apply time;
4. ECS steady-state time.

This separates build-cache performance from AWS networking or application
startup problems instead of treating the full release as one opaque wait.
