resource "aws_sqs_queue" "sync_dlq" {
  name                      = "${local.name_prefix}-sync-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "sync" {
  name                       = "${local.name_prefix}-sync"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.sync_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "sync_dlq" {
  queue_url = aws_sqs_queue.sync_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.sync.arn]
  })
}

resource "aws_sqs_queue" "document_pull_dlq" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  name                      = "${local.name_prefix}-document-pull-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "document_pull" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  name                       = "${local.name_prefix}-document-pull"
  visibility_timeout_seconds = 900
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.document_pull_dlq[0].arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "document_pull_dlq" {
  count = var.enable_encompass_document_pull_worker ? 1 : 0

  queue_url = aws_sqs_queue.document_pull_dlq[0].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.document_pull[0].arn]
  })
}
