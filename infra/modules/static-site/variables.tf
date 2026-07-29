variable "domain_name" {
  description = "Apex domain the site is served on."
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
