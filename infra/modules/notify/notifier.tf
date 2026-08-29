# Alert delivery is two stages: the notifier diffs/matches and writes one SQS
# message per user; the delivery worker sends SES and records SENT state only
# after acceptance. SQS retries transient failures and isolates one bad address
# from every other recipient. Reserved concurrency 1 preserves deterministic
# cap/idempotency checks; the DLQ is the durable operator recovery point.

resource "aws_sqs_queue" "delivery_dlq" {
  name                      = "wsf-prod-notify-delivery-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "delivery" {
  name                       = "wsf-prod-notify-delivery"
  visibility_timeout_seconds = 180
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.delivery_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "delivery" {
  queue_url = aws_sqs_queue.delivery_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.delivery.arn]
  })
}

# --- notifier: bulletin diff + subscription matching -> SQS ---

data "aws_iam_policy_document" "notifier" {
  statement {
    sid = "BulletinAndSubscriptionState"
    actions = [
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
    resources = [var.table_arn]
  }

  statement {
    sid       = "PairsIndexRead"
    actions   = ["s3:GetObject"]
    resources = ["${var.data_bucket_arn}/data/pairs/index.json"]
  }

  statement {
    sid       = "QueueMatchedDeliveries"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.delivery.arn]
  }

  statement {
    sid       = "OnFailureDestination"
    actions   = ["sns:Publish"]
    resources = [var.alarms_topic_arn]
  }
}

resource "aws_iam_role" "notifier" {
  name               = "wsf-prod-notify-fanout"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "notifier" {
  role   = aws_iam_role.notifier.name
  policy = data.aws_iam_policy_document.notifier.json
}

resource "aws_iam_role_policy_attachment" "notifier_logs" {
  role       = aws_iam_role.notifier.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "notifier" {
  name              = "/aws/lambda/${var.notifier_function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "notifier" {
  function_name    = var.notifier_function_name
  role             = aws_iam_role.notifier.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_notify.notifier.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 120

  reserved_concurrent_executions = 1

  environment {
    variables = {
      TABLE_NAME         = var.table_name
      DATA_BUCKET        = var.data_bucket_name
      DELIVERY_QUEUE_URL = aws_sqs_queue.delivery.url
    }
  }

  depends_on = [aws_cloudwatch_log_group.notifier]
}

# A dropped poller->notifier async event is not regenerated once the alerts
# watermark advances. Preserve the existing one-hour retry window and notify
# operators if diff/matching still cannot complete.
resource "aws_lambda_function_event_invoke_config" "notifier" {
  function_name                = aws_lambda_function.notifier.function_name
  maximum_event_age_in_seconds = 3600
  maximum_retry_attempts       = 2

  destination_config {
    on_failure {
      destination = var.alarms_topic_arn
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "notifier_errors" {
  alarm_name          = "wsf-prod-notify-fanout-errors"
  alarm_description   = "Bulletin diff or queue fan-out failed; the async invocation is retrying."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.notifier.function_name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

# --- delivery: one SQS message -> SES -> SENT/cap transaction ---

data "aws_iam_policy_document" "delivery" {
  statement {
    sid = "DeliveryState"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:TransactWriteItems",
    ]
    resources = [var.table_arn]
  }

  statement {
    sid = "ConsumeDeliveryQueue"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.delivery.arn]
  }

  statement {
    sid       = "LinkSecretsRead"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.alert_link_secrets.arn]
  }

  statement {
    sid     = "SendAlertEmail"
    actions = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [
      aws_sesv2_email_identity.domain.arn,
      aws_sesv2_configuration_set.alerts.arn,
    ]
  }
}

resource "aws_iam_role" "delivery" {
  name               = "wsf-prod-notify-delivery"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "delivery" {
  role   = aws_iam_role.delivery.name
  policy = data.aws_iam_policy_document.delivery.json
}

resource "aws_iam_role_policy_attachment" "delivery_logs" {
  role       = aws_iam_role.delivery.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "delivery" {
  name              = "/aws/lambda/wsf-prod-notify-delivery"
  retention_in_days = 30
}

resource "aws_lambda_function" "delivery" {
  function_name    = "wsf-prod-notify-delivery"
  role             = aws_iam_role.delivery.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_notify.delivery.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 30

  reserved_concurrent_executions = 1

  environment {
    variables = {
      TABLE_NAME            = var.table_name
      LINK_SECRETS_PARAM    = aws_ssm_parameter.alert_link_secrets.name
      SITE_ORIGIN           = "https://${var.domain_name}"
      API_ORIGIN            = "https://api.${var.domain_name}"
      FROM_ADDRESS          = "Ferry Sound <alerts@${var.domain_name}>"
      SES_CONFIGURATION_SET = aws_sesv2_configuration_set.alerts.configuration_set_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.delivery]
}

resource "aws_lambda_event_source_mapping" "delivery" {
  event_source_arn = aws_sqs_queue.delivery.arn
  function_name    = aws_lambda_function.delivery.arn
  batch_size       = 1
  enabled          = true

  depends_on = [aws_iam_role_policy.delivery]
}

resource "aws_cloudwatch_metric_alarm" "delivery_errors" {
  alarm_name          = "wsf-prod-notify-delivery-errors"
  alarm_description   = "SES delivery failed; SQS is retrying the recipient message."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.delivery.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "delivery_stale" {
  alarm_name          = "wsf-prod-notify-delivery-stale"
  alarm_description   = "Oldest queued alert delivery is over two minutes old."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.delivery.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 120
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "delivery_dlq" {
  alarm_name          = "wsf-prod-notify-delivery-dlq"
  alarm_description   = "A recipient alert exhausted SQS retries and needs operator replay."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.delivery_dlq.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}
