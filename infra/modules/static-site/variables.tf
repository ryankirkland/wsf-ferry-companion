variable "domain_name" {
  description = "Apex domain the site is served on."
  type        = string
}

variable "zone_id" {
  description = "Route53 hosted zone id for the domain."
  type        = string
}
