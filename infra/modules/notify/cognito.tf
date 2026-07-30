# Cognito user pool (Ryan's call, per the PRD roadmap): email sign-in,
# verified email required, SRP from the static site - no hosted UI.
# Email sending starts on COGNITO_DEFAULT (works while SES is sandboxed,
# 50/day cap); switches to the SES identity after production access (W2).

resource "aws_cognito_user_pool" "users" {
  name = "wsf-prod-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  deletion_protection = "ACTIVE"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 3
      max_length = 254
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "wsf-prod-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # SPA client: no secret, SRP only - passwords never transit our code.
  generate_secret = false
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
