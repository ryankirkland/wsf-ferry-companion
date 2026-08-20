# F6 weather: NWS + AirNow per-terminal conditions -> /data/weather.json
# every 30 minutes (ADR-0005 static snapshot; api-exploration-weather/
# weather.md is the evidence base). The terminal->gridcell dim ships
# inside the zip - resolution is pinned at tools/weather/resolve-gridcells.py
# time, never re-derived in production.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "poller" {
  statement {
    sid       = "PublishWeatherContract"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${var.data_bucket_arn}/data/weather.json"]
  }

  statement {
    sid       = "RawWeatherArchive"
    actions   = ["s3:PutObject"]
    resources = ["${var.raw_bucket_arn}/raw/weather/*"]
  }

  statement {
    sid       = "AirNowKeyRead"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:us-west-2:${data.aws_caller_identity.current.account_id}:parameter/wsf/prod/airnow-api-key"]
  }
}

resource "aws_iam_role" "poller" {
  name               = "wsf-prod-weather-poller"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "poller" {
  role   = aws_iam_role.poller.name
  policy = data.aws_iam_policy_document.poller.json
}

resource "aws_iam_role_policy_attachment" "poller_logs" {
  role       = aws_iam_role.poller.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "poller" {
  name              = "/aws/lambda/wsf-prod-weather-poller"
  retention_in_days = 30
}

resource "aws_lambda_function" "poller" {
  function_name    = "wsf-prod-weather-poller"
  role             = aws_iam_role.poller.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_weather.poller.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 192
  # 19 NWS cells (one retry each) + 6 AirNow areas (no retry, and a
  # remaining-time guard reserves the publish window): normal runs ~30s;
  # the ceiling covers a bad NWS day without the first deploy's failure
  # mode of dying mid-fetch before publishing anything.
  timeout = 180

  environment {
    variables = {
      DATA_BUCKET      = var.data_bucket_name
      RAW_BUCKET       = var.raw_bucket_name
      AIRNOW_KEY_PARAM = "/wsf/prod/airnow-api-key"
    }
  }

  depends_on = [aws_cloudwatch_log_group.poller]
}

resource "aws_iam_role" "scheduler" {
  name               = "wsf-prod-weather-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = [aws_lambda_function.poller.arn]
    }]
  })
}

resource "aws_scheduler_schedule" "poller_30min" {
  name                = "wsf-prod-weather-30min"
  schedule_expression = "rate(30 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.poller.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 1
    }
  }
}

# Silence IS the failure signature (the poller absorbs upstream trouble
# into last-good entries): if nothing published for 2 hours, the pipeline
# itself is dead - schedule, Lambda, or a bug.
resource "aws_cloudwatch_metric_alarm" "weather_stale" {
  alarm_name          = "wsf-prod-weather-not-published"
  alarm_description   = "No weather publish in 2h - riders are reading old conditions with no fresher ones coming."
  namespace           = "WSF/Weather"
  metric_name         = "WeatherPublished"
  statistic           = "Sum"
  period              = 7200
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}

# Publishing fine but persistently on last-good: NWS or AirNow has been
# failing for hours and every "fresh" publish is quietly re-serving old
# entries. One-off blips (their changelog admits 503 stretches) stay
# below this threshold on purpose.
resource "aws_cloudwatch_metric_alarm" "weather_degraded" {
  alarm_name          = "wsf-prod-weather-degraded"
  alarm_description   = "Sustained upstream failures - weather.json is publishing but leaning on last-good entries for hours."
  namespace           = "WSF/Weather"
  metric_name         = "LastGoodFallbacks"
  statistic           = "Sum"
  period              = 10800
  evaluation_periods  = 1
  threshold           = 30
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}
