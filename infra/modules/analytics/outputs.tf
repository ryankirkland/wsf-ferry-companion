output "events_lambda_invoke_arn" {
  description = "Collector Lambda invoke ARN, wired to POST /v1/events in the api module."
  value       = aws_lambda_function.events.invoke_arn
}

output "events_lambda_function_name" {
  value = aws_lambda_function.events.function_name
}

output "events_admin_lambda_invoke_arn" {
  description = "Admin read Lambda invoke ARN, wired to GET /v1/admin/analytics in the api module."
  value       = aws_lambda_function.events_admin.invoke_arn
}

output "events_admin_lambda_function_name" {
  value = aws_lambda_function.events_admin.function_name
}
