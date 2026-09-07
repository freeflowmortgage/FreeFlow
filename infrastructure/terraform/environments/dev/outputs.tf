output "portal_repository_url" {
  value = data.aws_ecr_repository.portal.repository_url
}

output "parser_repository_url" {
  value = aws_ecr_repository.parser.repository_url
}

output "migration_repository_url" {
  value = aws_ecr_repository.migration.repository_url
}

output "portal_url" {
  value = var.enable_edge ? (var.enable_cognito_edge ? "https://${var.portal_hostname}" : "http://${aws_lb.portal[0].dns_name}") : null
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

output "migration_task_definition_arn" {
  value = var.enable_services && var.enable_edge ? aws_ecs_task_definition.migration[0].arn : null
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
