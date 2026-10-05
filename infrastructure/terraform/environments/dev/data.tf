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
  name_prefix                       = "freeflow-${var.environment}"
  synthetic_connector_tenant_id     = "00000000-0000-4000-8000-000000000100"
  synthetic_connector_lender_id     = "freeflow-dev"
  synthetic_connector_deployment_id = "freeflow-dev"
  connector_service_auth_kind       = var.encompass_connector_service_auth_kind != "" ? var.encompass_connector_service_auth_kind : "bearer-stub-non-prod"
  public_hosted_zone_id             = var.create_hosted_zone ? aws_route53_zone.public[0].zone_id : (var.dns_managed_externally ? null : ((var.enable_https_certificate || var.enable_cognito_edge) ? data.aws_route53_zone.public[0].zone_id : null))
  rds_master_secret_arn             = data.aws_db_instance.existing.master_user_secret[0].secret_arn
  rds_endpoint                      = data.aws_db_instance.existing.address
  # freeflow-dev already serves app.dev.freeflowmortgage.com on the same ALB.
  # Keep that hostname in config so a later apply does not drop the certificate
  # SAN or the Cognito callback and logout URLs. Do not apply while that edge
  # change is on hold.
  freeflow_dev_software_hostnames = var.portal_hostname == "dev.freeflowmortgage.com" ? ["app.dev.freeflowmortgage.com"] : []
  portal_extra_hostnames          = distinct(concat(var.portal_app_hostnames, local.freeflow_dev_software_hostnames))
  portal_public_hostnames         = distinct(concat([var.portal_hostname], local.portal_extra_hostnames))
  portal_callback_urls            = [for host in local.portal_public_hostnames : "https://${host}/oauth2/idpresponse"]
  portal_logout_urls              = [for host in local.portal_public_hostnames : "https://${host}/"]
  console_frame_ancestors = length(local.portal_extra_hostnames) == 0 ? var.encompass_frame_ancestors : join(" ", compact(concat(
    split(" ", trimspace(var.encompass_frame_ancestors)),
    [for host in local.portal_extra_hostnames : "https://${host}"],
  )))
  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "FREEFLOW_RUNTIME_ENV", value = var.enable_cognito_edge ? "staging" : "development" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "LOG_LEVEL", value = "info" },
  ]
}
