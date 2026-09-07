provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      ManagedBy          = "Terraform"
      Project            = "freeflow"
      Environment        = var.environment
      DataClassification = "SyntheticOnly"
      Owner              = "freeflowmortgage"
    }
  }
}
