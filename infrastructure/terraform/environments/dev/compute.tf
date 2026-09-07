resource "terraform_data" "service_gate" {
  count = var.enable_services ? 1 : 0

  lifecycle {
    precondition {
      condition     = var.enable_edge
      error_message = "enable_edge must be true before ECS services can be enabled."
    }
  }
}

resource "aws_ecs_task_definition" "parser" {
  count = var.enable_services && var.enable_edge && var.enable_parser ? 1 : 0

  family                   = "${local.name_prefix}-income-parser"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.parser_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "parser-tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = "income-parser"
      image                  = var.parser_image
      essential              = true
      readonlyRootFilesystem = true
      user                   = "8888"
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }
      environment = [
        { name = "TMPDIR", value = "/tmp/freeflow" },
        { name = "PYTHONDONTWRITEBYTECODE", value = "1" },
        { name = "PYTHONUNBUFFERED", value = "1" },
      ]
      portMappings = [{
        name          = "http"
        containerPort = 8080
        hostPort      = 8080
        protocol      = "tcp"
      }]
      mountPoints = [{
        sourceVolume  = "parser-tmp"
        containerPath = "/tmp/freeflow"
        readOnly      = false
      }]
      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.parser.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "portal" {
  count = var.enable_services && var.enable_edge ? 1 : 0

  family                   = "${local.name_prefix}-portal"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.portal_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name                   = "portal"
      image                  = var.portal_image
      essential              = true
      readonlyRootFilesystem = true
      user                   = "1001"
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }
      environment = concat(local.common_environment, [
        { name = "PORT", value = "8000" },
        { name = "HOSTNAME", value = "0.0.0.0" },
        { name = "APP_BASE_URL", value = var.enable_cognito_edge ? "https://${var.portal_hostname}" : "http://${aws_lb.portal[0].dns_name}" },
        { name = "TRUSTED_ORIGIN", value = var.enable_cognito_edge ? "https://${var.portal_hostname}" : "http://${aws_lb.portal[0].dns_name}" },
        { name = "PARSER_ENABLED", value = var.enable_parser ? "true" : "false" },
        { name = "DOC_PARSER_URL", value = "http://income-parser.freeflow.local:8080/api/underwrite/process" },
        { name = "DOC_PARSER_SERVICE_URL", value = "http://income-parser.freeflow.local:8080/parse" },
        { name = "APPRAISAL_PARSER_URL", value = "http://appraisal-parser-disabled.freeflow.local:8081" },
        { name = "SYNC_QUEUE_URL", value = aws_sqs_queue.sync.url },
        { name = "SYNC_DLQ_URL", value = aws_sqs_queue.sync_dlq.url },
        ], var.enable_cognito_edge ? [
        { name = "OIDC_ISSUER", value = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.live_test[0].id}" },
        { name = "OIDC_CLIENT_ID", value = aws_cognito_user_pool_client.alb[0].id },
        { name = "OIDC_AUDIENCE", value = aws_cognito_user_pool_client.alb[0].id },
        { name = "ALB_OIDC_SIGNER_ARN", value = aws_lb.portal[0].arn },
        ] : [
        { name = "ALLOW_DEV_AUTH_BYPASS", value = "true" },
        { name = "DEV_AUTH_ROLE", value = "UNDERWRITER" },
        { name = "DEV_AUTH_USER_ID", value = "00000000-0000-4000-8000-000000000101" },
        { name = "DEV_AUTH_TENANT_ID", value = "00000000-0000-4000-8000-000000000100" },
        { name = "DEV_AUTH_SUBJECT", value = "plte-dev-underwriter" },
      ])
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database_app.arn}:url::" },
        { name = "FIELD_ENCRYPTION_KEY", valueFrom = aws_secretsmanager_secret.field_encryption.arn },
      ]
      portMappings = [{
        name          = "http"
        containerPort = 8000
        hostPort      = 8000
        protocol      = "tcp"
      }]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:8000',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.portal.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "migration" {
  count = var.enable_services && var.enable_edge ? 1 : 0

  family                   = "${local.name_prefix}-database-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.migration_execution.arn
  task_role_arn            = aws_iam_role.migration_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name                   = "database-migration"
      image                  = var.migration_image
      essential              = true
      readonlyRootFilesystem = true
      user                   = "1001"
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }
      environment = [
        { name = "PGHOST", value = local.rds_endpoint },
        { name = "PGPORT", value = "5432" },
        { name = "PGDATABASE", value = "mortgage_dev" },
        { name = "APP_USERNAME", value = "freeflow_app_login" },
        { name = "MIGRATOR_USERNAME", value = "freeflow_migrator_login" },
      ]
      secrets = [
        { name = "PGUSER", valueFrom = "${local.rds_master_secret_arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${local.rds_master_secret_arn}:password::" },
        { name = "APP_PASSWORD", valueFrom = "${aws_secretsmanager_secret.database_app.arn}:password::" },
        { name = "MIGRATOR_PASSWORD", valueFrom = "${aws_secretsmanager_secret.database_migrator.arn}:password::" },
        { name = "MIGRATOR_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database_migrator.arn}:url::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.migration.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "parser" {
  count = var.enable_services && var.enable_edge && var.enable_parser ? 1 : 0

  name             = "${local.name_prefix}-income-parser"
  cluster          = data.aws_ecs_cluster.existing.arn
  task_definition  = aws_ecs_task_definition.parser[0].arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_private_subnet_ids
    security_groups  = [aws_security_group.parser.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.parser.arn
  }

  depends_on = [aws_route.app_default]
}

resource "aws_ecs_service" "portal" {
  count = var.enable_services && var.enable_edge ? 1 : 0

  name                              = "${local.name_prefix}-portal"
  cluster                           = data.aws_ecs_cluster.existing.arn
  task_definition                   = aws_ecs_task_definition.portal[0].arn
  desired_count                     = var.portal_desired_count
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 90

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_private_subnet_ids
    security_groups  = [var.app_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.portal[0].arn
    container_name   = "portal"
    container_port   = 8000
  }

  depends_on = [aws_lb_listener.http_plte, aws_lb_listener.https, aws_route.app_default]
}

resource "aws_ecr_lifecycle_policy" "parser" {
  repository = aws_ecr_repository.parser.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Retain the newest ten parser images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "migration" {
  repository = aws_ecr_repository.migration.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Retain the newest ten migration images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
