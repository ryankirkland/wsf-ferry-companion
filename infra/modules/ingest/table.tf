# Single-table hot state (ADR-0001, ADR-0005). Generic PK/SK so M2 PAIR#
# departures and M3 ALERTS/USER# partitions land without migration. TTL is
# enabled now (free) though M1 items never set expires_at - M2 departure
# items will. PITR turned on at M3 (2026-07-30) exactly as this comment
# always promised: subscriptions are the first non-re-derivable data here.
resource "aws_dynamodb_table" "hot" {
  name                        = "wsf-prod-hot"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}
