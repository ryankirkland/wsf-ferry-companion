# Site analytics (homegrown, no third-party SaaS - Ryan's call): a
# collector Lambda behind POST /v1/events, a nightly aggregator that
# rolls raw events into private daily/monthly summaries, and an
# admin-only read Lambda that serves those summaries to /admin/analytics.
#
# Deliberately lighter than the F4 history pipeline: raw events are read
# directly as JSON through Glue (no Parquet transform stage) since this
# dataset's volume never justifies the extra Lambda - see
# docs/features/site-analytics.md for the full rationale.

# --- collector ---

data "aws_iam_policy_document" "events" {
  statement {
    sid       = "RawEventsPut"
    actions   = ["s3:PutObject"]
    resources = ["${var.raw_bucket_arn}/raw/site_events/*"]
  }
}

resource "aws_iam_role" "events" {
  name               = "wsf-prod-analytics-events"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "events" {
  role   = aws_iam_role.events.name
  policy = data.aws_iam_policy_document.events.json
}

resource "aws_iam_role_policy_attachment" "events_logs" {
  role       = aws_iam_role.events.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "events" {
  name              = "/aws/lambda/wsf-prod-analytics-events"
  retention_in_days = 30
}

resource "aws_lambda_function" "events" {
  function_name    = "wsf-prod-analytics-events"
  role             = aws_iam_role.events.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_analytics.events.lambda_handler"
  s3_bucket        = var.raw_bucket_name
  s3_key           = var.lambda_zip_s3_key
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 128
  timeout          = 10

  environment {
    variables = {
      RAW_BUCKET = var.raw_bucket_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.events]
}

# --- nightly aggregator: raw JSON -> private daily/monthly summaries ---

data "aws_iam_policy_document" "events_stats" {
  statement {
    sid = "RunQueries"
    actions = [
      "athena:StartQueryExecution",
      "athena:GetQueryExecution",
      "athena:GetQueryResults",
      "athena:GetWorkGroup",
    ]
    resources = [aws_athena_workgroup.analytics.arn]
  }

  statement {
    sid = "ReadCatalog"
    actions = [
      "glue:GetDatabase",
      "glue:GetDatabases",
      "glue:GetTable",
      "glue:GetTables",
      "glue:GetPartition",
      "glue:GetPartitions",
    ]
    resources = [
      "arn:aws:glue:us-west-2:${data.aws_caller_identity.current.account_id}:catalog",
      aws_glue_catalog_database.analytics.arn,
      "${replace(aws_glue_catalog_database.analytics.arn, ":database/", ":table/")}/*",
    ]
  }

  statement {
    sid       = "ReadRawEvents"
    actions   = ["s3:GetObject"]
    resources = ["${var.raw_bucket_arn}/raw/site_events/*"]
  }

  statement {
    sid       = "ListRaw"
    actions   = ["s3:ListBucket"]
    resources = [var.raw_bucket_arn]
  }

  statement {
    sid       = "DefaultCatalog"
    actions   = ["athena:GetDataCatalog"]
    resources = ["arn:aws:athena:us-west-2:${data.aws_caller_identity.current.account_id}:datacatalog/AwsDataCatalog"]
  }

  statement {
    sid = "AthenaResults"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.athena_results.arn}/*"]
  }

  statement {
    sid       = "ListResults"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.athena_results.arn]
  }

  statement {
    sid     = "PublishPrivateSummaries"
    actions = ["s3:PutObject"]
    resources = [
      "${var.raw_bucket_arn}/analytics/site_events_daily/*",
      "${var.raw_bucket_arn}/analytics/site_events_monthly/*",
    ]
  }
}

resource "aws_iam_role" "events_stats" {
  name               = "wsf-prod-analytics-events-stats"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "events_stats" {
  role   = aws_iam_role.events_stats.name
  policy = data.aws_iam_policy_document.events_stats.json
}

resource "aws_iam_role_policy_attachment" "events_stats_logs" {
  role       = aws_iam_role.events_stats.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "events_stats" {
  name              = "/aws/lambda/wsf-prod-analytics-events-stats"
  retention_in_days = 30
}

resource "aws_lambda_function" "events_stats" {
  function_name    = "wsf-prod-analytics-events-stats"
  role             = aws_iam_role.events_stats.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_analytics.events_stats.lambda_handler"
  s3_bucket        = var.raw_bucket_name
  s3_key           = var.lambda_zip_s3_key
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 300

  environment {
    variables = {
      RAW_BUCKET       = var.raw_bucket_name
      GLUE_DATABASE    = aws_glue_catalog_database.analytics.name
      ATHENA_WORKGROUP = aws_athena_workgroup.analytics.name
    }
  }

  depends_on = [aws_cloudwatch_log_group.events_stats]
}

# No upstream Lambda to chain from (events arrive continuously, not in a
# single nightly batch) - one direct nightly schedule is enough, and the
# same-key overwrite makes a re-run harmless if it ever needs a manual
# kick.
resource "aws_scheduler_schedule" "events_stats_nightly" {
  name                         = "wsf-prod-analytics-events-stats-nightly"
  schedule_expression          = "cron(10 4 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.events_stats.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "events_stats_errors" {
  alarm_name          = "wsf-prod-analytics-events-stats-errors"
  alarm_description   = "The events-stats Lambda raised - /admin/analytics is serving stale or partial summaries."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.events_stats.function_name }
  alarm_actions       = [var.alarms_topic_arn]
}

# The beacon path is fire-and-forget end to end: the browser swallows
# failed sends by design, and a broken CloudFront->API Gateway hop 502s
# without ever invoking the collector - which is exactly how zero events
# were collected from launch (2026-08-03) until 2026-08-15 with no alarm
# saying so. This alarm is the missing detector: EventsCollected absent
# or zero across all 24 hourly buckets of a day. Same shape as
# wsf-prod-pairs-stale (hourly buckets, datapoints_to_alarm = 24) so one
# quiet hour - or alarm creation itself - cannot fire it spuriously. A
# genuinely zero-visitor day can fire it; on this site's traffic that is
# itself worth a look, and the ambient wall display makes it unlikely.
resource "aws_cloudwatch_metric_alarm" "events_collection_silent" {
  alarm_name          = "wsf-prod-analytics-events-collection-silent"
  alarm_description   = "No analytics events collected in 24 h - beacon, CloudFront /v1/events hop, or collector is broken."
  namespace           = "WSF/Analytics"
  metric_name         = "EventsCollected"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 24
  datapoints_to_alarm = 24
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}

# --- admin read API: serves the private summaries to /admin/analytics ---

data "aws_iam_policy_document" "events_admin" {
  statement {
    sid     = "ReadPrivateSummaries"
    actions = ["s3:GetObject"]
    resources = [
      "${var.raw_bucket_arn}/analytics/site_events_daily/*",
      "${var.raw_bucket_arn}/analytics/site_events_monthly/*",
    ]
  }

  # Without ListBucket, S3 masks a MISSING key as AccessDenied instead of
  # NoSuchKey (so callers cannot probe key existence) - which turned every
  # date before the feature existed into a 500. The handler's
  # missing-summary path expects NoSuchKey; this makes that error
  # reachable. Scoped by prefix so this read-only role still cannot
  # enumerate the raw archive.
  statement {
    sid       = "ListSummaryPrefixes"
    actions   = ["s3:ListBucket"]
    resources = [var.raw_bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        "analytics/site_events_daily/*",
        "analytics/site_events_monthly/*",
      ]
    }
  }
}

resource "aws_iam_role" "events_admin" {
  name               = "wsf-prod-analytics-events-admin"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "events_admin" {
  role   = aws_iam_role.events_admin.name
  policy = data.aws_iam_policy_document.events_admin.json
}

resource "aws_iam_role_policy_attachment" "events_admin_logs" {
  role       = aws_iam_role.events_admin.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "events_admin" {
  name              = "/aws/lambda/wsf-prod-analytics-events-admin"
  retention_in_days = 30
}

resource "aws_lambda_function" "events_admin" {
  function_name    = "wsf-prod-analytics-events-admin"
  role             = aws_iam_role.events_admin.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_analytics.events_admin.lambda_handler"
  s3_bucket        = var.raw_bucket_name
  s3_key           = var.lambda_zip_s3_key
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 128
  timeout          = 10

  environment {
    variables = {
      RAW_BUCKET = var.raw_bucket_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.events_admin]
}
