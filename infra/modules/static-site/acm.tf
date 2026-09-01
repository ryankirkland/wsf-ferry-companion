# CloudFront only accepts ACM certificates issued in us-east-1, hence the
# aliased provider. One certificate covers the canonical, wildcard, and
# retained legacy hostnames.
resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1

  domain_name = var.domain_name
  subject_alternative_names = [
    "*.${var.domain_name}",
    var.legacy_domain_name,
    "*.${var.legacy_domain_name}",
  ]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "site_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => {
      name    = dvo.resource_record_name
      record  = dvo.resource_record_value
      type    = dvo.resource_record_type
      zone_id = endswith(dvo.domain_name, var.domain_name) ? var.zone_id : var.legacy_zone_id
    }
  }

  zone_id         = each.value.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 300
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for record in aws_route53_record.site_cert_validation : record.fqdn]
}
