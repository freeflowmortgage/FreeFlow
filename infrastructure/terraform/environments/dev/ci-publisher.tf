resource "aws_iam_openid_connect_provider" "github" {
  count = local.github_oidc_enabled && var.github_oidc_provider_arn == null ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  github_oidc_enabled = var.enable_github_image_publisher || var.enable_github_dev_deployer

  github_oidc_provider_arn = local.github_oidc_enabled ? coalesce(
    var.github_oidc_provider_arn,
    try(aws_iam_openid_connect_provider.github[0].arn, null),
  ) : null

  published_image_repository_arns = [
    data.aws_ecr_repository.portal.arn,
    aws_ecr_repository.parser.arn,
    aws_ecr_repository.console.arn,
    aws_ecr_repository.migration.arn,
    aws_ecr_repository.connector.arn,
  ]
}

data "aws_iam_policy_document" "github_image_publisher_assume" {
  count = var.enable_github_image_publisher ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only pushes to main may publish; pull requests and other branches cannot
    # obtain this role.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_image_publisher" {
  count = var.enable_github_image_publisher ? 1 : 0

  name                 = "${local.name_prefix}-github-image-publisher"
  assume_role_policy   = data.aws_iam_policy_document.github_image_publisher_assume[0].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_image_publisher" {
  count = var.enable_github_image_publisher ? 1 : 0

  statement {
    sid       = "AuthenticateToEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push and read scan results only. No ECS, Terraform state, IAM, or delete
  # permissions: deploying a published digest stays a reviewed Terraform apply.
  statement {
    sid = "PushAndInspectReleaseImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImageScanFindings",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = local.published_image_repository_arns
  }
}

resource "aws_iam_role_policy" "github_image_publisher" {
  count = var.enable_github_image_publisher ? 1 : 0

  name   = "ecr-release-publish"
  role   = aws_iam_role.github_image_publisher[0].id
  policy = data.aws_iam_policy_document.github_image_publisher[0].json
}

locals {
  github_dev_deployer_pass_role_arns = compact([
    aws_iam_role.task_execution.arn,
    aws_iam_role.migration_execution.arn,
    aws_iam_role.portal_task.arn,
    aws_iam_role.connector_execution.arn,
    aws_iam_role.parser_execution.arn,
    aws_iam_role.parser_task.arn,
    aws_iam_role.connector_task.arn,
    aws_iam_role.console_task.arn,
    aws_iam_role.migration_task.arn,
    try(aws_iam_role.document_pull_worker_task[0].arn, null),
    try(aws_iam_role.encompass_sync_worker_task[0].arn, null),
    try(aws_iam_role.outbound_webhook_worker_task[0].arn, null),
  ])
}

data "aws_iam_policy_document" "github_dev_deployer_assume" {
  count = var.enable_github_dev_deployer ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_dev_deployer" {
  count = var.enable_github_dev_deployer ? 1 : 0

  name                 = "${local.name_prefix}-github-deployer"
  assume_role_policy   = data.aws_iam_policy_document.github_dev_deployer_assume[0].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_dev_deployer" {
  count = var.enable_github_dev_deployer ? 1 : 0

  statement {
    sid       = "ReadTerraformStateBucket"
    actions   = ["s3:GetBucketLocation", "s3:ListBucket"]
    resources = [var.github_dev_terraform_state_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["platform/dev.tfstate", "platform/dev.tfstate.tflock"]
    }
  }

  statement {
    sid = "ManageDevelopmentTerraformState"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "${var.github_dev_terraform_state_bucket_arn}/platform/dev.tfstate",
      "${var.github_dev_terraform_state_bucket_arn}/platform/dev.tfstate.tflock",
    ]
  }

  statement {
    sid = "ManageDevelopmentTerraformLock"
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = [var.github_dev_terraform_lock_table_arn]
  }

  statement {
    sid = "UseDevelopmentTerraformStateKey"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey",
    ]
    resources = [var.github_dev_terraform_state_kms_key_arn]
  }

  statement {
    sid = "ReadDevelopmentDeploymentContext"
    actions = [
      "cognito-idp:DescribeUserPool",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:DescribeUserPoolDomain",
      "cognito-idp:ListTagsForResource",
      "ec2:Describe*",
      "ecr:Describe*",
      "ecr:Get*",
      "ecs:Describe*",
      "ecs:List*",
      "elasticloadbalancing:Describe*",
      "iam:GetRole",
      "kms:DescribeKey",
      "logs:Describe*",
      "logs:ListTagsForResource",
      "rds:Describe*",
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecretVersionIds",
      "servicediscovery:Get*",
      "servicediscovery:List*",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "RegisterDevelopmentTaskDefinitions"
    actions   = ["ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid = "ManageDevelopmentTaskDefinitions"
    actions = [
      "ecs:DeregisterTaskDefinition",
      "ecs:TagResource",
      "ecs:UntagResource",
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name_prefix}-*",
    ]
  }

  statement {
    sid     = "RollDevelopmentEcsServices"
    actions = ["ecs:UpdateService"]
    resources = [
      "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${var.ecs_cluster_name}/${local.name_prefix}-*",
    ]
  }

  statement {
    sid       = "PassOnlyDevelopmentTaskRoles"
    actions   = ["iam:PassRole"]
    resources = local.github_dev_deployer_pass_role_arns

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_dev_deployer" {
  count = var.enable_github_dev_deployer ? 1 : 0

  name   = "scoped-development-deploy"
  role   = aws_iam_role.github_dev_deployer[0].id
  policy = data.aws_iam_policy_document.github_dev_deployer[0].json
}
