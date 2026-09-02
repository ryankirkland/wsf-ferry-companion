# Z2FDTNDATAQYW2 is CloudFront's fixed, global hosted zone id (same for every
# distribution ever created; documented constant, not account data).
resource "aws_route53_record" "primary_a" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "primary_aaaa" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  for_each = {
    primary = { zone_id = var.zone_id, name = "www.${var.domain_name}" }
  }

  zone_id = each.value.zone_id
  name    = each.value.name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_aaaa" {
  for_each = {
    primary = { zone_id = var.zone_id, name = "www.${var.domain_name}" }
  }

  zone_id = each.value.zone_id
  name    = each.value.name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}
