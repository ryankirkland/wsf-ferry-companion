terraform {
  backend "s3" {
    bucket       = "wsf-tfstate-654654574183"
    key          = "envs/prod/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}
