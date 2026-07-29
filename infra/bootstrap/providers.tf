provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project    = "wsf"
      env        = "account"
      managed-by = "terraform"
    }
  }
}
