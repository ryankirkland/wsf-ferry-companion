variable "domain_name" {
  description = "Canonical apex domain; the API is also served on api.<domain_name>."
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
  primary_api_domain = "api.${var.domain_name}"
}

variable "notify_api_invoke_arn" {
  description = "Subscription API Lambda invoke ARN (module notify, M3)."
  type        = string
}

variable "notify_api_function_name" {
  type = string
}

variable "events_invoke_arn" {
  description = "Site-analytics collector Lambda invoke ARN (module analytics)."
  type        = string
}

variable "events_function_name" {
  type = string
}

variable "events_admin_invoke_arn" {
  description = "Site-analytics admin-read Lambda invoke ARN (module analytics)."
  type        = string
}

variable "events_admin_function_name" {
  type = string
}
