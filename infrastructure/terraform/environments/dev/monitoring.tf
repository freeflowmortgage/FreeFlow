locals {
  alarm_actions = var.enable_monitoring ? [aws_sns_topic.operations[0].arn] : []
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
