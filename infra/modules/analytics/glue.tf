# The analytical catalog (ADR-0001, proven by the Phase C spike). Partition
# projection means no crawler, no partition metadata to drift - but the
# storage.location.template must match the Parquet prefix BYTE-FOR-BYTE
# (trailing slash included) or every query silently returns zero rows.

data "aws_caller_identity" "current" {}

resource "aws_glue_catalog_database" "analytics" {
  name = "wsf_prod_analytics"
}

resource "aws_glue_catalog_table" "history" {
  database_name = aws_glue_catalog_database.analytics.name
  name          = "history"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL       = "TRUE"
    classification = "parquet"

    "projection.enabled"   = "true"
    "projection.year.type" = "integer"
    # Tripwire: sailings outside 2002-2035 silently vanish from queries.
    "projection.year.range"     = "2002,2035"
    "storage.location.template" = "s3://${var.raw_bucket_name}/analytics/history/year=$${year}/"
  }

  partition_keys {
    name = "year"
    type = "int"
  }

  storage_descriptor {
    location      = "s3://${var.raw_bucket_name}/analytics/history/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    # Spike schema minus `cancelled` (a hardcoded false would report 0%
    # cancellations AS DATA - reconciliation-based rates live elsewhere),
    # plus Pacific local columns materialized at transform time so Athena
    # never does timezone math. route_id is best-effort and nullable;
    # terminal PAIR is the primary dimension.
    columns {
      name = "vessel_name"
      type = "string"
    }
    columns {
      name = "departing_terminal_id"
      type = "int"
    }
    columns {
      name = "arriving_terminal_id"
      type = "int"
    }
    columns {
      name = "route_id"
      type = "int"
    }
    columns {
      name = "service_date"
      type = "date"
    }
    columns {
      name = "depart_hhmm_local"
      type = "string"
    }
    columns {
      name = "scheduled_depart"
      type = "timestamp"
    }
    columns {
      name = "actual_depart"
      type = "timestamp"
    }
    columns {
      name = "delay_min"
      type = "float"
    }
  }
}

resource "aws_glue_catalog_table" "site_events" {
  database_name = aws_glue_catalog_database.analytics.name
  name          = "site_events"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL       = "TRUE"
    classification = "json"

    "projection.enabled"   = "true"
    "projection.dt.type"   = "date"
    "projection.dt.format" = "yyyy-MM-dd"
    # Tripwire: same shape as the history table's year range above -
    # events outside this window silently vanish from queries.
    "projection.dt.range"         = "2026-08-01,NOW"
    "projection.dt.interval"      = "1"
    "projection.dt.interval.unit" = "DAYS"
    "storage.location.template"   = "s3://${var.raw_bucket_name}/raw/site_events/dt=$${dt}/"
  }

  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${var.raw_bucket_name}/raw/site_events/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
    }

    # One JSON object per raw event object (the collector Lambda writes
    # one S3 object per request, not batched NDJSON). received_at stays
    # a string - Athena's JSON SerDe is brittle against ISO8601 UTC
    # offsets under the native timestamp type, so queries cast explicitly
    # with from_iso8601_timestamp() rather than trusting silent nulls.
    columns {
      name = "event_type"
      type = "string"
    }
    columns {
      name = "path"
      type = "string"
    }
    columns {
      name = "referrer_host"
      type = "string"
    }
    columns {
      name = "label"
      type = "string"
    }
    columns {
      name = "ambient"
      type = "boolean"
    }
    columns {
      name = "country"
      type = "string"
    }
    columns {
      name = "region"
      type = "string"
    }
    columns {
      name = "city"
      type = "string"
    }
    columns {
      name = "visitor_hash"
      type = "string"
    }
    columns {
      name = "received_at"
      type = "string"
    }
  }
}

resource "aws_s3_bucket" "athena_results" {
  bucket = "wsf-prod-athena-results-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "athena_results" {
  bucket                  = aws_s3_bucket.athena_results.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    id     = "expire-results"
    status = "Enabled"
    filter {}
    expiration {
      days = 7
    }
  }
}

resource "aws_athena_workgroup" "analytics" {
  name = "wsf-prod-analytics"

  configuration {
    # Without enforcement, clients can ignore the cutoff and result config.
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    bytes_scanned_cutoff_per_query     = 2 * 1024 * 1024 * 1024 # ~30x today's worst full scan

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.bucket}/results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }
}
