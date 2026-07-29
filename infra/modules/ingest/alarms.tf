# Five alarms, all inside the 10-free tier; every one notifies the shared
# SNS topic. Handled upstream failures surface through custom EMF metrics;
# Lambda Errors is reserved for actual bugs.

# THE SLO alarm: no successful poll for 5 consecutive minutes. Missing data
# breaches, so a dead Lambda, a broken schedule, and an upstream outage all
# look identical - which is the point.
resource "aws_cloudwatch_metric_alarm" "poller_gap" {
  alarm_name          = "wsf-prod-poller-gap"
  alarm_description   = "No successful vessellocations poll in 5 minutes (SLO: no realtime gap > 5 min)."
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
  alarm_description   = "Upstream returned the 400+Message auth-failure signature."
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
  alarm_description   = "Upstream served an empty vessel list for 3 consecutive minutes."
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
  alarm_description   = "Unhandled exception in the poller (bugs only - handled failures use WSF/Ingest metrics)."
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
  alarm_description   = "Unhandled exception in the dims refresher."
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
  alarm_description   = "Unhandled exception in the schedule/fares refresher."
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
  alarm_description   = "Unhandled exception in the alerts poller (persistent upstream breakage lands here - one failed fetch per minute retries itself)."
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
  alarm_description   = "No pair-date files published in 24 h (horizon should roll daily)."
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
