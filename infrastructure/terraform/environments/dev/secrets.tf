resource "random_password" "database_app" {
  length  = 40
  special = false
}

resource "random_password" "database_migrator" {
  length  = 40
  special = false
}

resource "random_password" "field_encryption" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "database_app" {
  name                    = "${local.name_prefix}/database-app"
  description             = "Restricted synthetic dev database application login"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_app" {
  secret_id = aws_secretsmanager_secret.database_app.id
  secret_string = jsonencode({
    username = "freeflow_app_login"
    password = random_password.database_app.result
    url      = "postgresql://freeflow_app_login:${random_password.database_app.result}@${local.rds_endpoint}:5432/mortgage_dev?sslmode=require"
  })
}

resource "aws_secretsmanager_secret" "database_migrator" {
  name                    = "${local.name_prefix}/database-migrator"
  description             = "Restricted synthetic dev database migration login"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_migrator" {
  secret_id = aws_secretsmanager_secret.database_migrator.id
  secret_string = jsonencode({
    username = "freeflow_migrator_login"
    password = random_password.database_migrator.result
    url      = "postgresql://freeflow_migrator_login:${random_password.database_migrator.result}@${local.rds_endpoint}:5432/mortgage_dev?sslmode=require"
  })
}

resource "aws_secretsmanager_secret" "field_encryption" {
  name                    = "${local.name_prefix}/field-encryption-key"
  description             = "Synthetic dev application field-encryption key"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "field_encryption" {
  secret_id     = aws_secretsmanager_secret.field_encryption.id
  secret_string = random_password.field_encryption.result
}

# Terraform creates only the secret container. Populate its value through the
# approved secrets workflow; never place an ICE API secret in tfvars or state.
resource "aws_secretsmanager_secret" "encompass_api_client" {
  name                    = "${local.name_prefix}/encompass-api-client-secret"
  description             = "ICE Encompass Developer Connect client secret for the synthetic dev worker"
  recovery_window_in_days = 7
}
