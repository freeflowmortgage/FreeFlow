variable "PORTAL_IMAGE" {
  default = "freeflow-portal:dev"
}

variable "PARSER_IMAGE" {
  default = "freeflow-income-parser:dev"
}

variable "CONSOLE_IMAGE" {
  default = "freeflow-underwriting-console:dev"
}

variable "MIGRATION_IMAGE" {
  default = "freeflow-database-migrations:dev"
}

variable "CONNECTOR_IMAGE" {
  default = "freeflow-encompass-connector:dev"
}

group "default" {
  targets = ["portal", "parser", "console", "migration", "connector"]
}

target "portal" {
  context    = "."
  dockerfile = "apps/underwriter-portal/Dockerfile"
  tags       = [PORTAL_IMAGE]
  platforms  = ["linux/amd64"]
}

target "parser" {
  context    = "services/doc-parser"
  dockerfile = "Dockerfile"
  tags       = [PARSER_IMAGE]
  platforms  = ["linux/amd64"]
}

target "console" {
  context    = "."
  dockerfile = "apps/underwriting-console/Dockerfile"
  tags       = [CONSOLE_IMAGE]
  platforms  = ["linux/amd64"]
}

target "migration" {
  context    = "."
  dockerfile = "packages/database/Dockerfile.migrate"
  tags       = [MIGRATION_IMAGE]
  platforms  = ["linux/amd64"]
}

target "connector" {
  context    = "."
  dockerfile = "services/encompass-connector/Dockerfile"
  tags       = [CONNECTOR_IMAGE]
  platforms  = ["linux/amd64"]
}
