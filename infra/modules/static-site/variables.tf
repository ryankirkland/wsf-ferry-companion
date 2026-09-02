variable "domain_name" {
  description = "Canonical apex domain the site is served on."
  type        = string
}

variable "zone_id" {
  description = "Route53 hosted zone id for the domain."
  type        = string
}

variable "tiles_origin_domain" {
  description = "Lambda Function URL domain for the PMTiles fallback (/tiles/*); null until the fallback module is wired."
  type        = string
  default     = null
}

variable "events_api_origin_domain" {
  description = "API Gateway custom domain (module api's api_domain) fronted for /v1/events so CloudFront resolves viewer geography and forwards it to the collector Lambda."
  type        = string
}
