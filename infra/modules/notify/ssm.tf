# HMAC secrets for email-borne link tokens (wsf_core.tokens). Same
# discipline as the WSF access code: the real value is set via CLI after
# apply and never enters Terraform state. Value shape is a JSON object
# mapping kid -> secret ({"k1": "<hex>"}); rotation adds k2 and keeps k1
# until the last k1 link in an inbox has aged out.

resource "aws_ssm_parameter" "alert_link_secrets" {
  name  = "/wsf/prod/alert-link-secrets"
  type  = "SecureString"
  value = "{}"

  lifecycle {
    ignore_changes = [value]
  }
}
