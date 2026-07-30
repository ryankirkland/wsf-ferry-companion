# M2: the 1-minute alerts poller - the same-day-truth sensor and M3's
# alert-latency substrate, built one milestone early. Watermark-gated:
# an unchanged feed costs one 25 KB GET and zero writes.

data "aws_iam_policy_document" "alerts_poller" {
  statement {
    sid       = "WatermarkMeta"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.hot.arn]
  }

  statement {
    sid       = "AlertsPublish"
    actions   = ["s3:PutObject"]
    resources = ["${var.data_bucket_arn}/data/*"]
  }

  statement {
    sid       = "RawArchivePut"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.raw.arn}/raw/*"]
  }

  statement {
    sid       = "AccessCodeRead"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.wsf_access_code.arn]
  }

  statement {
    sid       = "TriggerTodayRefresh"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.schedule_refresh.arn]
  }

  statement {
    sid     = "TriggerNotifier"
    actions = ["lambda:InvokeFunction"]
    resources = [
      "arn:aws:lambda:us-west-2:${data.aws_caller_identity.current.account_id}:function:${var.notifier_function_name}"
    ]
  }
}

resource "aws_iam_role" "alerts_poller" {
  name               = "wsf-prod-ingest-alerts"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "alerts_poller" {
  role   = aws_iam_role.alerts_poller.name
  policy = data.aws_iam_policy_document.alerts_poller.json
}

resource "aws_iam_role_policy_attachment" "alerts_poller_logs" {
  role       = aws_iam_role.alerts_poller.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "alerts_poller" {
  name              = "/aws/lambda/wsf-prod-ingest-alerts"
  retention_in_days = 30
}

resource "aws_lambda_function" "alerts_poller" {
  function_name    = "wsf-prod-ingest-alerts"
  role             = aws_iam_role.alerts_poller.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_ingest.alerts.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 128
  timeout          = 30

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.hot.name
      DATA_BUCKET           = var.data_bucket_name
      RAW_BUCKET            = aws_s3_bucket.raw.id
      WSF_ACCESS_CODE_PARAM = aws_ssm_parameter.wsf_access_code.name
      REFRESHER_FUNCTION    = aws_lambda_function.schedule_refresh.function_name
      NOTIFIER_FUNCTION     = var.notifier_function_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.alerts_poller]
}

resource "aws_scheduler_schedule" "alerts_poller" {
  name                = "wsf-prod-ingest-alerts-1min"
  schedule_expression = "rate(1 minute)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.alerts_poller.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
