variable "domain_name" {
  description = "Apex domain; the API is served on api.<domain_name>."
  type        = string
}

variable "zone_id" {
  description = "Route53 hosted zone id for the domain."
  type        = string
}

locals {
  api_domain = "api.${var.domain_name}"
}
