variable "raw_bucket_name" {
  description = "Ground-truth bucket; raw/vesselhistory + raw/terminalsailingspace land here, and the derived analytics/history Parquet lives under analytics/."
  type        = string
}

variable "raw_bucket_arn" {
  type = string
}

variable "data_bucket_name" {
  description = "Serving bucket - the sync Lambda reads the vessels dim for the fleet name list."
  type        = string
}

variable "data_bucket_arn" {
  type = string
}

variable "table_name" {
  description = "Hot table - backfill completion markers (META/BACKFILL#...)."
  type        = string
}

variable "table_arn" {
  type = string
}

variable "lambda_zip_path" {
  description = "CI-built zip (local path, used only for source_code_hash - the pyarrow-bearing artifact exceeds Lambda's 50 MB direct upload, so code deploys from S3)."
  type        = string
}

variable "lambda_zip_s3_key" {
  description = "Key in the raw bucket where CI uploads the zip before terraform apply."
  type        = string
  default     = "build/analytics.zip"
}

variable "alarms_topic_arn" {
  description = "Shared SNS topic for operational alarms."
  type        = string
}
