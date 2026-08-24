# D1 collectors: the nightly vesselhistory sync (03:30 America/Los_Angeles
# - EventBridge Scheduler handles DST so "03:30" means Pacific wall clock)
# and the 1-minute capacity poller. Transform/stats Lambdas arrive in
# D2/D3 and share this zip.

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

# --- history sync (nightly + backfill modes) ---

data "aws_iam_policy_document" "sync" {
  statement {
    sid       = "RawHistoryPut"
    actions   = ["s3:PutObject"]
    resources = ["${var.raw_bucket_arn}/raw/vesselhistory/*"]
  }

  statement {
    sid       = "FleetNamesRead"
    actions   = ["s3:GetObject"]
    resources = ["${var.data_bucket_arn}/data/vessels.json"]
  }

  statement {
    sid       = "BackfillMarkers"
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem"]
    resources = [var.table_arn]
  }

  statement {
    sid       = "AccessCodeRead"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:us-west-2:${data.aws_caller_identity.current.account_id}:parameter/wsf/prod/wsf-access-code"]
  }
}

resource "aws_iam_role" "sync" {
  name               = "wsf-prod-analytics-sync"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "sync" {
  role   = aws_iam_role.sync.name
  policy = data.aws_iam_policy_document.sync.json
}

resource "aws_iam_role_policy_attachment" "sync_logs" {
  role       = aws_iam_role.sync.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "sync" {
  name              = "/aws/lambda/wsf-prod-analytics-sync"
  retention_in_days = 30
}

resource "aws_lambda_function" "sync" {
  function_name    = "wsf-prod-analytics-sync"
  role             = aws_iam_role.sync.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_analytics.sync.lambda_handler"
  s3_bucket        = var.raw_bucket_name
  s3_key           = var.lambda_zip_s3_key
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 600

  environment {
    variables = {
      TABLE_NAME            = var.table_name
      RAW_BUCKET            = var.raw_bucket_name
      DATA_BUCKET           = var.data_bucket_name
      WSF_ACCESS_CODE_PARAM = "/wsf/prod/wsf-access-code"
      TRANSFORM_FUNCTION    = "wsf-prod-analytics-transform"
    }
  }

  depends_on = [aws_cloudwatch_log_group.sync]
}

# --- capacity poller ---

data "aws_iam_policy_document" "capacity" {
  statement {
    sid       = "RawCapacityPut"
    actions   = ["s3:PutObject"]
    resources = ["${var.raw_bucket_arn}/raw/terminalsailingspace/*"]
  }

  statement {
    sid       = "PublishCapacityContract"
    actions   = ["s3:PutObject"]
    resources = ["${var.data_bucket_arn}/data/capacity.json"]
  }

  statement {
    sid       = "AccessCodeRead"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:us-west-2:${data.aws_caller_identity.current.account_id}:parameter/wsf/prod/wsf-access-code"]
  }
}

resource "aws_iam_role" "capacity" {
  name               = "wsf-prod-analytics-capacity"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "capacity" {
  role   = aws_iam_role.capacity.name
  policy = data.aws_iam_policy_document.capacity.json
}

resource "aws_iam_role_policy_attachment" "capacity_logs" {
  role       = aws_iam_role.capacity.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "capacity" {
  name              = "/aws/lambda/wsf-prod-analytics-capacity"
  retention_in_days = 30
}

resource "aws_lambda_function" "capacity" {
  function_name    = "wsf-prod-analytics-capacity"
  role             = aws_iam_role.capacity.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_analytics.capacity.lambda_handler"
  s3_bucket        = var.raw_bucket_name
  s3_key           = var.lambda_zip_s3_key
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 128
  timeout          = 30

  environment {
    variables = {
      RAW_BUCKET            = var.raw_bucket_name
      DATA_BUCKET           = var.data_bucket_name
      WSF_ACCESS_CODE_PARAM = "/wsf/prod/wsf-access-code"
    }
  }

  depends_on = [aws_cloudwatch_log_group.capacity]
}

# --- schedules ---

resource "aws_iam_role" "scheduler" {
  name               = "wsf-prod-analytics-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "lambda:InvokeFunction"
      Resource = [
        aws_lambda_function.sync.arn,
        aws_lambda_function.capacity.arn,
        aws_lambda_function.stats.arn,
        aws_lambda_function.events_stats.arn,
      ]
    }]
  })
}

resource "aws_scheduler_schedule" "sync_nightly" {
  name                         = "wsf-prod-analytics-sync-nightly"
  schedule_expression          = "cron(30 3 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.sync.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 1
    }
  }
}

resource "aws_scheduler_schedule" "capacity_1min" {
  name                = "wsf-prod-analytics-capacity-1min"
  schedule_expression = "rate(1 minute)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.capacity.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# --- transform (D2): raw -> year-partitioned Parquet ---

data "aws_iam_policy_document" "transform" {
  statement {
    sid       = "RawRead"
    actions   = ["s3:GetObject"]
    resources = ["${var.raw_bucket_arn}/raw/vesselhistory/*"]
  }

  statement {
    sid       = "RawList"
    actions   = ["s3:ListBucket"]
    resources = [var.raw_bucket_arn]
  }

  statement {
    sid     = "AnalyticsWrite"
    actions = ["s3:PutObject"]
    resources = [
      "${var.raw_bucket_arn}/analytics/history/*",
      "${var.raw_bucket_arn}/analytics/quarantine/*",
    ]
  }

  statement {
    sid       = "PairsIndexRead"
    actions   = ["s3:GetObject"]
    resources = ["${var.data_bucket_arn}/data/pairs/index.json"]
  }
}

resource "aws_iam_role" "transform" {
  name               = "wsf-prod-analytics-transform"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "transform" {
  role   = aws_iam_role.transform.name
  policy = data.aws_iam_policy_document.transform.json
}

resource "aws_iam_role_policy_attachment" "transform_logs" {
  role       = aws_iam_role.transform.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "transform" {
  name              = "/aws/lambda/wsf-prod-analytics-transform"
  retention_in_days = 30
}

# Async-invoke retries OFF (see the stats twin in stats.tf). sync
# invokes transform asynchronously; a transform failure would otherwise
# re-read the whole 4.2M-row archive up to three times. The nightly
# sweep is the retry.
resource "aws_lambda_function_event_invoke_config" "transform" {
  function_name          = aws_lambda_function.transform.function_name
  maximum_retry_attempts = 0
}

resource "aws_lambda_function" "transform" {
  function_name    = "wsf-prod-analytics-transform"
  role             = aws_iam_role.transform.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_analytics.transform.lambda_handler"
  s3_bucket        = var.raw_bucket_name
  s3_key           = var.lambda_zip_s3_key
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 1536
  timeout          = 900

  environment {
    variables = {
      RAW_BUCKET     = var.raw_bucket_name
      DATA_BUCKET    = var.data_bucket_name
      STATS_FUNCTION = "wsf-prod-analytics-stats"
    }
  }

  depends_on = [aws_cloudwatch_log_group.transform]
}

# sync -> transform chain permission
resource "aws_iam_role_policy" "sync_invokes_transform" {
  name = "invoke-transform"
  role = aws_iam_role.sync.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.transform.arn
    }]
  })
}
