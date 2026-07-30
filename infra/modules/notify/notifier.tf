# D3: the fan-out notifier. Reserved concurrency 1 serializes concurrent
# invokes (claims make duplicates harmless; serialization makes them
# cheap). Unlike the pollers, a dropped async event here is NOT
# regenerated next minute - once the poller's watermark advances, that
# delta never recurs - so failures get an OnFailure destination to the
# ops topic and a deliberate 1 h maximum event age: a stale alert email
# still beats silence.

data "aws_iam_policy_document" "notifier" {
  statement {
    sid = "BulletinAndClaimState"
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
      TABLE_NAME            = var.table_name
      DATA_BUCKET           = var.data_bucket_name
      LINK_SECRETS_PARAM    = aws_ssm_parameter.alert_link_secrets.name
      SITE_ORIGIN           = "https://${var.domain_name}"
      API_ORIGIN            = "https://api.${var.domain_name}"
      FROM_ADDRESS          = "Ferry Sound <alerts@${var.domain_name}>"
      SES_CONFIGURATION_SET = aws_sesv2_configuration_set.alerts.configuration_set_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.notifier]
}

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
  alarm_description   = "Unhandled exception in the alert notifier - subscriber emails may be delayed or lost."
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
