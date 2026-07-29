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

# GitHub stamps immutable numeric ids into OIDC sub claims
# (repo:OWNER@OWNER_ID/REPO@REPO_ID:...) to defeat name-reuse attacks.
# From `gh api repos/<repo> --jq '{repo_id: .id, owner_id: .owner.id}'`.
variable "github_owner_id" {
  description = "Numeric GitHub id of the repository owner."
  type        = number
  default     = 67440374
}

variable "github_repo_id" {
  description = "Numeric GitHub id of the repository."
  type        = number
  default     = 1311447921
}

variable "budget_email" {
  description = "Email address that receives budget notifications."
  type        = string
  default     = "ryankirkland.py@gmail.com"
}
