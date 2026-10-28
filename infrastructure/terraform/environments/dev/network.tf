resource "aws_route" "app_default" {
  for_each = data.aws_route_table.app

  route_table_id         = each.value.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = var.nat_gateway_id
}

resource "aws_security_group" "parser" {
  name        = "${local.name_prefix}-parser-sg"
  description = "Income parser accepts traffic only from the portal service"
  vpc_id      = data.aws_vpc.existing.id

  ingress {
    description     = "Portal to income parser"
    protocol        = "tcp"
    from_port       = 8080
    to_port         = 8080
    security_groups = [var.app_security_group_id]
  }

  egress {
    description = "Image pulls, logs, package runtime dependencies, and ALB public-key verification"
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Console access is managed by the standalone rule below.  Keeping the
  # pre-existing portal rule inline avoids replacing it during this temporary
  # PLTE extension.
  lifecycle {
    ignore_changes = [ingress]
  }
}

resource "aws_security_group" "connector" {
  count       = var.enable_encompass_connector ? 1 : 0
  name        = "${local.name_prefix}-encompass-connector-sg"
  description = "Internal connector reachable only from FreeFlow application tasks"
  vpc_id      = data.aws_vpc.existing.id

  ingress {
    description     = "FreeFlow application tasks to connector"
    protocol        = "tcp"
    from_port       = 8080
    to_port         = 8080
    security_groups = [var.app_security_group_id]
  }

}

resource "aws_security_group_rule" "database_from_connector" {
  for_each = var.enable_encompass_connector ? toset(data.aws_db_instance.existing.vpc_security_groups) : toset([])

  type                     = "ingress"
  description              = "PostgreSQL from the custom Encompass connector"
  protocol                 = "tcp"
  from_port                = 5432
  to_port                  = 5432
  security_group_id        = each.value
  source_security_group_id = aws_security_group.connector[0].id
}

resource "aws_security_group_rule" "connector_to_database" {
  for_each                 = var.enable_encompass_connector ? toset(data.aws_db_instance.existing.vpc_security_groups) : toset([])
  type                     = "egress"
  description              = "Connector worker login to PostgreSQL"
  protocol                 = "tcp"
  from_port                = 5432
  to_port                  = 5432
  security_group_id        = aws_security_group.connector[0].id
  source_security_group_id = each.value
}

resource "aws_security_group_rule" "connector_dns_udp" {
  count             = var.enable_encompass_connector ? 1 : 0
  type              = "egress"
  description       = "DNS over UDP to the VPC resolver"
  protocol          = "udp"
  from_port         = 53
  to_port           = 53
  security_group_id = aws_security_group.connector[0].id
  cidr_blocks       = ["${cidrhost(data.aws_vpc.existing.cidr_block, 2)}/32"]
}

resource "aws_security_group_rule" "connector_dns_tcp" {
  count             = var.enable_encompass_connector ? 1 : 0
  type              = "egress"
  description       = "DNS over TCP to the VPC resolver"
  protocol          = "tcp"
  from_port         = 53
  to_port           = 53
  security_group_id = aws_security_group.connector[0].id
  cidr_blocks       = ["${cidrhost(data.aws_vpc.existing.cidr_block, 2)}/32"]
}

resource "aws_security_group_rule" "connector_to_aws_endpoints" {
  count                    = var.enable_encompass_connector ? 1 : 0
  type                     = "egress"
  description              = "HTTPS from connector to private AWS endpoints"
  protocol                 = "tcp"
  from_port                = 443
  to_port                  = 443
  security_group_id        = aws_security_group.connector[0].id
  source_security_group_id = aws_security_group.console_aws_endpoints[0].id
}

resource "aws_security_group_rule" "connector_to_s3_image_layers" {
  count             = var.enable_encompass_connector ? 1 : 0
  type              = "egress"
  description       = "HTTPS from connector to private S3 image layers"
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  security_group_id = aws_security_group.connector[0].id
  prefix_list_ids   = [data.aws_prefix_list.s3.id]
}

resource "aws_security_group_rule" "connector_to_encompass_dev" {
  count             = local.connector_real_encompass ? 1 : 0
  type              = "egress"
  description       = "Development-only HTTPS from connector to Encompass through NAT"
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  security_group_id = aws_security_group.connector[0].id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group" "console" {
  count       = var.enable_console ? 1 : 0
  name        = "${local.name_prefix}-console-sg"
  description = "Temporary underwriting console reachable only through the IP-restricted PLTE ALB"
  vpc_id      = data.aws_vpc.existing.id

  egress {
    description     = "Console to income parser only"
    protocol        = "tcp"
    from_port       = 8080
    to_port         = 8080
    security_groups = [aws_security_group.parser.id]
  }

  # Additional console egress is managed as standalone, destination-scoped
  # rules below. Preserve it while retaining the original parser rule inline.
  lifecycle {
    ignore_changes = [egress]
  }

}

resource "aws_security_group_rule" "parser_from_console" {
  count                    = var.enable_console ? 1 : 0
  type                     = "ingress"
  description              = "Underwriting console to income parser"
  protocol                 = "tcp"
  from_port                = 8080
  to_port                  = 8080
  security_group_id        = aws_security_group.parser.id
  source_security_group_id = aws_security_group.console[0].id
}

# Keep the temporary console private while still allowing Fargate to retrieve
# its image and emit logs. Private DNS makes these endpoints the ECR and Logs
# path for every task in the VPC, so the portal application group must also be
# admitted while the endpoints exist.
resource "aws_security_group" "console_aws_endpoints" {
  count       = local.private_aws_endpoints_enabled ? 1 : 0
  name        = "${local.name_prefix}-console-aws-endpoints-sg"
  description = "Private AWS API endpoints reachable from the underwriting console"
  vpc_id      = data.aws_vpc.existing.id

  ingress {
    description = "HTTPS from underwriting console, portal, and income parser"
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    security_groups = concat(
      [var.app_security_group_id, aws_security_group.parser.id],
      var.enable_console ? [aws_security_group.console[0].id] : [],
      var.enable_encompass_connector ? [aws_security_group.connector[0].id] : [],
      var.enable_outbound_webhook_worker ? [aws_security_group.outbound_webhook_worker[0].id] : [],
    )
  }
}

resource "aws_security_group_rule" "console_to_aws_endpoints" {
  count                    = var.enable_console ? 1 : 0
  type                     = "egress"
  description              = "HTTPS from console to private AWS endpoints"
  protocol                 = "tcp"
  from_port                = 443
  to_port                  = 443
  security_group_id        = aws_security_group.console[0].id
  source_security_group_id = aws_security_group.console_aws_endpoints[0].id
}

resource "aws_security_group_rule" "console_to_s3_image_layers" {
  count             = var.enable_console ? 1 : 0
  type              = "egress"
  description       = "HTTPS from console to private S3 image layers"
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  security_group_id = aws_security_group.console[0].id
  prefix_list_ids   = [data.aws_prefix_list.s3.id]
}

# Cost: interface endpoints bill per AZ-hour ($0.01 each). Dev keeps them in a
# single AZ; tasks in the other AZ reach them cross-AZ. Not for production.
locals {
  interface_endpoint_subnet_ids = slice(var.app_private_subnet_ids, 0, 1)
}

resource "aws_vpc_endpoint" "console_ecr_api" {
  count               = local.private_aws_endpoints_enabled ? 1 : 0
  vpc_id              = data.aws_vpc.existing.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = local.interface_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.console_aws_endpoints[0].id]
}

resource "aws_vpc_endpoint" "console_ecr_dkr" {
  count               = local.private_aws_endpoints_enabled ? 1 : 0
  vpc_id              = data.aws_vpc.existing.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = local.interface_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.console_aws_endpoints[0].id]
}

resource "aws_vpc_endpoint" "console_logs" {
  count               = local.private_aws_endpoints_enabled ? 1 : 0
  vpc_id              = data.aws_vpc.existing.id
  service_name        = "com.amazonaws.${var.aws_region}.logs"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = local.interface_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.console_aws_endpoints[0].id]
}

resource "aws_vpc_endpoint" "connector_secretsmanager" {
  count               = var.enable_encompass_connector || var.enable_outbound_webhook_worker ? 1 : 0
  vpc_id              = data.aws_vpc.existing.id
  service_name        = "com.amazonaws.${var.aws_region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = local.interface_endpoint_subnet_ids
  security_group_ids  = [aws_security_group.console_aws_endpoints[0].id]
}

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "freeflow.local"
  description = "Private ECS service discovery for FreeFlow synthetic dev testing"
  vpc         = data.aws_vpc.existing.id
}

resource "aws_service_discovery_service" "parser" {
  name = "income-parser"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_service_discovery_service" "connector" {
  count = var.enable_encompass_connector ? 1 : 0
  name  = "encompass-connector"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# The webhook worker is the only task that sends tenant data to customer
# systems, so it gets its own group whose internet egress is limited to the
# customer receiver ranges. The application-layer allowlist and DNS pinning
# still apply on top of this.
resource "aws_security_group" "outbound_webhook_worker" {
  count       = var.enable_outbound_webhook_worker ? 1 : 0
  name        = "${local.name_prefix}-outbound-webhook-worker-sg"
  description = "Outbound income webhook worker with customer-scoped HTTPS egress"
  vpc_id      = data.aws_vpc.existing.id
}

resource "aws_security_group_rule" "outbound_webhook_worker_to_customers" {
  count             = var.enable_outbound_webhook_worker ? 1 : 0
  type              = "egress"
  description       = "HTTPS to approved customer webhook receivers through NAT"
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  security_group_id = aws_security_group.outbound_webhook_worker[0].id
  cidr_blocks       = var.outbound_webhook_egress_cidrs
}

resource "aws_security_group_rule" "outbound_webhook_worker_to_aws_endpoints" {
  count                    = var.enable_outbound_webhook_worker ? 1 : 0
  type                     = "egress"
  description              = "HTTPS to private ECR, Logs, and Secrets Manager endpoints"
  protocol                 = "tcp"
  from_port                = 443
  to_port                  = 443
  security_group_id        = aws_security_group.outbound_webhook_worker[0].id
  source_security_group_id = aws_security_group.console_aws_endpoints[0].id
}

resource "aws_security_group_rule" "outbound_webhook_worker_to_s3_image_layers" {
  count             = var.enable_outbound_webhook_worker ? 1 : 0
  type              = "egress"
  description       = "HTTPS to private S3 image layers"
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  security_group_id = aws_security_group.outbound_webhook_worker[0].id
  prefix_list_ids   = [data.aws_prefix_list.s3.id]
}

resource "aws_security_group_rule" "outbound_webhook_worker_dns_udp" {
  count             = var.enable_outbound_webhook_worker ? 1 : 0
  type              = "egress"
  description       = "DNS over UDP to the VPC resolver"
  protocol          = "udp"
  from_port         = 53
  to_port           = 53
  security_group_id = aws_security_group.outbound_webhook_worker[0].id
  cidr_blocks       = ["${cidrhost(data.aws_vpc.existing.cidr_block, 2)}/32"]
}

resource "aws_security_group_rule" "outbound_webhook_worker_dns_tcp" {
  count             = var.enable_outbound_webhook_worker ? 1 : 0
  type              = "egress"
  description       = "DNS over TCP to the VPC resolver"
  protocol          = "tcp"
  from_port         = 53
  to_port           = 53
  security_group_id = aws_security_group.outbound_webhook_worker[0].id
  cidr_blocks       = ["${cidrhost(data.aws_vpc.existing.cidr_block, 2)}/32"]
}

resource "aws_security_group_rule" "outbound_webhook_worker_to_database" {
  for_each                 = var.enable_outbound_webhook_worker ? toset(data.aws_db_instance.existing.vpc_security_groups) : toset([])
  type                     = "egress"
  description              = "Webhook worker login to PostgreSQL"
  protocol                 = "tcp"
  from_port                = 5432
  to_port                  = 5432
  security_group_id        = aws_security_group.outbound_webhook_worker[0].id
  source_security_group_id = each.value
}

resource "aws_security_group_rule" "database_from_outbound_webhook_worker" {
  for_each                 = var.enable_outbound_webhook_worker ? toset(data.aws_db_instance.existing.vpc_security_groups) : toset([])
  type                     = "ingress"
  description              = "PostgreSQL from the outbound webhook worker"
  protocol                 = "tcp"
  from_port                = 5432
  to_port                  = 5432
  security_group_id        = each.value
  source_security_group_id = aws_security_group.outbound_webhook_worker[0].id
}
