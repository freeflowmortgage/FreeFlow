terraform {
  required_version = ">= 1.6.0"

  # The first bootstrap apply uses `terraform init -backend=false` because the
  # state bucket does not exist yet. Immediately after that apply, migrate the
  # state to the newly created, encrypted S3 backend using per-environment
  # backend settings. Local bootstrap state must never be the steady state.
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
