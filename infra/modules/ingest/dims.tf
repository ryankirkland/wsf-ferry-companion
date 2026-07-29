data "aws_iam_policy_document" "dims" {
  statement {
    sid       = "MetaTokens"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.hot.arn]
  }

  statement {
    sid       = "DimPublish"
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
    sid       = "DimInvalidation"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${var.distribution_id}"]
  }
}

resource "aws_iam_role" "dims" {
  name               = "wsf-prod-ingest-dims"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "dims" {
  role   = aws_iam_role.dims.name
  policy = data.aws_iam_policy_document.dims.json
}

resource "aws_iam_role_policy_attachment" "dims_logs" {
  role       = aws_iam_role.dims.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "dims" {
  name              = "/aws/lambda/wsf-prod-ingest-dims"
  retention_in_days = 30
}

resource "aws_lambda_function" "dims" {
  function_name    = "wsf-prod-ingest-dims"
  role             = aws_iam_role.dims.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_ingest.dims.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 60

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.hot.name
      DATA_BUCKET           = var.data_bucket_name
      RAW_BUCKET            = aws_s3_bucket.raw.id
      WSF_ACCESS_CODE_PARAM = aws_ssm_parameter.wsf_access_code.name
      DISTRIBUTION_ID       = var.distribution_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.dims]
}

# cacheflushdate moves ~daily; 15-minute detection is generous.
resource "aws_scheduler_schedule" "dims" {
  name                = "wsf-prod-ingest-dims-15min"
  schedule_expression = "rate(15 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.dims.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
