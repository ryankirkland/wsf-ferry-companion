# Temporary coming-soon page so the walking skeleton serves something real.
# M1 replaces this with a CI content sync and deletes this resource.
resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.web.id
  key          = "index.html"
  source       = "${path.module}/files/index.html"
  etag         = filemd5("${path.module}/files/index.html")
  content_type = "text/html; charset=utf-8"
}
