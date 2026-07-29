# ADR-0003 tested-fallback posture: a Washington PMTiles archive in a
# private bucket, served through the official Protomaps Lambda translating
# /tiles/wa/{z}/{x}/{y}.mvt into ranged S3 reads. Internal - nothing links
# to it; it exists so switching tile providers stays a deploy, not a
# migration. Idle cost ~$0 (Lambda free tier; ~1.5 GB storage ~= $0.03/mo).

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "tiles" {
  bucket = "wsf-prod-tiles-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "tiles" {
  bucket                  = aws_s3_bucket.tiles.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
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

data "aws_iam_policy_document" "tiles_read" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.tiles.arn}/*"]
  }
}

resource "aws_iam_role" "tiles" {
  name               = "wsf-prod-tiles-fallback"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "tiles_read" {
  role   = aws_iam_role.tiles.name
  policy = data.aws_iam_policy_document.tiles_read.json
}

resource "aws_iam_role_policy_attachment" "tiles_logs" {
  role       = aws_iam_role.tiles.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "tiles" {
  name              = "/aws/lambda/wsf-prod-tiles-fallback"
  retention_in_days = 30
}

# The official protomaps/PMTiles AWS Lambda bundle, vendored into the repo
# (tools/pmtiles/dist/lambda.zip) - see tools/pmtiles/RUNBOOK.md.
resource "aws_lambda_function" "tiles" {
  function_name    = "wsf-prod-tiles-fallback"
  role             = aws_iam_role.tiles.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  memory_size      = 256
  timeout          = 15

  environment {
    variables = {
      BUCKET          = aws_s3_bucket.tiles.id
      PMTILES_PATH    = "{name}.pmtiles"
      PUBLIC_HOSTNAME = var.public_hostname
      CACHE_CONTROL   = "public, max-age=86400"
    }
  }

  depends_on = [aws_cloudwatch_log_group.tiles]
}

resource "aws_lambda_function_url" "tiles" {
  function_name      = aws_lambda_function.tiles.function_name
  authorization_type = "NONE"
}

output "function_url_domain" {
  description = "Origin domain for the /tiles/* CloudFront behavior."
  value       = replace(replace(aws_lambda_function_url.tiles.function_url, "https://", ""), "/", "")
}

output "tiles_bucket" {
  description = "Bucket holding the PMTiles archive(s)."
  value       = aws_s3_bucket.tiles.id
}
