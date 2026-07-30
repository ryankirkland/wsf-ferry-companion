variable "domain_name" {
  description = "Apex domain; the API is served on api.<domain_name>."
  type        = string
}

variable "zone_id" {
  description = "Route53 hosted zone id for the domain."
  type        = string
}

variable "cognito_user_pool_endpoint" {
  description = "JWT issuer URL for the Cognito authorizer (M3)."
  type        = string
}

variable "cognito_web_client_id" {
  description = "Cognito app client id accepted as JWT audience (M3)."
  type        = string
}

locals {
  api_domain = "api.${var.domain_name}"
}
