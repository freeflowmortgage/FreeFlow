resource "aws_iam_openid_connect_provider" "github" {
  count = var.enable_github_image_publisher && var.github_oidc_provider_arn == null ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  github_oidc_provider_arn = var.enable_github_image_publisher ? coalesce(
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
