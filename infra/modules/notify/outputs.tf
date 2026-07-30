output "user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "user_pool_endpoint" {
  description = "JWT issuer for the API Gateway authorizer."
  value       = "https://${aws_cognito_user_pool.users.endpoint}"
}

output "web_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "ses_events_topic_arn" {
  value = aws_sns_topic.ses_events.arn
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.alerts.configuration_set_name
}

output "link_secrets_parameter_name" {
  value = aws_ssm_parameter.alert_link_secrets.name
}
