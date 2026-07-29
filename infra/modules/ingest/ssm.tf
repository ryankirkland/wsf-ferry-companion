# Parameter shell only: the real access code is set once by a human
#   aws ssm put-parameter --name /wsf/prod/wsf-access-code \
#     --type SecureString --value <code> --overwrite
# so the secret never enters Terraform state or version control.
resource "aws_ssm_parameter" "wsf_access_code" {
  name  = "/wsf/prod/wsf-access-code"
  type  = "SecureString"
  value = "PLACEHOLDER-set-via-cli"

  lifecycle {
    ignore_changes = [value]
  }
}
