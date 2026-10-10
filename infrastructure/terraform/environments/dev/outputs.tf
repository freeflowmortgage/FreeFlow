output "portal_repository_url" {
  value = data.aws_ecr_repository.portal.repository_url
}

output "parser_repository_url" {
  value = aws_ecr_repository.parser.repository_url
}

output "console_repository_url" {
  value = aws_ecr_repository.console.repository_url
}

output "migration_repository_url" {
  value = aws_ecr_repository.migration.repository_url
}

output "connector_repository_url" {
  value = aws_ecr_repository.connector.repository_url
}

output "connector_private_url" {
  value = var.enable_encompass_connector ? "http://encompass-connector.freeflow.local:8080" : null
}

output "connector_log_group_name" {
  value = aws_cloudwatch_log_group.connector.name
}

output "connector_task_definition_arn" {
  value = var.enable_encompass_connector ? aws_ecs_task_definition.connector[0].arn : null
}

output "connector_binding_bootstrap_task_definition_arn" {
  value = var.enable_encompass_connector ? aws_ecs_task_definition.connector_binding_bootstrap[0].arn : null
}

output "connector_security_group_id" {
  value = var.enable_encompass_connector ? aws_security_group.connector[0].id : null
}

output "connector_service_name" {
  value = var.enable_encompass_connector ? aws_ecs_service.connector[0].name : null
}

output "portal_url" {
  value = var.enable_edge ? (var.enable_cognito_edge ? "https://${var.portal_hostname}" : "http://${aws_lb.portal[0].dns_name}") : null
}

output "console_url" {
  value = var.enable_edge && var.enable_console && !var.enable_cognito_edge ? "http://${aws_lb.portal[0].dns_name}:3000" : null
}

output "load_balancer_dns_name" {
  value = var.enable_edge ? aws_lb.portal[0].dns_name : null
}

output "cognito_user_pool_id" {
  value = var.enable_edge && var.enable_cognito_edge ? aws_cognito_user_pool.live_test[0].id : null
}

output "cognito_login_domain" {
  value = var.enable_edge && var.enable_cognito_edge ? "https://${aws_cognito_user_pool_domain.live_test[0].domain}.auth.${var.aws_region}.amazoncognito.com" : null
}

output "public_hosted_zone_id" {
  value = var.create_hosted_zone || var.enable_cognito_edge ? local.public_hosted_zone_id : null
}

output "public_hosted_zone_name_servers" {
  value = var.create_hosted_zone ? aws_route53_zone.public[0].name_servers : []
}

output "external_acm_validation_records" {
  description = "DNS CNAME records to add at the external DNS provider before enabling the HTTPS listener."
  value = var.enable_edge && (var.enable_https_certificate || var.enable_cognito_edge) && var.dns_managed_externally ? [
    for option in aws_acm_certificate.portal[0].domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ] : []
}

output "external_portal_dns_record" {
  description = "CNAME record to add at the external DNS provider after the HTTPS/Cognito edge is active."
  value = var.enable_edge && var.enable_cognito_edge && var.dns_managed_externally ? {
    name  = trimsuffix(var.portal_hostname, ".${var.domain_name}")
    type  = "CNAME"
    value = aws_lb.portal[0].dns_name
  } : null
}

output "migration_task_definition_arn" {
  value = var.enable_services && var.enable_edge ? aws_ecs_task_definition.migration[0].arn : null
}

output "database_preflight_task_definition_arn" {
  value = var.enable_services && var.enable_edge ? aws_ecs_task_definition.database_preflight[0].arn : null
}

output "ecs_cluster_arn" {
  value = data.aws_ecs_cluster.existing.arn
}

output "app_private_subnet_ids" {
  value = var.app_private_subnet_ids
}

output "app_security_group_id" {
  value = var.app_security_group_id
}

output "operations_dashboard_name" {
  value = var.enable_monitoring ? aws_cloudwatch_dashboard.operations[0].dashboard_name : null
}

output "operations_alert_topic_arn" {
  value = var.enable_monitoring ? aws_sns_topic.operations[0].arn : null
}

output "github_image_publisher_role_arn" {
  value = var.enable_github_image_publisher ? aws_iam_role.github_image_publisher[0].arn : null
}
