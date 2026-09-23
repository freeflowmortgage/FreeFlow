resource "random_password" "database_app" {
  length  = 40
  special = false
}

resource "random_password" "database_migrator" {
  length  = 40
  special = false
}

resource "random_password" "database_connector" {
  length  = 40
  special = false
}

resource "random_password" "connector_service_token" {
  count = var.enable_encompass_connector ? 1 : 0

  length  = 64
  special = false
}

resource "random_password" "connector_service_signing_key" {
  count = var.enable_encompass_connector ? 1 : 0

  length  = 64
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

resource "aws_secretsmanager_secret" "database_connector" {
  name                    = "${local.name_prefix}/database-encompass-connector"
  description             = "Restricted synthetic dev connector database login"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_connector" {
  secret_id = aws_secretsmanager_secret.database_connector.id
  secret_string = jsonencode({
    username = "freeflow_connector_login"
    password = random_password.database_connector.result
    url      = "postgresql://freeflow_connector_login:${random_password.database_connector.result}@${local.rds_endpoint}:5432/mortgage_dev?sslmode=require"
  })
}

resource "aws_secretsmanager_secret" "connector_service_token" {
  count = var.enable_encompass_connector ? 1 : 0

  name                    = "${local.name_prefix}/encompass-connector-service-token"
  description             = "Non-production service authentication token for the private synthetic connector"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "connector_service_token" {
  count = var.enable_encompass_connector ? 1 : 0

  secret_id     = aws_secretsmanager_secret.connector_service_token[0].id
  secret_string = random_password.connector_service_token[0].result
}

resource "aws_secretsmanager_secret" "connector_service_signing_key" {
  count = var.enable_encompass_connector ? 1 : 0

  name                    = "${local.name_prefix}/encompass-connector-s2s-signing-key"
  description             = "Private signed service-to-service key for the custom Encompass connector"
  recovery_window_in_days = 7
  tags = {
    DataClassification = "Confidential"
  }
}

resource "aws_secretsmanager_secret_version" "connector_service_signing_key" {
  count = var.enable_encompass_connector ? 1 : 0

  secret_id     = aws_secretsmanager_secret.connector_service_signing_key[0].id
  secret_string = random_password.connector_service_signing_key[0].result
}

# This container is connector-only. Terraform never writes LOS values into
# state; populate clientId/clientSecret/instanceId through the approved secret
# workflow before selecting real-encompass mode.
resource "aws_secretsmanager_secret" "connector_encompass_credentials" {
  count = local.connector_real_encompass ? 1 : 0

  name                    = "${local.name_prefix}/encompass-connector-los-credentials"
  description             = "Connector-only Encompass OAuth credentials for one lender deployment"
  recovery_window_in_days = 7
  tags = {
    DataClassification = "Confidential"
  }
}

# Terraform creates only the secret container. Populate its value through the
# approved secrets workflow; never place an ICE API secret in tfvars or state.
resource "aws_secretsmanager_secret" "encompass_api_client" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  name                    = "${local.name_prefix}/encompass-api-client-secret"
  description             = "ICE Encompass Developer Connect client secret for the synthetic dev worker"
  recovery_window_in_days = 7
}
