variable "domain_name" {
  description = "Apex domain (ferrysound.com) - the SES sending identity."
  type        = string
}

variable "zone_id" {
  description = "Route53 hosted zone for DKIM/MAIL FROM/DMARC records."
  type        = string
}

variable "table_name" {
  description = "Hot table (subscriptions, suppression, bulletin state)."
  type        = string
}

variable "table_arn" {
  type = string
}

variable "data_bucket_name" {
  description = "Data bucket - the API validates pairs against its index."
  type        = string
}

variable "data_bucket_arn" {
  type = string
}

variable "lambda_zip_path" {
  description = "CI-built zip with wsf-notify + wsf-core."
  type        = string
}

variable "alarms_topic_arn" {
  description = "Ops SNS topic - notifier alarm + OnFailure destination."
  type        = string
}

variable "notifier_function_name" {
  description = "Set at the env level so the alerts poller (ingest module) can reference it without a module cycle."
  type        = string
}
