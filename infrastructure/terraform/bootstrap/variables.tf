variable "aws_region" {
  description = "AWS region in which this environment's Terraform state is stored."
  type        = string
}

variable "environment" {
  description = "Environment owning this isolated Terraform state backend."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be dev, staging, or production."
  }
}

variable "project" {
  description = "Project tag applied to state resources."
  type        = string
  default     = "freeflow"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for this environment's Terraform state."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must be a valid 3-63 character S3 bucket name."
  }
}

variable "force_destroy" {
  description = "Must remain false. State buckets are not destroyed by routine Terraform operations."
  type        = bool
  default     = false
}
