data "aws_caller_identity" "current" {}

# Two buckets with fundamentally different lifecycles: the web bucket is
# replaced wholesale on every site deploy (M1 syncs with --delete), while the
# map-assets bucket (glyphs/sprites/style JSON per ADR-0003) holds immutable,
# versioned-by-path files uploaded rarely. Separating them makes the site
# sync safely destructive.
resource "aws_s3_bucket" "web" {
  bucket = "wsf-prod-web-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "map_assets" {
  bucket = "wsf-prod-map-assets-${data.aws_caller_identity.current.account_id}"
}

# Mutable serving data (fleet snapshot + dim JSON), written by the ingest
# service, served at /data/* with a ~5 s TTL. Lives in this module because
# it is a CloudFront serving concern; ingest receives the ARN as an input.
resource "aws_s3_bucket" "data" {
  bucket = "wsf-prod-data-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "data_cloudfront_read" {
  statement {
    sid     = "AllowCloudFrontRead"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.data.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  bucket = aws_s3_bucket.data.id
  policy = data.aws_iam_policy_document.data_cloudfront_read.json

  depends_on = [aws_s3_bucket_public_access_block.data]
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "map_assets" {
  bucket                  = aws_s3_bucket.map_assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "web_cloudfront_read" {
  statement {
    sid     = "AllowCloudFrontRead"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.web.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

data "aws_iam_policy_document" "map_assets_cloudfront_read" {
  statement {
    sid     = "AllowCloudFrontRead"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.map_assets.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_cloudfront_read.json

  depends_on = [aws_s3_bucket_public_access_block.web]
}

resource "aws_s3_bucket_policy" "map_assets" {
  bucket = aws_s3_bucket.map_assets.id
  policy = data.aws_iam_policy_document.map_assets_cloudfront_read.json

  depends_on = [aws_s3_bucket_public_access_block.map_assets]
}

# Rolled-off pair-date files linger harmlessly; the raw archive is the real
# history. Sweep them after 30 days.
resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    id     = "expire-rolled-off-pair-dates"
    status = "Enabled"

    filter {
      prefix = "data/pairs/"
    }

    expiration {
      days = 30
    }
  }
}
