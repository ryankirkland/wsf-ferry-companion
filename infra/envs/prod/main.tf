# api.<domain_name> - computed here rather than read from module.api's
# output, so that static_site (which analytics reads the data bucket
# from) never forms a module dependency on api (which reads analytics'
# Lambda outputs). module.api derives the identical string internally;
# see infra/modules/api/apigw.tf's own local.api_domain.
locals {
  api_domain = "api.${var.domain_name}"
}

module "static_site" {
  source = "../../modules/static-site"

  domain_name              = var.domain_name
  zone_id                  = aws_route53_zone.main.zone_id
  tiles_origin_domain      = module.tiles_fallback.function_url_domain
  events_api_origin_domain = local.api_domain

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
  notify_api_invoke_arn      = module.notify.api_lambda_invoke_arn
  notify_api_function_name   = module.notify.api_lambda_function_name

  events_invoke_arn          = module.analytics.events_lambda_invoke_arn
  events_function_name       = module.analytics.events_lambda_function_name
  events_admin_invoke_arn    = module.analytics.events_admin_lambda_invoke_arn
  events_admin_function_name = module.analytics.events_admin_lambda_function_name
}

# M4 analytics: history collectors + Glue/Athena catalog (ADR-0001).
module "analytics" {
  source = "../../modules/analytics"

  raw_bucket_name  = module.ingest.raw_bucket
  raw_bucket_arn   = module.ingest.raw_bucket_arn
  data_bucket_name = module.static_site.data_bucket_name
  data_bucket_arn  = module.static_site.data_bucket_arn
  table_name       = module.ingest.table_name
  table_arn        = module.ingest.table_arn
  alarms_topic_arn = aws_sns_topic.alarms.arn
  # Built by CI (and locally) before terraform runs - see infra-plan.yml.
  lambda_zip_path = "${path.root}/.build/analytics.zip"
}

# F6 weather: NWS + AirNow per-terminal conditions poller (evidence in
# api-exploration-weather/weather.md). The AirNow key is an SSM
# SecureString set via CLI - never in this state.
module "weather" {
  source = "../../modules/weather"

  data_bucket_name = module.static_site.data_bucket_name
  data_bucket_arn  = module.static_site.data_bucket_arn
  raw_bucket_name  = module.ingest.raw_bucket
  raw_bucket_arn   = module.ingest.raw_bucket_arn
  alarms_topic_arn = aws_sns_topic.alarms.arn
  # Built by CI (and locally) before terraform runs - see infra-plan.yml.
  lambda_zip_path = "${path.root}/.build/weather.zip"
}

# M3 alert-notification foundations: SES identity + Cognito + link-token
# secrets (ADR-0006). Lambdas land in D2/D3.
module "notify" {
  source = "../../modules/notify"

  domain_name            = var.domain_name
  zone_id                = aws_route53_zone.main.zone_id
  table_name             = module.ingest.table_name
  table_arn              = module.ingest.table_arn
  data_bucket_name       = module.static_site.data_bucket_name
  data_bucket_arn        = module.static_site.data_bucket_arn
  alarms_topic_arn       = aws_sns_topic.alarms.arn
  notifier_function_name = local.notifier_function_name
  # Built by CI (and locally) before terraform runs - see infra-plan.yml.
  lambda_zip_path = "${path.root}/.build/notify.zip"
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

# One name, two modules: the notify module creates this function, the
# ingest module's alerts poller invokes it. A string local (not a module
# output) breaks what would otherwise be an ingest<->notify cycle.
locals {
  notifier_function_name = "wsf-prod-notify-fanout"
}

module "ingest" {
  source = "../../modules/ingest"

  notifier_function_name = local.notifier_function_name
  data_bucket_name       = module.static_site.data_bucket_name
  data_bucket_arn        = module.static_site.data_bucket_arn
  distribution_id        = module.static_site.distribution_id
  alarms_topic_arn       = aws_sns_topic.alarms.arn
  # Built by CI (and locally) before terraform runs - see infra-plan.yml.
  lambda_zip_path = "${path.root}/.build/ingest.zip"
}
