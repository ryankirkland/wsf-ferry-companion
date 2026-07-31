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
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 600

  environment {
    variables = {
      TABLE_NAME            = var.table_name
      RAW_BUCKET            = var.raw_bucket_name
      DATA_BUCKET           = var.data_bucket_name
      WSF_ACCESS_CODE_PARAM = "/wsf/prod/wsf-access-code"
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
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 128
  timeout          = 30

  environment {
    variables = {
      RAW_BUCKET            = var.raw_bucket_name
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
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = [aws_lambda_function.sync.arn, aws_lambda_function.capacity.arn]
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
