variable "aws_region" {
  type        = string
  description = "AWS region containing the existing mortgage development resources."
  default     = "us-west-2"
}

variable "aws_profile" {
  type        = string
  description = "Optional legacy local AWS CLI profile. Prefer short-lived environment credentials or CI OIDC."
  default     = null
  nullable    = true
}

variable "environment" {
  type        = string
  description = "Deployment environment name."
  default     = "dev"

  validation {
    condition     = var.environment == "dev"
    error_message = "This transitional stack may manage only the synthetic-data dev environment."
  }
}

variable "vpc_id" {
  type    = string
  default = "vpc-009b508e6966e5bed"
}

variable "public_subnet_ids" {
  type    = list(string)
  default = ["subnet-0828c38953c407dc3", "subnet-0c15242f773d5a495"]
}

variable "app_private_subnet_ids" {
  type    = list(string)
  default = ["subnet-0e0ef8093350beb89", "subnet-0b3ce33cb99748d7c"]
}

variable "nat_gateway_id" {
  type    = string
  default = "nat-01d159a759eb8369b"
}

variable "alb_security_group_id" {
  type    = string
  default = "sg-027f8fdeaafbc222a"
}

variable "app_security_group_id" {
  type    = string
  default = "sg-0984be80d6c95483f"
}

variable "ecs_cluster_name" {
  type    = string
  default = "mortgage-dev-cluster"
}

variable "rds_instance_identifier" {
  type    = string
  default = "mortgage-dev-postgres"
}

variable "portal_repository_name" {
  type    = string
  default = "mortgage-api"
}

variable "portal_hostname" {
  type        = string
  description = "HTTPS hostname used by the live-test portal."
  default     = "dev.mb-ai.com"
}

variable "hosted_zone_id" {
  type        = string
  description = "Route 53 public hosted-zone ID for the portal hostname. Required when enable_edge is true."
  default     = null
  nullable    = true
}

variable "enable_edge" {
  type        = bool
  description = "Creates ACM, Cognito, ALB, and DNS after domain control is confirmed."
  default     = false
}

variable "enable_services" {
  type        = bool
  description = "Creates digest-pinned ECS task definitions and services after images are pushed."
  default     = false
}

variable "portal_image" {
  type        = string
  description = "Portal ECR image reference pinned with @sha256:."
  default     = ""

  validation {
    condition     = !var.enable_services || can(regex("@sha256:[0-9a-f]{64}$", var.portal_image))
    error_message = "portal_image must be an immutable @sha256 digest reference when services are enabled."
  }
}

variable "parser_image" {
  type        = string
  description = "Income parser ECR image reference pinned with @sha256:."
  default     = ""

  validation {
    condition     = !var.enable_services || can(regex("@sha256:[0-9a-f]{64}$", var.parser_image))
    error_message = "parser_image must be an immutable @sha256 digest reference when services are enabled."
  }
}

variable "migration_image" {
  type        = string
  description = "Database migration ECR image reference pinned with @sha256:."
  default     = ""

  validation {
    condition     = !var.enable_services || can(regex("@sha256:[0-9a-f]{64}$", var.migration_image))
    error_message = "migration_image must be an immutable @sha256 digest reference when services are enabled."
  }
}
