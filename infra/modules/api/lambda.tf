# Packaging pattern (M0): archive_file zips src/ directly - right for
# dependency-free functions, and keeps the whole skeleton inside one
# `terraform apply`. Functions that grow third-party deps (M1 pollers) move
# to a CI build step producing the zip, with its hash passed into
# source_code_hash; archive_file stays for dep-free functions.
data "archive_file" "hello" {
  type        = "zip"
  source_dir  = "${path.module}/src"
  output_path = "${path.root}/.terraform/build/api-hello.zip"
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "hello" {
  name               = "wsf-prod-api-hello"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "hello_logs" {
  role       = aws_iam_role.hello.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Explicit log group so retention is bounded (the auto-created default keeps
# logs forever, a slow-drip cost leak).
resource "aws_cloudwatch_log_group" "hello" {
  name              = "/aws/lambda/wsf-prod-api-hello"
  retention_in_days = 30
}

resource "aws_lambda_function" "hello" {
  function_name    = "wsf-prod-api-hello"
  role             = aws_iam_role.hello.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.hello.output_path
  source_code_hash = data.archive_file.hello.output_base64sha256
  memory_size      = 256
  timeout          = 10

  depends_on = [aws_cloudwatch_log_group.hello]
}
