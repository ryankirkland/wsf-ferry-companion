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
