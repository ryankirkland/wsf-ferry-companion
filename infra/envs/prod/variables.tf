variable "region" {
  description = "Home region for all prod resources."
  type        = string
  default     = "us-west-2"
}

variable "domain_name" {
  description = "Canonical apex domain hosted in the existing Route53 public zone."
  type        = string
  default     = "soundferries.com"
}

variable "legacy_domain_name" {
  description = "Previous apex domain retained for permanent redirects and compatibility."
  type        = string
  default     = "ferrysound.com"
}

variable "alarm_email" {
  description = "Email receiving operational alarms (SNS subscription needs one-time confirmation)."
  type        = string
  default     = "ryankirkland.py@gmail.com"
}
