resource "aws_apigatewayv2_domain_name" "primary_api" {
  domain_name = local.primary_api_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.primary_api.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "primary_api" {
  api_id      = aws_apigatewayv2_api.api.id
  domain_name = aws_apigatewayv2_domain_name.primary_api.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "primary_api_a" {
  zone_id = var.zone_id
  name    = local.primary_api_domain
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.primary_api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.primary_api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "primary_api_aaaa" {
  zone_id = var.zone_id
  name    = local.primary_api_domain
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.primary_api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.primary_api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
