module "static_site" {
  source = "../../modules/static-site"

  domain_name = var.domain_name
  zone_id     = aws_route53_zone.main.zone_id

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

module "api" {
  source = "../../modules/api"

  domain_name = var.domain_name
  zone_id     = aws_route53_zone.main.zone_id
}
