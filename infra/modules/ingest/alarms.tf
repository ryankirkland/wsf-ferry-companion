# Five alarms, all inside the 10-free tier; every one notifies the shared
# SNS topic. Handled upstream failures surface through custom EMF metrics;
# Lambda Errors is reserved for actual bugs.

# THE SLO alarm: no successful poll for 5 consecutive minutes. Missing data
# breaches, so a dead Lambda, a broken schedule, and an upstream outage all
# look identical - which is the point.
resource "aws_cloudwatch_metric_alarm" "poller_gap" {
  alarm_name          = "wsf-prod-poller-gap"
  alarm_description   = <<-EOT
    Why: not one successful fleet poll in 5 straight minutes, so the live map has outlived its 5-minute honesty budget. A dead Lambda, a broken schedule and a WSDOT outage all look identical here on purpose - silence is the signature.
    Source: WSDOT vessellocations, polled every 15 s.
    Feature: F1 live vessel map + ambient wall display (and the live signals on the sailing schedule).
    Severity: HIGH - riders are looking at stale boats right now.
    First stop: /aws/lambda/wsf-prod-ingest-vessels - the "LastPollError:" line says what upstream actually did.
  EOT
  namespace           = "WSF/Ingest"
  metric_name         = "PollSuccess"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}

# The auth canary: HTTP 400 + Message is this API's only auth-failure
# signature (no 401/403 exists - verified 2026-07-24).
resource "aws_cloudwatch_metric_alarm" "auth_failure" {
  alarm_name          = "wsf-prod-auth-failure"
  alarm_description   = <<-EOT
    Why: WSDOT rejected our access code. This API's only auth-failure signature is HTTP 400 with a Message body (no 401/403 exists - verified 2026-07-24); the poller aborts the minute instead of hammering.
    Source: WSDOT Traveler API access code (SSM SecureString).
    Feature: every WSDOT feed - map, sailing schedule, Ferry Alerts.
    Severity: HIGH - this does not self-heal; the access code needs attention.
    First stop: /aws/lambda/wsf-prod-ingest-vessels.
  EOT
  namespace           = "WSF/Ingest"
  metric_name         = "AuthFailure"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

# 200 + [] is a failure signature to alarm on, never to retry-storm.
resource "aws_cloudwatch_metric_alarm" "empty_fleet" {
  alarm_name          = "wsf-prod-empty-fleet"
  alarm_description   = <<-EOT
    Why: WSDOT answered HTTP 200 with an empty vessel list for 3 straight minutes. "No boats" from a fleet that never sleeps is upstream failure, not fact - the site keeps serving the last good snapshot behind its staleness banner, and the poller deliberately does not retry-storm.
    Source: WSDOT vessellocations.
    Feature: F1 live vessel map + ambient wall display.
    Severity: MEDIUM - riders see an honest stale banner; nothing on our side to fix, but confirm it recovers.
  EOT
  namespace           = "WSF/Ingest"
  metric_name         = "EmptyFleet"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "poller_errors" {
  alarm_name          = "wsf-prod-poller-errors"
  alarm_description   = <<-EOT
    Why: the fleet poller itself crashed - an unhandled exception, NOT upstream trouble. WSDOT failures are absorbed in-code as PollFailure / AuthFailure / EmptyFleet metrics, so landing here means our code, a payload shape the parser has never seen, or an AWS dependency (SSM, DynamoDB, S3) failing. The next minute's run is the retry.
    Source: the wsf-prod-ingest-vessels Lambda (bug or AWS dependency), not the WSDOT feed.
    Feature: F1 live vessel map + ambient wall display.
    Severity: LOW for a single firing that returns to OK - it already self-healed, read the trace when convenient. HIGH if it stays in alarm or wsf-prod-poller-gap fires alongside it.
    First stop: aws logs tail /aws/lambda/wsf-prod-ingest-vessels --since 30m (the stack trace is there).
  EOT
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]

  dimensions = {
    FunctionName = aws_lambda_function.poller.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "dims_errors" {
  alarm_name          = "wsf-prod-dims-errors"
  alarm_description   = <<-EOT
    Why: the vessel-dimensions refresher crashed, so the vessel dim (classes, lengths, drawings) was not republished this run. Riders keep the last published dim until a later run succeeds.
    Source: the wsf-prod-ingest-dims Lambda reading WSDOT vesselverbose.
    Feature: F1 vessel cards, class icons and map scaling.
    Severity: LOW - the dim changes rarely and the last one keeps serving; act if it fails on consecutive runs.
    First stop: /aws/lambda/wsf-prod-ingest-dims.
  EOT
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]

  dimensions = {
    FunctionName = aws_lambda_function.dims.function_name
  }
}

# M2 additions (total 8 of the 10 free).

resource "aws_cloudwatch_metric_alarm" "schedule_refresh_errors" {
  alarm_name          = "wsf-prod-schedule-refresh-errors"
  alarm_description   = <<-EOT
    Why: the schedule/fares refresher crashed, so pair-day and fares documents were not rebuilt this run. Riders keep the last published schedule; if WSF changed anything since, the site is now quietly behind it.
    Source: the wsf-prod-ingest-schedule Lambda reading WSDOT schedule + fares feeds.
    Feature: F2 sailing schedule + fares.
    Severity: MEDIUM - stale-but-honest for now; treat as HIGH if wsf-prod-pairs-stale fires too.
    First stop: /aws/lambda/wsf-prod-ingest-schedule.
  EOT
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]

  dimensions = {
    FunctionName = aws_lambda_function.schedule_refresh.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "alerts_poller_errors" {
  alarm_name          = "wsf-prod-alerts-poller-errors"
  alarm_description   = <<-EOT
    Why: the bulletin poller failed at least 5 times in 15 minutes. A single failed fetch is normal and retries itself the next minute (that is why one error never fires this); five in a window means persistent breakage, and new WSF bulletins - including cancellations - are not being picked up.
    Source: WSDOT schedule alerts feed via the wsf-prod-ingest-alerts Lambda.
    Feature: F3 Ferry Alerts emails + the alert banners on the sailing schedule.
    Severity: HIGH - cancellation notices stop flowing while this is red.
    First stop: /aws/lambda/wsf-prod-ingest-alerts.
  EOT
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]

  dimensions = {
    FunctionName = aws_lambda_function.alerts_poller.function_name
  }
}

# The trip-data equivalent of poller-gap: nothing published for a full day
# means the token gating or the upstream feed is broken. Expressed as 24
# hourly buckets ALL empty (datapoints_to_alarm = 24): a normal day has one
# bucket with data and 23 harmlessly missing; a single 86400 s period with
# treat-missing-breaching fires spuriously on alarm creation and flaps on
# sparse metrics (fired 2026-07-29 within minutes of being created, while
# 532 freshly published files sat on S3).
resource "aws_cloudwatch_metric_alarm" "pairs_stale" {
  alarm_name          = "wsf-prod-pairs-stale"
  alarm_description   = <<-EOT
    Why: not a single pair-date file was published in 24 hours (all 24 hourly buckets empty). The 14-day horizon should roll daily; a whole day of silence means the schedule-token gating, the cron, or the upstream feed is broken.
    Source: WSDOT schedule feed via the wsf-prod-ingest-schedule Lambda.
    Feature: F2 sailing schedule (the date strip and every pair page).
    Severity: HIGH - the browsable horizon is shrinking and today's schedule may be yesterday's truth.
    First stop: /aws/lambda/wsf-prod-ingest-schedule.
  EOT
  namespace           = "WSF/Ingest"
  metric_name         = "PairDatesPublished"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 24
  datapoints_to_alarm = 24
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}
