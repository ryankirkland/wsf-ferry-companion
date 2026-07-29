# M2: the schedule/fares refresher. rate(15 min) with a 600 s timeout -
# overlap structurally impossible; most runs are ~1.5 s token checks, a
# horizon rebuild is ~3-4 min of politely-spaced upstream calls.

data "aws_iam_policy_document" "schedule_refresh" {
  statement {
    sid       = "HotTableReadWrite"
    actions   = ["dynamodb:BatchWriteItem", "dynamodb:PutItem", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.hot.arn]
  }

  statement {
    sid       = "DataPublish"
    actions   = ["s3:PutObject", "s3:GetObject"]
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

resource "aws_iam_role" "schedule_refresh" {
  name               = "wsf-prod-ingest-schedule"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "schedule_refresh" {
  role   = aws_iam_role.schedule_refresh.name
  policy = data.aws_iam_policy_document.schedule_refresh.json
}

resource "aws_iam_role_policy_attachment" "schedule_refresh_logs" {
  role       = aws_iam_role.schedule_refresh.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "schedule_refresh" {
  name              = "/aws/lambda/wsf-prod-ingest-schedule"
  retention_in_days = 30
}

resource "aws_lambda_function" "schedule_refresh" {
  function_name    = "wsf-prod-ingest-schedule"
  role             = aws_iam_role.schedule_refresh.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_ingest.schedule_refresh.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 600

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.hot.name
      DATA_BUCKET           = var.data_bucket_name
      RAW_BUCKET            = aws_s3_bucket.raw.id
      WSF_ACCESS_CODE_PARAM = aws_ssm_parameter.wsf_access_code.name
      HORIZON_DAYS          = "14"
    }
  }

  depends_on = [aws_cloudwatch_log_group.schedule_refresh]
}

resource "aws_scheduler_schedule" "schedule_refresh" {
  name                = "wsf-prod-ingest-schedule-15min"
  schedule_expression = "rate(15 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.schedule_refresh.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
