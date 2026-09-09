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
# its image and emit logs.  The console may use HTTPS only to these VPC
# endpoints; it receives no unrestricted internet egress.
resource "aws_security_group" "console_aws_endpoints" {
  count       = var.enable_console ? 1 : 0
  name        = "${local.name_prefix}-console-aws-endpoints-sg"
  description = "Private AWS API endpoints reachable from the underwriting console"
  vpc_id      = data.aws_vpc.existing.id

  ingress {
    description     = "HTTPS from underwriting console"
    protocol        = "tcp"
    from_port       = 443
    to_port         = 443
    security_groups = [aws_security_group.console[0].id]
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

resource "aws_vpc_endpoint" "console_ecr_api" {
  count               = var.enable_console ? 1 : 0
  vpc_id              = data.aws_vpc.existing.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = var.app_private_subnet_ids
  security_group_ids  = [aws_security_group.console_aws_endpoints[0].id]
}

resource "aws_vpc_endpoint" "console_ecr_dkr" {
  count               = var.enable_console ? 1 : 0
  vpc_id              = data.aws_vpc.existing.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = var.app_private_subnet_ids
  security_group_ids  = [aws_security_group.console_aws_endpoints[0].id]
}

resource "aws_vpc_endpoint" "console_logs" {
  count               = var.enable_console ? 1 : 0
  vpc_id              = data.aws_vpc.existing.id
  service_name        = "com.amazonaws.${var.aws_region}.logs"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = var.app_private_subnet_ids
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
