output "api_domain" {
  description = "Custom domain serving the API."
  value       = local.primary_api_domain
}

output "api_endpoint" {
  description = "Raw API Gateway endpoint (pre-DNS smoke tests)."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "cognito_authorizer_id" {
  description = "JWT authorizer for M3 subscription routes."
  value       = aws_apigatewayv2_authorizer.cognito.id
}
