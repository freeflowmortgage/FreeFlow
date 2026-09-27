terraform {
  required_version = ">= 1.6.0"
}

variable "environment" {
  type    = string
  default = "production"
  validation {
    condition     = var.environment == "production"
    error_message = "This root module is reserved for production."
  }
}

variable "database_multi_az" {
  type    = bool
  default = true
  validation {
    condition     = var.database_multi_az
    error_message = "Production database_multi_az must be true."
  }
}

variable "database_backup_retention_days" {
  type    = number
  default = 35
  validation {
    condition     = var.database_backup_retention_days >= 7
    error_message = "Production database backups must be retained for at least 7 days."
  }
}

variable "database_deletion_protection" {
  type    = bool
  default = true
  validation {
    condition     = var.database_deletion_protection
    error_message = "Production database deletion protection must remain enabled."
  }
}

variable "database_point_in_time_recovery" {
  type    = bool
  default = true
  validation {
    condition     = var.database_point_in_time_recovery
    error_message = "Production point-in-time recovery must remain enabled."
  }
}

variable "portal_desired_count" {
  type    = number
  default = 2
  validation {
    condition     = var.portal_desired_count >= 2
    error_message = "Production portal desired count must be at least two."
  }
}

variable "worker_desired_count" {
  type    = number
  default = 2
  validation {
    condition     = var.worker_desired_count >= 2
    error_message = "Each production asynchronous worker desired count must be at least two."
  }
}

variable "enable_waf" {
  type    = bool
  default = true
  validation {
    condition     = var.enable_waf
    error_message = "Production WAF must remain enabled."
  }
}

variable "tls_policy" {
  type    = string
  default = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  validation {
    condition     = startswith(var.tls_policy, "ELBSecurityPolicy-TLS13-")
    error_message = "Production must use an approved TLS 1.3 ALB policy."
  }
}

variable "private_compute" {
  type    = bool
  default = true
  validation {
    condition     = var.private_compute
    error_message = "Production workers, parsers, and connectors must use private compute networking."
  }
}

variable "customer_managed_kms" {
  type    = bool
  default = true
  validation {
    condition     = var.customer_managed_kms
    error_message = "Production data stores and queues must use customer-managed KMS keys."
  }
}

variable "queue_dlq_encryption" {
  type    = bool
  default = true
  validation {
    condition     = var.queue_dlq_encryption
    error_message = "Production queues and DLQs must remain encrypted."
  }
}

variable "secrets_manager_only" {
  type    = bool
  default = true
  validation {
    condition     = var.secrets_manager_only
    error_message = "Production runtime credentials must be sourced from Secrets Manager."
  }
}

variable "enable_monitoring_and_alerts" {
  type    = bool
  default = true
  validation {
    condition     = var.enable_monitoring_and_alerts
    error_message = "Production monitoring and alerts must remain enabled."
  }
}

variable "production_account_id" {
  type        = string
  description = "Twelve-digit AWS account reserved for production."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.production_account_id))
    error_message = "production_account_id must be a twelve-digit AWS account ID."
  }
}

variable "development_account_id" {
  type        = string
  description = "Development account ID used only to enforce environment separation."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.development_account_id))
    error_message = "development_account_id must be a twelve-digit AWS account ID."
  }
}

check "separate_aws_accounts" {
  assert {
    condition     = var.production_account_id != var.development_account_id
    error_message = "Production and development must not share an AWS account."
  }
}
