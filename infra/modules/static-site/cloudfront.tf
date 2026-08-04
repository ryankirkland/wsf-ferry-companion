data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# Short-TTL policy for the realtime snapshot (ADR-0005): the edge re-fetches
# at most every ~5-10 s regardless of viewer count.
resource "aws_cloudfront_cache_policy" "data_short" {
  name        = "wsf-data-short"
  min_ttl     = 0
  default_ttl = 5
  max_ttl     = 10

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# CORS (public data/assets, enables localhost dev and MapLibre cross-origin
# glyph/sprite fetches) + the security headers the managed
# SecurityHeadersPolicy provides. Shared by /data/* and /assets/*.
resource "aws_cloudfront_response_headers_policy" "data_cors" {
  name = "wsf-data-cors"

  cors_config {
    access_control_allow_credentials = false
    origin_override                  = true

    access_control_allow_headers {
      items = ["*"]
    }
    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }
    access_control_allow_origins {
      items = ["*"]
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      override                   = true
    }
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

# Site analytics: /v1/events is fronted by this distribution (not called
# directly against the API's own domain) purely so CloudFront resolves
# viewer geography at the edge and forwards it as headers - the
# alternative was a third-party GeoIP lookup, which the feature's whole
# premise is to avoid. Never cached (it's a POST, and every request
# carries a distinct visitor hash + geo).
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_and_cf_headers" {
  name = "Managed-AllViewerAndCloudFrontHeaders-2022-06"
}

# Maps clean URLs onto the static export's file layout (trailingSlash:
# / -> /index.html, /ambient -> /ambient/index.html). Real file paths
# (anything with a dot) pass through untouched.
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "wsf-prod-index-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri.endsWith("/")) {
        request.uri = uri + "index.html";
      } else if (!uri.split("/").pop().includes(".")) {
        request.uri = uri + "/index.html";
      }
      return request;
    }
  EOT
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "wsf-prod-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "wsf prod site + map assets"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = [var.domain_name]

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id                = "map-assets"
    domain_name              = aws_s3_bucket.map_assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id                = "data"
    domain_name              = aws_s3_bucket.data.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = "events-api"
    domain_name = var.events_api_origin_domain

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  dynamic "origin" {
    for_each = var.tiles_origin_domain == null ? [] : [var.tiles_origin_domain]

    content {
      origin_id   = "tiles-fallback"
      domain_name = origin.value

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  # Honest 404s (no SPA rewrite): S3+OAC surfaces missing keys as 403.
  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 404
    response_page_path = "/404.html"
  }

  ordered_cache_behavior {
    path_pattern               = "/data/*"
    target_origin_id           = "data"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.data_short.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.data_cors.id
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.tiles_origin_domain == null ? [] : [1]

    content {
      path_pattern               = "/tiles/*"
      target_origin_id           = "tiles-fallback"
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD", "OPTIONS"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.data_cors.id
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/v1/events"
    target_origin_id           = "events-api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_and_cf_headers.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }


  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "map-assets"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.data_cors.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
