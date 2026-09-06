provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      ManagedBy       = "Terraform"
      Project         = var.project
      Environment     = var.environment
      DataClassification = "Confidential"
    }
  }
}
