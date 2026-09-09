data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_vpc" "existing" {
  id = var.vpc_id
}

data "aws_prefix_list" "s3" {
  name = "com.amazonaws.${var.aws_region}.s3"
}

data "aws_subnet" "public" {
  for_each = toset(var.public_subnet_ids)
  id       = each.value
}

data "aws_subnet" "app" {
  for_each = toset(var.app_private_subnet_ids)
  id       = each.value
}

data "aws_route_table" "app" {
  for_each  = toset(var.app_private_subnet_ids)
  subnet_id = each.value
}

data "aws_ecs_cluster" "existing" {
  cluster_name = var.ecs_cluster_name
}

data "aws_db_instance" "existing" {
  db_instance_identifier = var.rds_instance_identifier
}

data "aws_ecr_repository" "portal" {
  name = var.portal_repository_name
}

data "aws_route53_zone" "public" {
  count   = var.enable_edge && (var.enable_https_certificate || var.enable_cognito_edge) && !var.create_hosted_zone && !var.dns_managed_externally ? 1 : 0
  zone_id = var.hosted_zone_id
}

locals {
  name_prefix           = "freeflow-${var.environment}"
  public_hosted_zone_id = var.create_hosted_zone ? aws_route53_zone.public[0].zone_id : (var.dns_managed_externally ? null : ((var.enable_https_certificate || var.enable_cognito_edge) ? data.aws_route53_zone.public[0].zone_id : null))
  rds_master_secret_arn = data.aws_db_instance.existing.master_user_secret[0].secret_arn
  rds_endpoint          = data.aws_db_instance.existing.address
  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "FREEFLOW_RUNTIME_ENV", value = var.enable_cognito_edge ? "staging" : "development" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "LOG_LEVEL", value = "info" },
  ]
}
