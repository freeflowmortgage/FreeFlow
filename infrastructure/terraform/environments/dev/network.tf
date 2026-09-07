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
