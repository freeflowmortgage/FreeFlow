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
  execution_role_arn       = aws_iam_role.parser_execution.arn
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
        capabilities       = { add = [], drop = ["ALL"] }
      }
      environment = [
        { name = "TMPDIR", value = "/tmp/freeflow" },
        { name = "PYTHONDONTWRITEBYTECODE", value = "1" },
        { name = "PYTHONUNBUFFERED", value = "1" },
        # About 160s at 3.2s per scanned page, inside the 180s ALB idle timeout.
        { name = "OCR_PAGE_BUDGET", value = "50" },
      ]
      secrets = [
        { name = "DOCUMENT_ID_HMAC_KEY", valueFrom = aws_secretsmanager_secret.document_id_hmac[0].arn },
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
        command     = ["CMD-SHELL", "python3.11 -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)\""]
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
        capabilities       = { add = [], drop = ["ALL"] }
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
        ], var.enable_encompass_document_pull_worker ? [
        { name = "DOCUMENT_PULL_QUEUE_URL", value = aws_sqs_queue.document_pull[0].url },
        ] : [], var.enable_cognito_edge ? [
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

resource "aws_ecs_task_definition" "connector" {
  count = var.enable_encompass_connector ? 1 : 0

  family                   = "${local.name_prefix}-encompass-connector"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.connector_execution.arn
  task_role_arn            = aws_iam_role.connector_task.arn

  depends_on = [
    aws_secretsmanager_secret_version.connector_service_token,
    aws_secretsmanager_secret_version.connector_service_signing_key,
  ]

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "connector-tmp"
  }

  container_definitions = jsonencode([{
    name                   = "encompass-connector"
    image                  = var.connector_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "1001"
    linuxParameters = {
      initProcessEnabled = true
      capabilities       = { add = [], drop = ["ALL"] }
    }
    environment = [
      # The synthetic Bearer path is explicit development-only configuration.
      # Its service token is distinct from database and future LOS credentials.
      { name = "NODE_ENV", value = "development" },
      { name = "FREEFLOW_RUNTIME_ENV", value = "development" },
      { name = "PORT", value = "8080" },
      { name = "LOG_LEVEL", value = "info" },
      { name = "CONNECTOR_MODE", value = var.encompass_connector_mode },
      { name = "CONNECTOR_BOUND_TENANT_ID", value = local.synthetic_connector_tenant_id },
      { name = "CONNECTOR_SERVICE_AUTH_KIND", value = local.connector_real_encompass ? "signed-replay" : "bearer-stub-non-prod" },
      { name = "CONNECTOR_SIGNED_SERVICE_ID", value = "freeflow-connector-smoke" },
    ]
    secrets = concat([
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database_connector.arn}:url::" },
      { name = "CONNECTOR_SERVICE_TOKEN", valueFrom = aws_secretsmanager_secret.connector_service_token[0].arn },
      { name = "CONNECTOR_SIGNING_KEY", valueFrom = aws_secretsmanager_secret.connector_service_signing_key[0].arn },
      ], local.connector_real_encompass ? [
      { name = "ENCOMPASS_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.connector_encompass_credentials[0].arn}:clientId::" },
      { name = "ENCOMPASS_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.connector_encompass_credentials[0].arn}:clientSecret::" },
      { name = "ENCOMPASS_INSTANCE_ID", valueFrom = "${aws_secretsmanager_secret.connector_encompass_credentials[0].arn}:instanceId::" },
    ] : [])
    portMappings = [{
      name          = "http"
      containerPort = 8080
      hostPort      = 8080
      protocol      = "tcp"
    }]
    mountPoints = [{
      sourceVolume  = "connector-tmp"
      containerPath = "/tmp"
      readOnly      = false
    }]
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.connector.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "connector_binding_bootstrap" {
  count = var.enable_encompass_connector ? 1 : 0

  family                   = "${local.name_prefix}-encompass-connector-binding-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.migration_execution.arn
  task_role_arn            = aws_iam_role.migration_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "connector-binding-bootstrap"
    image                  = var.connector_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "1001"
    command                = ["node", "dist/bootstrapSyntheticBinding.js"]
    linuxParameters = {
      initProcessEnabled = true
      capabilities       = { add = [], drop = ["ALL"] }
    }
    environment = [
      { name = "NODE_ENV", value = "development" },
      { name = "FREEFLOW_RUNTIME_ENV", value = "development" },
      { name = "CONNECTOR_BOUND_TENANT_ID", value = local.synthetic_connector_tenant_id },
      { name = "CONNECTOR_BOUND_LENDER_ID", value = local.synthetic_connector_lender_id },
      { name = "CONNECTOR_BOUND_DEPLOYMENT_ID", value = local.synthetic_connector_deployment_id },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database_migrator.arn}:url::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.connector.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "binding-bootstrap"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "document_pull_worker" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  family                   = "${local.name_prefix}-document-pull-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.document_pull_worker_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "document-pull-worker"
    image                  = var.portal_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "1001"
    linuxParameters = {
      initProcessEnabled = true
      capabilities       = { add = [], drop = ["ALL"] }
    }
    workingDirectory = "/app/apps/underwriter-portal"
    command          = ["node", "/app/apps/underwriter-portal/workers/document-pull-worker.cjs"]
    environment = [
      { name = "DOC_PARSER_SERVICE_URL", value = "http://income-parser.freeflow.local:8080/parse" },
      { name = "DOCUMENT_PULL_QUEUE_URL", value = aws_sqs_queue.document_pull[0].url },
      { name = "ENCOMPASS_CONNECTOR_SERVICE_URL", value = "http://encompass-connector.freeflow.local:8080" },
      { name = "ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID", value = "freeflow-connector-smoke" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database_connector.arn}:url::" },
      { name = "ENCOMPASS_CONNECTOR_SIGNING_KEY", valueFrom = aws_secretsmanager_secret.connector_service_signing_key[0].arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.document_pull_worker[0].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "encompass_sync_worker" {
  count = var.enable_encompass_sync_worker ? 1 : 0

  family                   = "${local.name_prefix}-encompass-sync-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.encompass_sync_worker_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "encompass-sync-worker"
    image                  = var.portal_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "1001"
    linuxParameters = {
      initProcessEnabled = true
      capabilities       = { add = [], drop = ["ALL"] }
    }
    workingDirectory = "/app/apps/underwriter-portal"
    command          = ["node", "/app/apps/underwriter-portal/workers/encompass-sync-worker.cjs"]
    environment = [
      { name = "APP_ORIGIN", value = var.enable_cognito_edge ? "https://${var.portal_hostname}" : "http://${aws_lb.portal[0].dns_name}" },
      { name = "SYNC_QUEUE_URL", value = aws_sqs_queue.sync.url },
      { name = "ENCOMPASS_CONNECTOR_SERVICE_URL", value = "http://encompass-connector.freeflow.local:8080" },
      { name = "ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID", value = "freeflow-connector-smoke" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database_connector.arn}:url::" },
      { name = "ENCOMPASS_CONNECTOR_SIGNING_KEY", valueFrom = aws_secretsmanager_secret.connector_service_signing_key[0].arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.encompass_sync_worker[0].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "console" {
  count = var.enable_services && var.enable_edge && var.enable_console ? 1 : 0

  family                   = "${local.name_prefix}-underwriting-console"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.console_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "console-tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = "console-init"
      image                  = var.console_image
      essential              = false
      readonlyRootFilesystem = true
      user                   = "0"
      entryPoint             = ["/bin/sh", "-c"]
      command                = ["set -eu; mkdir -p /tmp/freeflow; chown -R 1001:1001 /tmp/freeflow"]
      mountPoints = [{
        sourceVolume  = "console-tmp"
        containerPath = "/tmp/freeflow"
        readOnly      = false
      }]
    },
    {
      name                   = "underwriting-console"
      image                  = var.console_image
      essential              = true
      readonlyRootFilesystem = true
      user                   = "1001"
      dependsOn = [{
        containerName = "console-init"
        condition     = "SUCCESS"
      }]
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { add = [], drop = ["ALL"] }
      }
      environment = [
        { name = "PORT", value = "3000" },
        { name = "FREEFLOW_RUNTIME_MODE", value = "protected" },
      ]
      command = ["node", "/app/serve-production.mjs"]
      portMappings = [{
        name          = "http"
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      mountPoints = [{
        sourceVolume  = "console-tmp"
        containerPath = "/tmp/freeflow"
        readOnly      = false
      }]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.console.name
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
        capabilities       = { add = [], drop = ["ALL"] }
      }
      environment = [
        { name = "PGHOST", value = local.rds_endpoint },
        { name = "PGPORT", value = "5432" },
        { name = "PGDATABASE", value = "mortgage_dev" },
        { name = "APP_USERNAME", value = "freeflow_app_login" },
        { name = "MIGRATOR_USERNAME", value = "freeflow_migrator_login" },
        { name = "CONNECTOR_USERNAME", value = "freeflow_connector_login" },
      ]
      secrets = [
        { name = "PGUSER", valueFrom = "${local.rds_master_secret_arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${local.rds_master_secret_arn}:password::" },
        { name = "APP_PASSWORD", valueFrom = "${aws_secretsmanager_secret.database_app.arn}:password::" },
        { name = "MIGRATOR_PASSWORD", valueFrom = "${aws_secretsmanager_secret.database_migrator.arn}:password::" },
        { name = "MIGRATOR_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.database_migrator.arn}:url::" },
        { name = "CONNECTOR_PASSWORD", valueFrom = "${aws_secretsmanager_secret.database_connector.arn}:password::" },
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

resource "aws_ecs_task_definition" "database_preflight" {
  count = var.enable_services && var.enable_edge ? 1 : 0

  family                   = "${local.name_prefix}-database-preflight"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.migration_execution.arn
  task_role_arn            = aws_iam_role.migration_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name                   = "database-preflight"
      image                  = var.migration_image
      essential              = true
      readonlyRootFilesystem = true
      user                   = "1001"
      entryPoint             = ["/bin/sh", "-c"]
      command = [join("\n", [
        "set -eu",
        "export PGSSLMODE=require",
        "database_exists=\"$(psql --dbname=postgres --tuples-only --no-align --command=\"SELECT 1 FROM pg_database WHERE datname = 'mortgage_dev'\")\"",
        "if [ \"$database_exists\" != \"1\" ]; then echo 'PREFLIGHT_DATABASE=ABSENT'; exit 0; fi",
        "tables=\"$(psql --dbname=\"$PGDATABASE\" --tuples-only --no-align --command=\"SELECT format('%I.%I', schemaname, relname) FROM pg_stat_user_tables ORDER BY 1\")\"",
        "total=0",
        "for table in $tables; do rows=\"$(psql --dbname=\"$PGDATABASE\" --tuples-only --no-align --command=\"SELECT count(*) FROM $table\")\"; echo \"PREFLIGHT_TABLE=$table ROWS=$rows\"; total=$((total + rows)); done",
        "echo \"PREFLIGHT_TOTAL_ROWS=$total\"",
        "if [ \"$total\" -ne 0 ]; then exit 42; fi",
      ])]
      environment = [
        { name = "PGHOST", value = local.rds_endpoint },
        { name = "PGPORT", value = "5432" },
        { name = "PGDATABASE", value = "mortgage_dev" },
      ]
      secrets = [
        { name = "PGUSER", valueFrom = "${local.rds_master_secret_arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${local.rds_master_secret_arn}:password::" },
      ]
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { add = [], drop = ["ALL"] }
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.migration.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "preflight"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "parser" {
  count = var.enable_services && var.enable_edge && var.enable_parser ? 1 : 0

  name            = "${local.name_prefix}-income-parser"
  cluster         = data.aws_ecs_cluster.existing.arn
  task_definition = aws_ecs_task_definition.parser[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"
  # Pin application rollouts so an image change cannot also upgrade Fargate.
  platform_version = "1.4.0"

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

  name            = "${local.name_prefix}-portal"
  cluster         = data.aws_ecs_cluster.existing.arn
  task_definition = aws_ecs_task_definition.portal[0].arn
  desired_count   = var.portal_desired_count
  launch_type     = "FARGATE"
  # Keep portal application rollouts from silently changing the Fargate
  # platform version. Upgrade the platform through its own reviewed dev plan.
  platform_version                  = "1.4.0"
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

resource "aws_ecs_service" "connector" {
  count = var.enable_encompass_connector ? 1 : 0

  name             = "${local.name_prefix}-encompass-connector"
  cluster          = data.aws_ecs_cluster.existing.arn
  task_definition  = aws_ecs_task_definition.connector[0].arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "1.4.0"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_private_subnet_ids
    security_groups  = [aws_security_group.connector[0].id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.connector[0].arn
  }

  depends_on = [
    aws_route.app_default,
    aws_vpc_endpoint.console_ecr_api,
    aws_vpc_endpoint.console_ecr_dkr,
    aws_vpc_endpoint.console_logs,
    aws_vpc_endpoint.connector_secretsmanager,
  ]
}

resource "aws_ecs_service" "document_pull_worker" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  name             = "${local.name_prefix}-document-pull-worker"
  cluster          = data.aws_ecs_cluster.existing.arn
  task_definition  = aws_ecs_task_definition.document_pull_worker[0].arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "1.4.0"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_private_subnet_ids
    security_groups  = [var.app_security_group_id]
    assign_public_ip = false
  }

  depends_on = [aws_ecs_service.parser, aws_route.app_default]
}

resource "aws_ecs_service" "encompass_sync_worker" {
  count = var.enable_encompass_sync_worker ? 1 : 0

  name             = "${local.name_prefix}-encompass-sync-worker"
  cluster          = data.aws_ecs_cluster.existing.arn
  task_definition  = aws_ecs_task_definition.encompass_sync_worker[0].arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "1.4.0"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_private_subnet_ids
    security_groups  = [var.app_security_group_id]
    assign_public_ip = false
  }

  depends_on = [aws_ecs_service.connector, aws_route.app_default]
}

resource "aws_lb_target_group" "console" {
  count = var.enable_edge && var.enable_console ? 1 : 0

  name        = "${local.name_prefix}-console"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.existing.id

  health_check {
    enabled             = true
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_ecs_service" "console" {
  count = var.enable_services && var.enable_edge && var.enable_console ? 1 : 0

  name                              = "${local.name_prefix}-underwriting-console"
  cluster                           = data.aws_ecs_cluster.existing.arn
  task_definition                   = aws_ecs_task_definition.console[0].arn
  desired_count                     = 1
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 90

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_private_subnet_ids
    security_groups  = [aws_security_group.console[0].id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.console[0].arn
    container_name   = "underwriting-console"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.console_plte, aws_route.app_default]
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

resource "aws_ecr_lifecycle_policy" "console" {
  repository = aws_ecr_repository.console.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Retain the newest ten console images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "connector" {
  repository = aws_ecr_repository.connector.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest 10 connector images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
