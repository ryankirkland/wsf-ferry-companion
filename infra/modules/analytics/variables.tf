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
  description = "CI-built zip with wsf-analytics + wsf-core + wsf-ingest shim."
  type        = string
}
