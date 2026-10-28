[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [ValidateSet("portal", "parser", "console", "migration", "connector")]
    [string[]]$Service = @("portal", "parser", "migration", "connector"),

    [string]$AwsProfile = "freeflow-dev",
    [string]$AwsRegion = "us-west-2",
    [switch]$UseAmbientAwsCredentials,
    [string]$TerraformStateBucket,
    [string]$TerraformLockTable,
    [string]$TerraformStateKey = "platform/dev.tfstate",
    [string]$ImageTag,
    [ValidateSet("protected-web", "encompass-hosted")]
    [string]$ConsoleMode = "encompass-hosted",
    [string]$BuilderName = "freeflow-deploy",
    [string]$PlanPath,
    [switch]$ValidateOnly,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$terraformDirectory = Join-Path $repoRoot "infrastructure/terraform/environments/dev"
$terraformBackendConfig = Join-Path $terraformDirectory "backend.hcl"
$bakeFile = Join-Path $repoRoot "docker-bake.hcl"

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [string[]]$ArgumentList = @()
    )

    & $Executable @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($ArgumentList -join ' ')"
    }
}

function Invoke-NativeCapture {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [string[]]$ArgumentList = @()
    )

    $output = & $Executable @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($ArgumentList -join ' ')"
    }
    return ($output -join "`n").Trim()
}

function Invoke-WithAwsProfileCredentials {
    param([Parameter(Mandatory = $true)][scriptblock]$Operation)

    if ($UseAmbientAwsCredentials) {
        return & $Operation
    }

    $credentialJson = Invoke-NativeCapture -Executable aws -ArgumentList @("configure", "export-credentials", "--profile", $AwsProfile, "--format", "process")
    $credentials = $credentialJson | ConvertFrom-Json
    $credentialEnvironment = @{
        AWS_ACCESS_KEY_ID     = $credentials.AccessKeyId
        AWS_SECRET_ACCESS_KEY = $credentials.SecretAccessKey
        AWS_SESSION_TOKEN     = $credentials.SessionToken
    }
    $previousEnvironment = @{}

    try {
        foreach ($entry in $credentialEnvironment.GetEnumerator()) {
            $previousEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
        }
        return & $Operation
    } finally {
        foreach ($entry in $previousEnvironment.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
        }
    }
}

function Get-AwsProfileArguments {
    if ($UseAmbientAwsCredentials) {
        return @()
    }
    return @("--profile", $AwsProfile)
}

function Invoke-Terraform {
    param([string[]]$ArgumentList = @())

    Invoke-WithAwsProfileCredentials -Operation {
        Invoke-Native -Executable terraform -ArgumentList $ArgumentList
    }
}

function Invoke-TerraformCapture {
    param([string[]]$ArgumentList = @())

    return Invoke-WithAwsProfileCredentials -Operation {
        Invoke-NativeCapture -Executable terraform -ArgumentList $ArgumentList
    }
}

function Get-TerraformOutput {
    param([Parameter(Mandatory = $true)][string]$Name)

    return Invoke-TerraformCapture -ArgumentList @("-chdir=$terraformDirectory", "output", "-raw", $Name)
}

function Get-EcrImageDigest {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][string]$Tag,
        [switch]$AllowMissing
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $arguments = @("ecr", "describe-images") + (Get-AwsProfileArguments) + @(
        "--region", $AwsRegion,
        "--repository-name", $RepositoryName,
        "--image-ids", "imageTag=$Tag",
        "--query", "imageDetails[0].imageDigest",
        "--output", "text"
    )
    $output = & aws @arguments 2>$null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference

    if ($exitCode -ne 0) {
        if ($AllowMissing) {
            return $null
        }
        throw "Unable to resolve ECR digest for ${RepositoryName}:${Tag}."
    }

    $digest = ($output -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($digest) -or $digest -eq "None") {
        if ($AllowMissing) {
            return $null
        }
        throw "ECR returned no digest for ${RepositoryName}:${Tag}."
    }
    return $digest
}

function Assert-CleanWorktree {
    $changes = Invoke-NativeCapture -Executable git -ArgumentList @("-C", $repoRoot, "status", "--porcelain", "--untracked-files=normal")
    if (-not [string]::IsNullOrWhiteSpace($changes)) {
        throw "The worktree contains modified or untracked non-ignored files. Commit or stash them before creating immutable deployment images."
    }
}

function Assert-ImageScans {
    param([Parameter(Mandatory = $true)][hashtable]$Images)

    $pending = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($name in $Images.Keys) {
        [void]$pending.Add($name)
    }

    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(15)
    while ($pending.Count -gt 0) {
        foreach ($name in @($pending)) {
            $image = $Images[$name]
            $previousPreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $arguments = @("ecr", "describe-image-scan-findings") + (Get-AwsProfileArguments) + @(
                "--region", $AwsRegion,
                "--repository-name", $image.RepositoryName,
                "--image-id", "imageDigest=$($image.Digest)",
                "--output", "json"
            )
            $json = & aws @arguments 2>$null
            $exitCode = $LASTEXITCODE
            $ErrorActionPreference = $previousPreference

            if ($exitCode -ne 0) {
                continue
            }

            $scan = (($json -join "`n") | ConvertFrom-Json)
            $status = $scan.imageScanStatus.status
            if ($status -eq "FAILED") {
                throw "ECR scan failed for $name ($($image.Reference))."
            }
            if ($status -ne "COMPLETE") {
                continue
            }

            $counts = $scan.imageScanFindings.findingSeverityCounts
            $criticalProperty = if ($null -ne $counts) { $counts.PSObject.Properties["CRITICAL"] } else { $null }
            $highProperty = if ($null -ne $counts) { $counts.PSObject.Properties["HIGH"] } else { $null }
            $critical = if ($null -ne $criticalProperty) { [int]$criticalProperty.Value } else { 0 }
            $high = if ($null -ne $highProperty) { [int]$highProperty.Value } else { 0 }
            if ($critical -gt 0 -or $high -gt 0) {
                throw "ECR scan blocked ${name}: CRITICAL=$critical HIGH=$high."
            }

            Write-Host "ECR scan passed for $name (CRITICAL=0, HIGH=0)."
            [void]$pending.Remove($name)
        }

        if ($pending.Count -gt 0) {
            if ([DateTimeOffset]::UtcNow -ge $deadline) {
                throw "Timed out waiting for ECR scans: $($pending -join ', ')."
            }
            Start-Sleep -Seconds 10
        }
    }
}

function Assert-SafePlan {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][System.Collections.Generic.HashSet[string]]$AllowedAddresses
    )

    $planJson = Invoke-TerraformCapture -ArgumentList @("-chdir=$terraformDirectory", "show", "-json", $Path)
    $plan = $planJson | ConvertFrom-Json
    foreach ($change in $plan.resource_changes) {
        $actions = @($change.change.actions)
        if ($actions.Count -eq 1 -and $actions[0] -in @("no-op", "read")) {
            continue
        }
        if (-not $AllowedAddresses.Contains([string]$change.address)) {
            throw "Terraform plan changed an address outside the selected services: $($change.address)."
        }
        if ($actions.Count -eq 1 -and $actions[0] -eq "delete") {
            throw "Terraform plan contains a delete-only action for $($change.address)."
        }
    }
}

$serviceDefinitions = @{
    portal = @{
        EnvironmentVariable = "PORTAL_IMAGE"
        RepositoryOutput = "portal_repository_url"
        TerraformVariable = "portal_image"
        Targets = @(
            "aws_ecs_task_definition.portal[0]",
            "aws_ecs_service.portal[0]",
            "aws_ecs_task_definition.document_pull_worker[0]",
            "aws_ecs_service.document_pull_worker[0]",
            "aws_ecs_task_definition.encompass_sync_worker[0]",
            "aws_ecs_service.encompass_sync_worker[0]",
            "aws_ecs_task_definition.outbound_webhook_worker[0]",
            "aws_ecs_service.outbound_webhook_worker[0]"
        )
        EcsServices = @(
            "freeflow-dev-portal",
            "freeflow-dev-document-pull-worker",
            "freeflow-dev-encompass-sync-worker",
            "freeflow-dev-outbound-webhook-worker"
        )
    }
    parser = @{
        EnvironmentVariable = "PARSER_IMAGE"
        RepositoryOutput = "parser_repository_url"
        TerraformVariable = "parser_image"
        Targets = @("aws_ecs_task_definition.parser[0]", "aws_ecs_service.parser[0]")
        EcsServices = @("freeflow-dev-income-parser")
    }
    console = @{
        EnvironmentVariable = "CONSOLE_IMAGE"
        RepositoryOutput = "console_repository_url"
        TerraformVariable = "console_image"
        Targets = @("aws_ecs_task_definition.console[0]", "aws_ecs_service.console[0]")
        EcsServices = @("freeflow-dev-underwriting-console")
    }
    migration = @{
        EnvironmentVariable = "MIGRATION_IMAGE"
        RepositoryOutput = "migration_repository_url"
        TerraformVariable = "migration_image"
        Targets = @("aws_ecs_task_definition.migration[0]", "aws_ecs_task_definition.database_preflight[0]")
        EcsServices = @()
    }
    connector = @{
        EnvironmentVariable = "CONNECTOR_IMAGE"
        RepositoryOutput = "connector_repository_url"
        TerraformVariable = "connector_image"
        Targets = @(
            "aws_ecs_task_definition.connector[0]",
            "aws_ecs_task_definition.connector_binding_bootstrap[0]",
            "aws_ecs_service.connector[0]"
        )
        EcsServices = @("freeflow-dev-encompass-connector")
    }
}

$selectedServices = @($Service | Select-Object -Unique)
$timer = [System.Diagnostics.Stopwatch]::StartNew()

if ($ValidateOnly) {
    Invoke-Native -Executable docker -ArgumentList (@("buildx", "bake", "--file", $bakeFile, "--print") + $selectedServices)
    Write-Host "Deployment script and Docker Bake targets are valid: $($selectedServices -join ', ')"
    return
}

foreach ($command in @("aws", "docker", "git", "terraform")) {
    if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is unavailable: $command"
    }
}
if (([string]::IsNullOrWhiteSpace($TerraformStateBucket) -or [string]::IsNullOrWhiteSpace($TerraformLockTable)) -and
    -not (Test-Path -LiteralPath $terraformBackendConfig -PathType Leaf)) {
    throw "Terraform backend configuration is missing: $terraformBackendConfig"
}

Assert-CleanWorktree

$commit = Invoke-NativeCapture -Executable git -ArgumentList @("-C", $repoRoot, "rev-parse", "HEAD")
if ([string]::IsNullOrWhiteSpace($ImageTag)) {
    $ImageTag = $commit
}
if ($ImageTag -notmatch "^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$") {
    throw "ImageTag is not a valid Docker/ECR tag: $ImageTag"
}

$identityArguments = @("sts", "get-caller-identity") + (Get-AwsProfileArguments) + @("--region", $AwsRegion, "--output", "json")
$identity = (Invoke-NativeCapture -Executable aws -ArgumentList $identityArguments) | ConvertFrom-Json
Write-Host "AWS account: $($identity.Account); region: $AwsRegion; commit: $commit"

$terraformInitArguments = [System.Collections.Generic.List[string]]@("-chdir=$terraformDirectory", "init", "-input=false", "-reconfigure")
if (-not [string]::IsNullOrWhiteSpace($TerraformStateBucket) -and -not [string]::IsNullOrWhiteSpace($TerraformLockTable)) {
    $terraformInitArguments.Add("-backend-config=bucket=$TerraformStateBucket")
    $terraformInitArguments.Add("-backend-config=key=$TerraformStateKey")
    $terraformInitArguments.Add("-backend-config=region=$AwsRegion")
    $terraformInitArguments.Add("-backend-config=encrypt=true")
    $terraformInitArguments.Add("-backend-config=dynamodb_table=$TerraformLockTable")
} else {
    $terraformInitArguments.Add("-backend-config=$terraformBackendConfig")
}
Invoke-Terraform -ArgumentList $terraformInitArguments

$images = @{}
$missingServices = [System.Collections.Generic.List[string]]::new()
foreach ($name in $selectedServices) {
    $definition = $serviceDefinitions[$name]
    $repositoryUrl = Get-TerraformOutput $definition.RepositoryOutput
    $repositoryName = $repositoryUrl.Substring($repositoryUrl.IndexOf("/") + 1)
    $existingDigest = Get-EcrImageDigest -RepositoryName $repositoryName -Tag $ImageTag -AllowMissing
    $images[$name] = @{
        RepositoryUrl = $repositoryUrl
        RepositoryName = $repositoryName
        Digest = $existingDigest
        Reference = if ($existingDigest) { "${repositoryUrl}@${existingDigest}" } else { $null }
    }
    if ($existingDigest) {
        Write-Host "Reusing immutable image for ${name}: $($images[$name].Reference)"
    } else {
        $missingServices.Add($name)
    }
}

if ($missingServices.Count -gt 0) {
    $registry = $images[$missingServices[0]].RepositoryUrl.Split("/")[0]
    if ($PSCmdlet.ShouldProcess($registry, "Authenticate Docker to ECR and push $($missingServices -join ', ')")) {
        $loginArguments = @("ecr", "get-login-password") + (Get-AwsProfileArguments) + @("--region", $AwsRegion)
        $password = Invoke-NativeCapture -Executable aws -ArgumentList $loginArguments
        try {
            $password | & docker login --username AWS --password-stdin $registry
            if ($LASTEXITCODE -ne 0) {
                throw "Docker login to $registry failed."
            }
        } finally {
            $password = $null
        }

        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & docker buildx inspect $BuilderName *> $null
        $builderExists = $LASTEXITCODE -eq 0
        $ErrorActionPreference = $previousPreference
        if (-not $builderExists) {
            Invoke-Native -Executable docker -ArgumentList @("buildx", "create", "--name", $BuilderName, "--driver", "docker-container", "--use")
        } else {
            Invoke-Native -Executable docker -ArgumentList @("buildx", "use", $BuilderName)
        }
        Invoke-Native -Executable docker -ArgumentList @("buildx", "inspect", "--bootstrap")

        $previousEnvironment = @{}
        try {
            foreach ($name in $missingServices) {
                $environmentName = $serviceDefinitions[$name].EnvironmentVariable
                $previousEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, "Process")
                [Environment]::SetEnvironmentVariable($environmentName, "$($images[$name].RepositoryUrl):$ImageTag", "Process")
            }
            if ($missingServices -contains "console") {
                $previousEnvironment["FREEFLOW_CONSOLE_MODE"] = [Environment]::GetEnvironmentVariable("FREEFLOW_CONSOLE_MODE", "Process")
                [Environment]::SetEnvironmentVariable("FREEFLOW_CONSOLE_MODE", $ConsoleMode, "Process")
            }

            # Preserve the existing single-manifest release contract. Buildx
            # otherwise adds a provenance-attestation manifest by default.
            $bakeArguments = @("buildx", "bake", "--builder", $BuilderName, "--file", $bakeFile, "--progress", "plain", "--provenance=false", "--push") + @($missingServices)
            Invoke-Native -Executable docker -ArgumentList $bakeArguments
        } finally {
            foreach ($entry in $previousEnvironment.GetEnumerator()) {
                [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
            }
        }
    } else {
        throw "Image build and push were not approved."
    }

    foreach ($name in $missingServices) {
        $image = $images[$name]
        $digest = Get-EcrImageDigest -RepositoryName $image.RepositoryName -Tag $ImageTag
        $image.Digest = $digest
        $image.Reference = "$($image.RepositoryUrl)@${digest}"
    }
}

Assert-ImageScans -Images $images

$shortCommit = $commit.Substring(0, 12)
if ([string]::IsNullOrWhiteSpace($PlanPath)) {
    $PlanPath = Join-Path $terraformDirectory "deployment-${shortCommit}.tfplan"
}

$planArguments = [System.Collections.Generic.List[string]]::new()
$planArguments.Add("-chdir=$terraformDirectory")
$planArguments.Add("plan")
$planArguments.Add("-input=false")
$planArguments.Add("-out=$PlanPath")
$allowedAddresses = [System.Collections.Generic.HashSet[string]]::new()
foreach ($name in $selectedServices) {
    $definition = $serviceDefinitions[$name]
    $planArguments.Add("-var=$($definition.TerraformVariable)=$($images[$name].Reference)")
    foreach ($target in $definition.Targets) {
        $planArguments.Add("-target=$target")
        [void]$allowedAddresses.Add($target)
    }
}
if ($selectedServices -contains "portal") {
    # The document-pull and sync workers are built into the portal image. Keep
    # an explicitly configured connector_worker_image from pinning those
    # workers to an older portal digest during a scoped portal deployment.
    $planArguments.Add("-var=connector_worker_image=$($images["portal"].Reference)")
}
if ($selectedServices -contains "console") {
    $planArguments.Add("-var=console_runtime_mode=$ConsoleMode")
}

if ($PSCmdlet.ShouldProcess($PlanPath, "Create and validate saved Terraform deployment plan")) {
    Invoke-Terraform -ArgumentList $planArguments
    Assert-SafePlan -Path $PlanPath -AllowedAddresses $allowedAddresses
    Write-Host "Saved Terraform plan passed scope and delete checks: $PlanPath"
} else {
    throw "Terraform planning was not approved."
}

if ($Apply) {
    if ($PSCmdlet.ShouldProcess($PlanPath, "Apply the validated Terraform plan and wait for ECS stability")) {
        Invoke-Terraform -ArgumentList @("-chdir=$terraformDirectory", "apply", "-input=false", $PlanPath)

        $requestedEcsServices = @($selectedServices | ForEach-Object { $serviceDefinitions[$_].EcsServices } | Select-Object -Unique)
        if ($requestedEcsServices.Count -gt 0) {
            $clusterArn = Get-TerraformOutput "ecs_cluster_arn"
            $descriptionArguments = @("ecs", "describe-services") + (Get-AwsProfileArguments) + @("--region", $AwsRegion, "--cluster", $clusterArn, "--services") + $requestedEcsServices + @("--output", "json")
            $descriptionJson = Invoke-NativeCapture -Executable aws -ArgumentList $descriptionArguments
            $description = $descriptionJson | ConvertFrom-Json
            $activeServices = @($description.services | Where-Object { $_.status -eq "ACTIVE" } | ForEach-Object { $_.serviceName })
            if ($activeServices.Count -gt 0) {
                $waitArguments = @("ecs", "wait", "services-stable") + (Get-AwsProfileArguments) + @("--region", $AwsRegion, "--cluster", $clusterArn, "--services") + $activeServices
                Invoke-Native -Executable aws -ArgumentList $waitArguments
                Write-Host "ECS services are stable: $($activeServices -join ', ')"
            }
        }
    }
} else {
    Write-Host "Plan created but not applied. Re-run with -Apply after reviewing: terraform -chdir=`"$terraformDirectory`" show `"$PlanPath`""
}

$timer.Stop()
Write-Host "Deployment preparation completed in $([Math]::Round($timer.Elapsed.TotalMinutes, 2)) minute(s)."
foreach ($name in $selectedServices) {
    Write-Host "$name=$($images[$name].Reference)"
}
