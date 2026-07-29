output "api_domain" {
  description = "Custom domain serving the API."
  value       = local.api_domain
}

output "api_endpoint" {
  description = "Raw API Gateway endpoint (pre-DNS smoke tests)."
  value       = aws_apigatewayv2_api.api.api_endpoint
}
