resource "aws_apigatewayv2_api" "api" {
  name          = "wsf-prod-api"
  protocol_type = "HTTP"

  # M3: the static site calls subscription routes cross-origin. CORS is
  # API-wide on HTTP APIs (harmless for /v1/hello).
  cors_configuration {
    allow_origins = ["https://${var.domain_name}", "http://localhost:3000"]
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "hello" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.hello.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "hello" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /v1/hello"
  target    = "integrations/${aws_apigatewayv2_integration.hello.id}"
}

# Default-route throttling is a free abuse/cost guardrail on a public
# endpoint; generous for real traffic at this scale.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = 50
    throttling_burst_limit = 100
  }

  # Subscription routes get much tighter throttles: they write state and
  # (indirectly) drive email volume - 2 rps is generous for humans.
  dynamic "route_settings" {
    for_each = toset([
      "POST /v1/subscriptions",
      "DELETE /v1/subscriptions/{sid}",
      "POST /v1/unsubscribe",
    ])
    content {
      route_key              = route_settings.value
      throttling_rate_limit  = 2
      throttling_burst_limit = 5
    }
  }

  # A beacon fires on every pageview/click, so it's busier than the
  # mutating routes above, but it's public and unauthenticated - bounded
  # well under the default so a scraper flood can't run up the S3/Lambda
  # bill unnoticed.
  route_settings {
    route_key              = "POST /v1/events"
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }

  depends_on = [aws_apigatewayv2_route.subscriptions, aws_apigatewayv2_route.events]
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.hello.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# M3: Cognito JWT authorizer for /v1/subscriptions routes (attached in
# D2). HTTP API validates the ID token natively - no auth Lambda.
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = [var.cognito_web_client_id]
    issuer   = var.cognito_user_pool_endpoint
  }
}

# M3 D2: subscription + unsubscribe routes -> the notify-api Lambda.
# JWT-protected CRUD; token-authenticated unsubscribe (RFC 8058 - mail
# providers POST without any session, so no authorizer there).
resource "aws_apigatewayv2_integration" "notify_api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.notify_api_invoke_arn
  payload_format_version = "2.0"
}

locals {
  jwt_routes = [
    "POST /v1/subscriptions",
    "GET /v1/subscriptions",
    "DELETE /v1/subscriptions/{sid}",
  ]
  open_routes = [
    "POST /v1/unsubscribe",
    "GET /v1/unsubscribe",
  ]
}

resource "aws_apigatewayv2_route" "subscriptions" {
  for_each = toset(local.jwt_routes)

  api_id             = aws_apigatewayv2_api.api.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.notify_api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "unsubscribe" {
  for_each = toset(local.open_routes)

  api_id    = aws_apigatewayv2_api.api.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.notify_api.id}"
}

resource "aws_lambda_permission" "apigw_notify" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.notify_api_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# Site analytics (Ryan's homegrown usage-tracking feature). The collector
# route is reached through the site's own CloudFront distribution (see
# static-site/cloudfront.tf), not called directly, so CloudFront can
# resolve viewer geography and forward it as headers - this route is
# never hit cross-origin, so it needs no CORS entry above. The admin
# route IS called cross-origin from the app like /v1/subscriptions, and
# reuses the same Cognito JWT authorizer; the Admins-group check happens
# in the Lambda itself (HTTP API authorizers validate the token, not
# group membership).

resource "aws_apigatewayv2_integration" "events" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.events_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "events" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /v1/events"
  target    = "integrations/${aws_apigatewayv2_integration.events.id}"
}

resource "aws_lambda_permission" "apigw_events" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.events_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "events_admin" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.events_admin_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "events_admin" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /v1/admin/analytics"
  target             = "integrations/${aws_apigatewayv2_integration.events_admin.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "apigw_events_admin" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.events_admin_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
