locals {
  alarm_actions = var.enable_monitoring ? [aws_sns_topic.operations[0].arn] : []

  memory_alarm_services = merge(
    var.enable_monitoring && var.enable_services && var.enable_edge ? {
      portal = aws_ecs_service.portal[0].name
    } : {},
    var.enable_monitoring && var.enable_services && var.enable_edge && var.enable_parser ? {
      parser = aws_ecs_service.parser[0].name
    } : {},
    var.enable_monitoring && var.enable_encompass_connector ? {
      connector = aws_ecs_service.connector[0].name
    } : {},
    var.enable_monitoring && var.enable_encompass_document_pull_worker ? {
      document_pull_worker = aws_ecs_service.document_pull_worker[0].name
    } : {},
    var.enable_monitoring && var.enable_encompass_sync_worker ? {
      sync_worker = aws_ecs_service.encompass_sync_worker[0].name
    } : {},
  )

  worker_cpu_alarm_services = merge(
    var.enable_monitoring && var.enable_encompass_connector ? {
      connector = aws_ecs_service.connector[0].name
    } : {},
    var.enable_monitoring && var.enable_encompass_document_pull_worker ? {
      document_pull_worker = aws_ecs_service.document_pull_worker[0].name
    } : {},
    var.enable_monitoring && var.enable_encompass_sync_worker ? {
      sync_worker = aws_ecs_service.encompass_sync_worker[0].name
    } : {},
  )

  operational_log_metrics = merge(
    var.enable_monitoring && var.enable_services && var.enable_edge ? {
      auth_denied = {
        log_group   = aws_cloudwatch_log_group.portal.name
        pattern     = "{ $.event = \"auth_denied\" }"
        metric_name = "AuthenticationDenied"
      }
      scoped_object_denied = {
        log_group   = aws_cloudwatch_log_group.portal.name
        pattern     = "{ $.event = \"scoped_object_denied\" }"
        metric_name = "ScopedObjectDenied"
      }
      stale_provenance_rejected = {
        log_group   = aws_cloudwatch_log_group.portal.name
        pattern     = "{ $.event = \"stale_provenance_rejected\" }"
        metric_name = "StaleProvenanceRejected"
      }
    } : {},
    var.enable_monitoring && var.enable_encompass_document_pull_worker ? {
      document_pull_failure = {
        log_group   = aws_cloudwatch_log_group.document_pull_worker[0].name
        pattern     = "{ $.event = \"document_pull_failure\" }"
        metric_name = "DocumentPullFailure"
      }
      document_pull_retry = {
        log_group   = aws_cloudwatch_log_group.document_pull_worker[0].name
        pattern     = "{ $.event = \"document_pull_retry\" }"
        metric_name = "DocumentPullRetry"
      }
    } : {},
    var.enable_monitoring && var.enable_encompass_sync_worker ? {
      sync_failure = {
        log_group   = aws_cloudwatch_log_group.encompass_sync_worker[0].name
        pattern     = "{ $.event = \"sync_failure\" }"
        metric_name = "SyncFailure"
      }
      sync_retry = {
        log_group   = aws_cloudwatch_log_group.encompass_sync_worker[0].name
        pattern     = "{ $.event = \"sync_retry\" || $.event = \"sync_reconciliation\" }"
        metric_name = "SyncRetryOrReconciliation"
      }
    } : {},
    var.enable_monitoring && var.enable_encompass_connector ? {
      connector_error = {
        log_group   = aws_cloudwatch_log_group.connector.name
        pattern     = "{ $.event = \"connector_error\" }"
        metric_name = "ConnectorError"
      }
    } : {},
  )
}

resource "aws_sns_topic" "operations" {
  count = var.enable_monitoring ? 1 : 0

  name              = "${local.name_prefix}-operations"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "operations_email" {
  count = var.enable_monitoring && var.operations_alert_email != null ? 1 : 0

  topic_arn = aws_sns_topic.operations[0].arn
  protocol  = "email"
  endpoint  = var.operations_alert_email
}

data "aws_iam_policy_document" "operations_topic" {
  count = var.enable_monitoring ? 1 : 0

  statement {
    sid    = "AllowAccountManagement"
    effect = "Allow"
    actions = [
      "SNS:AddPermission",
      "SNS:DeleteTopic",
      "SNS:GetTopicAttributes",
      "SNS:ListSubscriptionsByTopic",
      "SNS:Publish",
      "SNS:RemovePermission",
      "SNS:SetTopicAttributes",
      "SNS:Subscribe",
    ]
    resources = [aws_sns_topic.operations[0].arn]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid       = "AllowEventBridgeDeploymentFailureNotifications"
    effect    = "Allow"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.operations[0].arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.ecs_deployment_failed[0].arn]
    }
  }
}

resource "aws_sns_topic_policy" "operations" {
  count = var.enable_monitoring ? 1 : 0

  arn    = aws_sns_topic.operations[0].arn
  policy = data.aws_iam_policy_document.operations_topic[0].json
}

resource "aws_cloudwatch_event_rule" "ecs_deployment_failed" {
  count = var.enable_monitoring ? 1 : 0

  name        = "${local.name_prefix}-ecs-deployment-failed"
  description = "Notify operations when an ECS deployment reaches a failed state."
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Deployment State Change"]
    detail = {
      eventName  = ["SERVICE_DEPLOYMENT_FAILED"]
      clusterArn = [data.aws_ecs_cluster.existing.arn]
    }
  })
}

resource "aws_cloudwatch_event_target" "ecs_deployment_failed" {
  count = var.enable_monitoring ? 1 : 0

  rule = aws_cloudwatch_event_rule.ecs_deployment_failed[0].name
  arn  = aws_sns_topic.operations[0].arn
}

resource "aws_cloudwatch_metric_alarm" "portal_target_5xx" {
  count = var.enable_monitoring && var.enable_edge ? 1 : 0

  alarm_name          = "${local.name_prefix}-portal-target-5xx"
  alarm_description   = "Portal targets returned five or more 5xx responses in five minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    LoadBalancer = aws_lb.portal[0].arn_suffix
    TargetGroup  = aws_lb_target_group.portal[0].arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "portal_unhealthy_targets" {
  count = var.enable_monitoring && var.enable_edge ? 1 : 0

  alarm_name          = "${local.name_prefix}-portal-unhealthy-targets"
  alarm_description   = "At least one portal target is unhealthy."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    LoadBalancer = aws_lb.portal[0].arn_suffix
    TargetGroup  = aws_lb_target_group.portal[0].arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "portal_cpu" {
  count = var.enable_monitoring && var.enable_services && var.enable_edge ? 1 : 0

  alarm_name          = "${local.name_prefix}-portal-cpu-high"
  alarm_description   = "Portal ECS CPU averaged at least 80 percent for ten minutes."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = aws_ecs_service.portal[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "parser_cpu" {
  count = var.enable_monitoring && var.enable_services && var.enable_edge && var.enable_parser ? 1 : 0

  alarm_name          = "${local.name_prefix}-parser-cpu-high"
  alarm_description   = "Parser ECS CPU averaged at least 85 percent for ten minutes."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = aws_ecs_service.parser[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "service_memory" {
  for_each = local.memory_alarm_services

  alarm_name          = "${local.name_prefix}-${replace(each.key, "_", "-")}-memory-high"
  alarm_description   = "${each.key} ECS memory averaged at least 85 percent for ten minutes."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu" {
  for_each = local.worker_cpu_alarm_services

  alarm_name          = "${local.name_prefix}-${replace(each.key, "_", "-")}-cpu-high"
  alarm_description   = "${each.key} ECS CPU averaged at least 85 percent for ten minutes."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "database_free_storage" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${local.name_prefix}-database-storage-low"
  alarm_description   = "RDS free storage fell below five GiB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5368709120
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "database_connections" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${local.name_prefix}-database-connections-high"
  alarm_description   = "RDS held at least 80 concurrent connections for ten minutes."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "sync_queue_age" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${local.name_prefix}-sync-queue-age"
  alarm_description   = "The oldest pending sync message is at least five minutes old."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 300
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.sync.name
  }
}

resource "aws_cloudwatch_metric_alarm" "sync_queue_visible" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${local.name_prefix}-sync-queue-visible"
  alarm_description   = "At least ten sync messages were concurrently visible for five minutes."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.sync.name
  }
}

resource "aws_cloudwatch_metric_alarm" "sync_dlq_messages" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${local.name_prefix}-sync-dlq-messages"
  alarm_description   = "At least one message is visible in the sync dead-letter queue."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.sync_dlq.name
  }
}

resource "aws_cloudwatch_metric_alarm" "document_pull_queue_visible" {
  count = var.enable_monitoring && var.enable_encompass_document_pull_worker ? 1 : 0

  alarm_name          = "${local.name_prefix}-document-pull-queue-visible"
  alarm_description   = "At least ten document-pull messages were concurrently visible for five minutes."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.document_pull[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "document_pull_queue_age" {
  count = var.enable_monitoring && var.enable_encompass_document_pull_worker ? 1 : 0

  alarm_name          = "${local.name_prefix}-document-pull-queue-age"
  alarm_description   = "The oldest pending document-pull message is at least fifteen minutes old."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 900
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.document_pull[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "document_pull_dlq_messages" {
  count = var.enable_monitoring && var.enable_encompass_document_pull_worker ? 1 : 0

  alarm_name          = "${local.name_prefix}-document-pull-dlq-messages"
  alarm_description   = "At least one message is visible in the document-pull dead-letter queue."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.document_pull_dlq[0].name
  }
}

resource "aws_cloudwatch_log_metric_filter" "operational" {
  for_each = local.operational_log_metrics

  name           = "${local.name_prefix}-${replace(each.key, "_", "-")}"
  pattern        = each.value.pattern
  log_group_name = each.value.log_group

  metric_transformation {
    name          = each.value.metric_name
    namespace     = "FreeFlow/Operational"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "operational" {
  for_each = local.operational_log_metrics

  alarm_name          = "${local.name_prefix}-${replace(each.key, "_", "-")}"
  alarm_description   = "FreeFlow emitted at least one ${each.key} operational event in five minutes."
  namespace           = "FreeFlow/Operational"
  metric_name         = each.value.metric_name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.operational]
}

resource "aws_cloudwatch_dashboard" "operations" {
  count = var.enable_monitoring ? 1 : 0

  dashboard_name = "${local.name_prefix}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Portal health and errors"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.portal[0].arn_suffix],
            [".", "HTTPCode_Target_5XX_Count", ".", "."],
            [".", "UnHealthyHostCount", ".", ".", "TargetGroup", aws_lb_target_group.portal[0].arn_suffix],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ECS CPU utilization"
          region = var.aws_region
          stat   = "Average"
          period = 300
          metrics = concat(
            [["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", aws_ecs_service.portal[0].name]],
            var.enable_parser ? [["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", aws_ecs_service.parser[0].name]] : [],
          )
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Database capacity"
          region = var.aws_region
          stat   = "Average"
          period = 300
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_identifier],
            [".", "DatabaseConnections", ".", "."],
            [".", "FreeStorageSpace", ".", "."],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Sync queue and DLQ"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          metrics = [
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", aws_sqs_queue.sync.name],
            [".", "ApproximateNumberOfMessagesVisible", ".", aws_sqs_queue.sync_dlq.name],
          ]
        }
      },
    ]
  })
}
