provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project    = "wsf"
      env        = "prod"
      managed-by = "terraform"
    }
  }
}

# Used ONLY where AWS global services demand it: CloudFront's ACM certificate
# and the Route53 Domains registrar API both live exclusively in us-east-1.
# No data or compute runs there.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      project    = "wsf"
      env        = "prod"
      managed-by = "terraform"
    }
  }
}
