# D2: the subscription API + SES-event suppression Lambdas. Both ride one
# zip (wsf-notify + wsf-core wheels, built by CI). Routes/permissions for
# the API live in modules/api, which owns the HTTP API and its stage.

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# --- subscription API ---

data "aws_iam_policy_document" "api" {
  statement {
    sid = "SubscriptionItems"
    actions = [
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = [var.table_arn]
  }

  statement {
    sid       = "PairsIndexRead"
    actions   = ["s3:GetObject"]
    resources = ["${var.data_bucket_arn}/data/pairs/index.json"]
  }

  statement {
    sid       = "LinkSecretsRead"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.alert_link_secrets.arn]
  }
}

resource "aws_iam_role" "api" {
  name               = "wsf-prod-notify-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.name
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/wsf-prod-notify-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "api" {
  function_name    = "wsf-prod-notify-api"
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_notify.api.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 10

  environment {
    variables = {
      TABLE_NAME         = var.table_name
      DATA_BUCKET        = var.data_bucket_name
      LINK_SECRETS_PARAM = aws_ssm_parameter.alert_link_secrets.name
      SITE_ORIGIN        = "https://${var.legacy_domain_name}"
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

# --- SES event suppression ---

data "aws_iam_policy_document" "suppress" {
  statement {
    sid = "SuppressionWrites"
    actions = [
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = [var.table_arn]
  }
}

resource "aws_iam_role" "suppress" {
  name               = "wsf-prod-notify-suppress"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "suppress" {
  role   = aws_iam_role.suppress.name
  policy = data.aws_iam_policy_document.suppress.json
}

resource "aws_iam_role_policy_attachment" "suppress_logs" {
  role       = aws_iam_role.suppress.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "suppress" {
  name              = "/aws/lambda/wsf-prod-notify-suppress"
  retention_in_days = 30
}

resource "aws_lambda_function" "suppress" {
  function_name    = "wsf-prod-notify-suppress"
  role             = aws_iam_role.suppress.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "wsf_notify.suppress.lambda_handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 128
  timeout          = 30

  environment {
    variables = {
      TABLE_NAME = var.table_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.suppress]
}

resource "aws_sns_topic_subscription" "ses_events_to_suppress" {
  topic_arn = aws_sns_topic.ses_events.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.suppress.arn
}

resource "aws_lambda_permission" "sns_invoke_suppress" {
  statement_id  = "AllowSnsInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.suppress.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.ses_events.arn
}
