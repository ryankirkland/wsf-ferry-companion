variable "region" {
  description = "Home region for all account-level resources."
  type        = string
  default     = "us-west-2"
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to assume the CI roles."
  type        = string
  default     = "ryankirkland/wsf-ferry-companion"
}

variable "budget_email" {
  description = "Email address that receives budget notifications."
  type        = string
  default     = "ryankirkland.py@gmail.com"
}
