data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name_prefix}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_execution_secrets" {
  statement {
    sid     = "ReadRuntimeSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [
        aws_secretsmanager_secret.database_app.arn,
        aws_secretsmanager_secret.field_encryption.arn,
      ],
      var.enable_encompass_document_pull_worker ? [aws_secretsmanager_secret.encompass_api_client[0].arn] : [],
    )
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "runtime-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_secrets.json
}

resource "aws_iam_role" "migration_execution" {
  name               = "${local.name_prefix}-migration-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "migration_execution" {
  role       = aws_iam_role.migration_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "migration_secrets" {
  statement {
    sid     = "ReadMigrationSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      local.rds_master_secret_arn,
      aws_secretsmanager_secret.database_app.arn,
      aws_secretsmanager_secret.database_migrator.arn,
      aws_secretsmanager_secret.database_connector.arn,
    ]
  }
}

resource "aws_iam_role_policy" "migration_secrets" {
  name   = "migration-secrets"
  role   = aws_iam_role.migration_execution.id
  policy = data.aws_iam_policy_document.migration_secrets.json
}

resource "aws_iam_role" "portal_task" {
  name               = "${local.name_prefix}-portal-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "portal_task" {
  statement {
    sid       = "EnqueueApprovedSyntheticSync"
    actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.sync.arn]
  }

  dynamic "statement" {
    for_each = var.enable_encompass_document_pull_worker ? [1] : []

    content {
      sid       = "EnqueueTenantDocumentPull"
      actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
      resources = [aws_sqs_queue.document_pull[0].arn]
    }
  }
}

resource "aws_iam_role" "connector_execution" {
  name               = "${local.name_prefix}-encompass-connector-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "connector_execution" {
  role       = aws_iam_role.connector_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "connector_execution_secret" {
  statement {
    sid     = "ReadConnectorRuntimeSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [aws_secretsmanager_secret.database_connector.arn],
      var.enable_encompass_connector ? [aws_secretsmanager_secret.connector_service_token[0].arn] : [],
      var.enable_encompass_connector ? [aws_secretsmanager_secret.connector_service_signing_key[0].arn] : [],
      local.connector_real_encompass ? [aws_secretsmanager_secret.connector_encompass_credentials[0].arn] : [],
    )
  }
}

resource "aws_iam_role_policy" "connector_execution_secret" {
  name   = "connector-database-secret"
  role   = aws_iam_role.connector_execution.id
  policy = data.aws_iam_policy_document.connector_execution_secret.json
}

resource "aws_iam_role_policy" "portal_task" {
  name   = "portal-runtime"
  role   = aws_iam_role.portal_task.id
  policy = data.aws_iam_policy_document.portal_task.json
}

resource "aws_iam_role" "parser_task" {
  name               = "${local.name_prefix}-parser-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role" "document_pull_worker_task" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  name               = "${local.name_prefix}-document-pull-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role" "connector_task" {
  name               = "${local.name_prefix}-encompass-connector-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "document_pull_worker_task" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  statement {
    sid = "ConsumeDocumentPullsOnly"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.document_pull[0].arn]
  }
}

resource "aws_iam_role_policy" "document_pull_worker_task" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  name   = "document-pull-worker-runtime"
  role   = aws_iam_role.document_pull_worker_task[0].id
  policy = data.aws_iam_policy_document.document_pull_worker_task[0].json
}

resource "aws_iam_role" "console_task" {
  name               = "${local.name_prefix}-console-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role" "migration_task" {
  name               = "${local.name_prefix}-migration-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_ecr_repository" "parser" {
  name                 = "mortgage-income-parser"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "migration" {
  name                 = "mortgage-database-migrations"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "console" {
  name                 = "mortgage-underwriting-console"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_cloudwatch_log_group" "portal" {
  name              = "/ecs/${local.name_prefix}/portal"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "parser" {
  name              = "/ecs/${local.name_prefix}/income-parser"
  retention_in_days = 14
}

resource "aws_ecr_repository" "connector" {
  name                 = "mortgage-encompass-connector"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_cloudwatch_log_group" "document_pull_worker" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  name              = "/ecs/${local.name_prefix}/document-pull-worker"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "connector" {
  name              = "/ecs/${local.name_prefix}/encompass-connector"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "console" {
  name              = "/ecs/${local.name_prefix}/underwriting-console"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "migration" {
  name              = "/ecs/${local.name_prefix}/database-migration"
  retention_in_days = 30
}
