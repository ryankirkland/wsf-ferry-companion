output "table_name" {
  description = "Hot-state DynamoDB table."
  value       = aws_dynamodb_table.hot.name
}

output "raw_bucket" {
  description = "Raw archive bucket."
  value       = aws_s3_bucket.raw.id
}

output "poller_function_name" {
  description = "Vessellocations poller Lambda."
  value       = aws_lambda_function.poller.function_name
}

output "dims_function_name" {
  description = "Dims refresher Lambda."
  value       = aws_lambda_function.dims.function_name
}

output "table_arn" {
  value = aws_dynamodb_table.hot.arn
}

output "raw_bucket_arn" {
  value = aws_s3_bucket.raw.arn
}
