variable "data_bucket_name" {
  description = "Serving bucket for /data/* (owned by static-site; ingest writes it)."
  type        = string
}

variable "data_bucket_arn" {
  description = "ARN of the data bucket."
  type        = string
}

variable "distribution_id" {
  description = "CloudFront distribution id, for targeted dim invalidations."
  type        = string
}

variable "alarms_topic_arn" {
  description = "SNS topic receiving every ingest alarm."
  type        = string
}

variable "lambda_zip_path" {
  description = "Path to the CI-built deterministic ingest artifact."
  type        = string
}

variable "notifier_function_name" {
  description = "M3 fan-out notifier; the alerts poller invokes it on digest change. Name set at env level to avoid a module cycle with modules/notify."
  type        = string
}
