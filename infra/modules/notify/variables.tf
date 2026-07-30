variable "domain_name" {
  description = "Apex domain (ferrysound.com) - the SES sending identity."
  type        = string
}

variable "zone_id" {
  description = "Route53 hosted zone for DKIM/MAIL FROM/DMARC records."
  type        = string
}
