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

  # Branded copy helps a little with spam placement; the real fix is the
  # SES-sender switch after production access (W2) - COGNITO_DEFAULT's
  # generic no-reply@verificationemail.com has no DKIM tie to our domain.
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your Ferry Sound confirmation code"
    email_message        = "Welcome aboard. Your Ferry Sound confirmation code is {####}. It expires in 24 hours. If you didn't create an account at ferrysound.com, ignore this email."
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

# Site-analytics dashboard gate (/admin/analytics): every signed-in user
# is a valid alert subscriber, but only members of this group may read
# analytics. No Terraform resource adds Ryan to it - the user doesn't
# necessarily exist at plan time (he signs up through the app like
# anyone else) - see docs/features/site-analytics.md for the one-time
# `aws cognito-idp admin-add-user-to-group` step after first sign-up.
resource "aws_cognito_user_group" "admins" {
  name         = "Admins"
  user_pool_id = aws_cognito_user_pool.users.id
  description  = "Gates /admin/analytics. Membership is manual - see docs/features/site-analytics.md."
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
