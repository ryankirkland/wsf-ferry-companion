# M2: the schedule/fares refresher. rate(15 min) with an 840 s timeout -
# still well inside the 900 s spacing, so overlap with the NEXT scheduled
# run stays structurally impossible. Bumped from 600 s on 2026-08-04: the
# token-gate that's meant to make most runs cheap token checks isn't
# skipping rebuilds (see wsf-prod-schedule-refresh-errors postmortem, task
# 40) - every run does a full 532-call horizon rebuild, which in practice
# takes 470-520 s, leaving too little margin under 600 s. 840 s buys real
# headroom while the token-gate bug itself is tracked separately. No async
# retry (see event_invoke_config below): a timed-out run should surface as
# ONE alarm-worthy error, not be silently re-run by Lambda's default retry
# and double-count against the alarm (that doubling is what turned a
# single slow run into the "1 error/hour" trip on 2026-08-03).

data "aws_iam_policy_document" "schedule_refresh" {
  statement {
    sid = "HotTableReadWrite"
    # UpdateItem: _write_horizon updates the HORIZON item in place rather
    # than replacing it, because three call sites write that item and only
    # one of them knows the last-full-rebuild stamp. Granted 2026-08-23
    # after the switch to update_item shipped without it - the rebuild ran,
    # the stamp write threw AccessDenied, and every run rebuilt again.
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
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
  timeout          = 840

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

# EventBridge invokes Lambda targets asynchronously, and Lambda's own
# async-invoke error handling (separate from the Scheduler retry_policy
# below, which only covers the Invoke API call itself) defaults to 2
# automatic retries on ANY function error, including a timeout. Without
# this, a single slow horizon rebuild that times out gets silently re-run
# up to twice more - tripling wasted compute against an upstream we're
# supposed to be polite to, and recording multiple Lambda Errors
# datapoints for what is one incident (confirmed 2026-08-03: the same
# request ID timed out twice in a row before a third attempt succeeded).
resource "aws_lambda_function_event_invoke_config" "schedule_refresh" {
  function_name          = aws_lambda_function.schedule_refresh.function_name
  maximum_retry_attempts = 0
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
