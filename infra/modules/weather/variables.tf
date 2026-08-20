variable "data_bucket_name" {
  description = "Static-site data bucket where /data/weather.json publishes."
  type        = string
}

variable "data_bucket_arn" {
  type = string
}

variable "lambda_zip_path" {
  description = "Built by CI (and locally) before terraform runs - see infra-plan.yml."
  type        = string
}

variable "alarms_topic_arn" {
  description = "Shared SNS topic for operational alarms."
  type        = string
}

variable "raw_bucket_name" {
  description = "Raw archive bucket for banked weather polls."
  type        = string
}

variable "raw_bucket_arn" {
  type = string
}
