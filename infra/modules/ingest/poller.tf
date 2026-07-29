data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "poller" {
  statement {
    sid       = "HotTableWrites"
    actions   = ["dynamodb:BatchWriteItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.hot.arn]
  }

  statement {
    sid       = "SnapshotPut"
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
}

resource "aws_iam_role" "poller" {
  name               = "wsf-prod-ingest-vessels"
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
  name              = "/aws/lambda/wsf-prod-ingest-vessels"
  retention_in_days = 30
}

# Timing spec (ADR-0005): 55 s timeout dies before the next tick; reserved
# concurrency 1 + scheduler retry 0 make overlap structurally impossible and
# keep the in-memory dedup cache the single authority. (Reservation was
# briefly dropped while the fresh account's 10-execution quota blocked it;
# restored 2026-07-29 when the increase to 1000 was granted.) 128 MB keeps
# the ~50 s-resident loop inside the Lambda free tier.
resource "aws_lambda_function" "poller" {
  function_name                  = "wsf-prod-ingest-vessels"
  role                           = aws_iam_role.poller.arn
  runtime                        = "python3.12"
  architectures                  = ["arm64"]
  handler                        = "wsf_ingest.poller.lambda_handler"
  filename                       = var.lambda_zip_path
  source_code_hash               = filebase64sha256(var.lambda_zip_path)
  memory_size                    = 128
  timeout                        = 55
  reserved_concurrent_executions = 1

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.hot.name
      DATA_BUCKET           = var.data_bucket_name
      RAW_BUCKET            = aws_s3_bucket.raw.id
      WSF_ACCESS_CODE_PARAM = aws_ssm_parameter.wsf_access_code.name
    }
  }

  depends_on = [aws_cloudwatch_log_group.poller]
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

resource "aws_iam_role" "scheduler" {
  name               = "wsf-prod-ingest-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.poller.arn,
      aws_lambda_function.dims.arn,
    ]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  role   = aws_iam_role.scheduler.name
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

resource "aws_scheduler_schedule" "poller" {
  name                = "wsf-prod-ingest-vessels-1min"
  schedule_expression = "rate(1 minute)"

  flexible_time_window {
    mode = "OFF" # jitter would erode the freshness budget
  }

  target {
    arn      = aws_lambda_function.poller.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0 # the next minute IS the retry (ADR-0005)
    }
  }
}
