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

# Publishing fine but the upstream integration is DEAD: not "AirNow had
# a bad afternoon" (their 502/timeout stretches are routine, the
# last-good fallback handles them exactly as designed, and there is no
# action for a human to take) but "no fresh reading has arrived in half
# a day" - an expired API key, a moved endpoint, a parse that silently
# stopped matching. That is rare, actionable, and worth an email.
#
# Threshold math (retuned 2026-08-22 after the first version flapped
# eight emails in one day): the poller runs every 30 min over 21
# terminals, 20 of which carry an AirNow area, so a 12 h window holds at
# most 24 x 41 = 984 fallbacks, and a TOTAL AQI blackout for those 12 h
# is 24 x 20 = 480. Real flaky-but-working days measure ~190 per 12 h
# (2026-08-22: 3 h sums of 23-73 against the old threshold of 30, which
# is why it sat on the line and oscillated). 400 sits above every
# observed flaky day and below a genuine blackout.
#
# No ok_actions: recovery from a third party's outage is not news, and
# double-tapping the ops topic on every transition is how an inbox
# earns the right to be ignored (docs/learnings.md, theme 1).
resource "aws_cloudwatch_metric_alarm" "weather_degraded" {
  alarm_name          = "wsf-prod-weather-degraded"
  alarm_description   = "No fresh weather/AQI for ~12h - the upstream integration looks broken, not merely flaky. Check the API key and the FetchFailed reasons in the poller log."
  namespace           = "WSF/Weather"
  metric_name         = "LastGoodFallbacks"
  statistic           = "Sum"
  period              = 43200
  evaluation_periods  = 1
  threshold           = 400
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}
