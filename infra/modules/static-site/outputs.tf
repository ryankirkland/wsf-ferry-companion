output "cloudfront_domain_name" {
  description = "CloudFront distribution hostname."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "web_bucket" {
  description = "Bucket serving the site root."
  value       = aws_s3_bucket.web.id
}

output "map_assets_bucket" {
  description = "Bucket serving /assets/* (glyphs, sprites, style JSON)."
  value       = aws_s3_bucket.map_assets.id
}
