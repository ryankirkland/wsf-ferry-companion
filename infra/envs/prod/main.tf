module "static_site" {
  source = "../../modules/static-site"

  domain_name         = var.domain_name
  zone_id             = aws_route53_zone.main.zone_id
  tiles_origin_domain = module.tiles_fallback.function_url_domain

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

# ADR-0003 tested fallback: PMTiles + Protomaps Lambda behind /tiles/*.
# Internal posture - nothing links to it until promotion.
module "tiles_fallback" {
  source = "../../modules/tiles-fallback"

  lambda_zip_path = "${path.root}/../../../tools/pmtiles/dist/lambda.zip"
  public_hostname = var.domain_name
}

module "api" {
  source = "../../modules/api"

  domain_name = var.domain_name
  zone_id     = aws_route53_zone.main.zone_id

  cognito_user_pool_endpoint = module.notify.user_pool_endpoint
  cognito_web_client_id      = module.notify.web_client_id
}

# M3 alert-notification foundations: SES identity + Cognito + link-token
# secrets (ADR-0006). Lambdas land in D2/D3.
module "notify" {
  source = "../../modules/notify"

  domain_name = var.domain_name
  zone_id     = aws_route53_zone.main.zone_id
}

# Shared operational alarm channel (ingest now; api/alerts later).
resource "aws_sns_topic" "alarms" {
  name = "wsf-prod-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

module "ingest" {
  source = "../../modules/ingest"

  data_bucket_name = module.static_site.data_bucket_name
  data_bucket_arn  = module.static_site.data_bucket_arn
  distribution_id  = module.static_site.distribution_id
  alarms_topic_arn = aws_sns_topic.alarms.arn
  # Built by CI (and locally) before terraform runs - see infra-plan.yml.
  lambda_zip_path = "${path.root}/.build/ingest.zip"
}
