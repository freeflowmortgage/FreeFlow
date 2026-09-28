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

variable "domain_name" {
  type        = string
  description = "Registered parent domain for the portal hostname."
  default     = "freeflowmortgage.com"
}

variable "dns_managed_externally" {
  type        = bool
  description = "True when the registrar/DNS provider, such as Wix, remains authoritative and DNS records are added outside Route 53."
  default     = true
}

variable "create_hosted_zone" {
  type        = bool
  description = "Creates a Route 53 public zone. Do not enable while an external provider remains authoritative."
  default     = false

  validation {
    condition     = !(var.create_hosted_zone && var.dns_managed_externally)
    error_message = "create_hosted_zone cannot be used while dns_managed_externally is true."
  }
}

variable "hosted_zone_id" {
  type        = string
  description = "Existing Route 53 public hosted-zone ID. Leave null when create_hosted_zone is true."
  default     = null
  nullable    = true

  validation {
    condition     = !(var.create_hosted_zone && var.hosted_zone_id != null)
    error_message = "Set only one of create_hosted_zone or hosted_zone_id."
  }
}

variable "enable_edge" {
  type        = bool
  description = "Creates the PLTE ALB. Cognito/TLS/DNS remain separately gated."
  default     = false
}

variable "enable_cognito_edge" {
  type        = bool
  description = "Adds ACM, Route 53, and ALB Cognito authentication after domain control is confirmed."
  default     = false

  validation {
    condition = (
      !var.enable_cognito_edge || (
        var.enable_https_certificate && (
          var.create_hosted_zone ||
          var.dns_managed_externally ||
          (var.hosted_zone_id != null && trimspace(var.hosted_zone_id) != "")
        )
      )
    )
    error_message = "Cognito/HTTPS requires enable_https_certificate=true and either external DNS, create_hosted_zone=true, or an existing hosted_zone_id."
  }
}

variable "enable_https_certificate" {
  type        = bool
  description = "Requests the ACM certificate before switching the live ALB to HTTPS/Cognito."
  default     = false

  validation {
    condition = (
      !var.enable_https_certificate ||
      var.dns_managed_externally ||
      var.create_hosted_zone ||
      (var.hosted_zone_id != null && trimspace(var.hosted_zone_id) != "")
    )
    error_message = "HTTPS certificate creation requires external DNS, create_hosted_zone=true, or an existing hosted_zone_id."
  }
}

variable "plte_allowed_ipv4_cidrs" {
  type        = list(string)
  description = "Workstation IPv4 CIDRs allowed to reach the temporary HTTP PLTE endpoint."
  default     = []

  validation {
    condition = (
      !var.enable_edge || var.enable_cognito_edge ||
      (length(var.plte_allowed_ipv4_cidrs) > 0 && alltrue([
        for cidr in var.plte_allowed_ipv4_cidrs : can(cidrhost(cidr, 0)) && !can(regex(":", cidr))
      ]))
    )
    error_message = "Temporary HTTP PLTE edge requires at least one valid IPv4 CIDR allowlist entry."
  }
}

variable "enable_parser" {
  type        = bool
  description = "Creates the parser task and service. Keep false while its image has unresolved findings."
  default     = false
}

variable "enable_encompass_document_pull_worker" {
  type        = bool
  description = "Runs the tenant-scoped Encompass eFolder pull worker through the private connector service."
  default     = false

  validation {
    condition     = !var.enable_encompass_document_pull_worker || (var.enable_edge && var.enable_services && var.enable_parser && var.enable_encompass_connector)
    error_message = "The Encompass document pull worker requires edge, services, the income parser, and the connector."
  }
}

variable "enable_encompass_sync_worker" {
  type        = bool
  description = "Runs the durable approval-bound Encompass outbound sync worker through the private connector service."
  default     = false

  validation {
    condition     = !var.enable_encompass_sync_worker || (var.enable_edge && var.enable_services && var.enable_encompass_connector)
    error_message = "The Encompass sync worker requires edge, services, and the connector."
  }
}

variable "enable_encompass_connector" {
  type        = bool
  description = "Runs the internal-only custom Encompass connector foundation without LOS credentials or document retrieval."
  default     = false

  validation {
    condition     = !var.enable_encompass_connector || (var.enable_edge && var.enable_services)
    error_message = "The Encompass connector requires edge and services so private routing is managed."
  }
}

variable "connector_service_token_rotation_epoch" {
  type        = string
  description = "Explicit rotation epoch for the optional Developer Connect connector service token. Preserve the deployed value during hosted-only changes."
  default     = ""

  validation {
    condition     = var.connector_service_token_rotation_epoch == "" || can(regex("^[A-Za-z0-9._-]{1,64}$", var.connector_service_token_rotation_epoch))
    error_message = "connector_service_token_rotation_epoch must be empty or a 1-64 character safe identifier."
  }
}

variable "encompass_connector_mode" {
  type        = string
  description = "Connector runtime mode. Synthetic is development test-only; real-encompass resolves LOS credentials only inside the connector task."
  default     = "synthetic-freeflow-dev"

  validation {
    condition     = contains(["synthetic-freeflow-dev", "real-encompass"], var.encompass_connector_mode)
    error_message = "encompass_connector_mode must be synthetic-freeflow-dev or real-encompass."
  }
}

variable "enable_console" {
  type        = bool
  description = "Enables the Encompass-hosted underwriting console behind the authenticated HTTPS listener."
  default     = false

  validation {
    condition     = !var.enable_console || (var.enable_edge && var.enable_services && var.enable_cognito_edge)
    error_message = "The Encompass-hosted console requires edge, services, and the authenticated HTTPS listener."
  }
}

variable "encompass_frame_ancestors" {
  type        = string
  description = "Space-separated HTTPS CSP frame-ancestor sources for the lender-approved Encompass hosts."
  default     = ""

  validation {
    condition = !var.enable_console || (
      length(trimspace(var.encompass_frame_ancestors)) > 0 &&
      !strcontains(var.encompass_frame_ancestors, "*") &&
      !strcontains(var.encompass_frame_ancestors, ";") &&
      alltrue([
        for origin in split(" ", trimspace(var.encompass_frame_ancestors)) :
        can(regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$", origin))
      ])
    )
    error_message = "Hosted console frame ancestors must be explicit HTTPS origins without wildcards or directive separators."
  }
}

variable "enable_monitoring" {
  type        = bool
  description = "Creates the low-cost PLTE CloudWatch dashboard, alarms, and encrypted SNS topic."
  default     = false

  validation {
    condition     = !var.enable_monitoring || (var.enable_edge && var.enable_services)
    error_message = "enable_edge and enable_services must both be true before monitoring is enabled."
  }
}

variable "operations_alert_email" {
  type        = string
  description = "Optional operator email for alarm notifications. Keep in ignored tfvars; the recipient must confirm the SNS subscription."
  default     = null
  nullable    = true

  validation {
    condition = (
      var.operations_alert_email == null ||
      can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.operations_alert_email))
    )
    error_message = "operations_alert_email must be null or a syntactically valid email address."
  }
}

variable "enable_services" {
  type        = bool
  description = "Creates digest-pinned ECS task definitions and services after images are pushed."
  default     = false
}

variable "portal_desired_count" {
  type        = number
  description = "Portal task count. Keep zero until the private migration succeeds, then set to one for PLTE."
  default     = 0

  validation {
    condition     = contains([0, 1], var.portal_desired_count)
    error_message = "The low-cost PLTE portal desired count must be either 0 or 1."
  }
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

variable "encompass_connector_service_auth_kind" {
  type        = string
  description = "Optional explicit auth contract for the separately managed connector fallback. Empty derives it from connector mode."
  default     = ""

  validation {
    condition     = contains(["", "signed-replay", "bearer-stub-non-prod"], var.encompass_connector_service_auth_kind)
    error_message = "encompass_connector_service_auth_kind must be empty, signed-replay, or bearer-stub-non-prod."
  }
}

variable "developer_connect_worker_image" {
  type        = string
  description = "Optional immutable portal-derived image pinned independently for Developer Connect fallback workers. Empty follows portal_image."
  default     = ""

  validation {
    condition     = var.developer_connect_worker_image == "" || can(regex("@sha256:[0-9a-f]{64}$", var.developer_connect_worker_image))
    error_message = "developer_connect_worker_image must be empty or an immutable @sha256 digest reference."
  }
}

variable "parser_image" {
  type        = string
  description = "Income parser ECR image reference pinned with @sha256:."
  default     = ""

  validation {
    condition     = !var.enable_services || !var.enable_parser || can(regex("@sha256:[0-9a-f]{64}$", var.parser_image))
    error_message = "parser_image must be an immutable @sha256 digest reference when the parser is enabled."
  }
}

variable "console_image" {
  type        = string
  description = "Underwriting console ECR image reference pinned with @sha256:."
  default     = ""

  validation {
    condition     = !var.enable_console || can(regex("@sha256:[0-9a-f]{64}$", var.console_image))
    error_message = "console_image must be an immutable @sha256 digest reference when the console is enabled."
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

variable "connector_image" {
  type        = string
  description = "Custom Encompass connector ECR image reference pinned with @sha256:."
  default     = ""

  validation {
    condition     = !var.enable_encompass_connector || can(regex("@sha256:[0-9a-f]{64}$", var.connector_image))
    error_message = "connector_image must be an immutable @sha256 digest reference when the connector is enabled."
  }
}
