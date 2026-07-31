# D3 stats materializer: Athena -> static JSON (ADR-0005 - nobody waits
# on a query at request time). Invoked by the transform on success, with a
# late-morning catch-up cron behind it: ordering by causality, not by
# betting that a clock offset is longer than the transform takes.

data "aws_iam_policy_document" "stats" {
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
    sid     = "ReadHistoryAndSchedules"
    actions = ["s3:GetObject"]
    resources = [
      "${var.raw_bucket_arn}/analytics/history/*",
      "${var.raw_bucket_arn}/raw/schedule_refresh/*",
    ]
  }

  statement {
    sid       = "ListRaw"
    actions   = ["s3:ListBucket"]
    resources = [var.raw_bucket_arn]
  }

  statement {
    sid = "DefaultCatalog"
    # Athena resolves the unqualified database through AwsDataCatalog;
    # without this the first query fails on a permission, not on SQL.
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
    sid       = "PublishContracts"
    actions   = ["s3:PutObject"]
    resources = ["${var.data_bucket_arn}/data/stats/*"]
  }

  statement {
    sid       = "PairDirectory"
    actions   = ["s3:GetObject"]
    resources = ["${var.data_bucket_arn}/data/pairs/index.json"]
  }
}

resource "aws_iam_role" "stats" {
  name               = "wsf-prod-analytics-stats"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "stats" {
  role   = aws_iam_role.stats.name
  policy = data.aws_iam_policy_document.stats.json
}

resource "aws_iam_role_policy_attachment" "stats_logs" {
  role       = aws_iam_role.stats.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "stats" {
  name              = "/aws/lambda/wsf-prod-analytics-stats"
  retention_in_days = 30
}

resource "aws_lambda_function" "stats" {
  function_name    = "wsf-prod-analytics-stats"
  role             = aws_iam_role.stats.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_analytics.stats.lambda_handler"
  s3_bucket        = var.raw_bucket_name
  s3_key           = var.lambda_zip_s3_key
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 512
  timeout          = 600

  environment {
    variables = {
      RAW_BUCKET       = var.raw_bucket_name
      DATA_BUCKET      = var.data_bucket_name
      GLUE_DATABASE    = aws_glue_catalog_database.analytics.name
      ATHENA_WORKGROUP = aws_athena_workgroup.analytics.name
    }
  }

  depends_on = [aws_cloudwatch_log_group.stats]
}

resource "aws_iam_role_policy" "transform_invokes_stats" {
  name = "invoke-stats"
  role = aws_iam_role.transform.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.stats.arn
    }]
  })
}

# Catch-up only: if the chain already published tonight this is a cheap
# no-op rewrite of the same numbers, and if the chain broke it still puts
# fresh stats in front of riders before the 06:00 PT freshness SLO.
resource "aws_scheduler_schedule" "stats_catchup" {
  name                         = "wsf-prod-analytics-stats-catchup"
  schedule_expression          = "cron(15 5 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.stats.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ trigger = "catchup-cron" })

    retry_policy {
      maximum_retry_attempts = 1
    }
  }
}
