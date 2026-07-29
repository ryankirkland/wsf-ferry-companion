variable "lambda_zip_path" {
  description = "Vendored Protomaps Lambda bundle (tools/pmtiles/dist/lambda.zip)."
  type        = string
}

variable "public_hostname" {
  description = "Hostname tiles are served under (the CloudFront alias)."
  type        = string
}
