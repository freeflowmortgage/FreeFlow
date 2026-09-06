output "state_bucket_name" {
  description = "S3 bucket name to use in the environment backend configuration."
  value       = aws_s3_bucket.terraform_state.bucket
}

output "lock_table_name" {
  description = "DynamoDB table name to use in the environment backend configuration."
  value       = aws_dynamodb_table.terraform_lock.name
}

output "state_kms_key_arn" {
  description = "KMS key protecting Terraform state at rest."
  value       = aws_kms_key.terraform_state.arn
}
