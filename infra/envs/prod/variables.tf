variable "region" {
  description = "Home region for all prod resources."
  type        = string
  default     = "us-west-2"
}

variable "domain_name" {
  description = "Apex domain (registered manually in Route53; Terraform owns the zone and DNS)."
  type        = string
  default     = "ferrysound.com"
}
