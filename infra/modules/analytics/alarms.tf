# Analytics alarms. Handled failures surface as EMF metrics; Lambda Errors
# stays reserved for actual bugs. All notify the shared SNS topic.
#
# These seven push the account past the 10-alarm free tier (~$0.60/mo at
# $0.10 per extra alarm) - a deliberate trade, since every one of them
# detects a failure whose signature is silence. Deliberately NOT alarmed:
# zero-row backfills, which only happen during an operator-supervised run
# where the invoke output is read live.

# The freshness SLO (PRD: stats fresh daily by 06:00 PT). Missing data
# breaches, so a dead chain, a broken cron and a silent Athena failure all
# look identical - which is the point. The 05:15 catch-up gives the
# nightly chain 100 minutes of slack before this fires.
resource "aws_cloudwatch_metric_alarm" "stats_stale" {
  alarm_name          = "wsf-prod-stats-not-fresh"
  alarm_description   = "No successful stats publish in 24h - riders are reading yesterday's numbers or older."
  namespace           = "WSF/Analytics"
  metric_name         = "StatsPublished"
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarms_topic_arn]
  ok_actions          = [var.alarms_topic_arn]
}

# Publishing succeeded but on stale evidence: the collectors or transform
# fell behind and the stats are quietly describing an old world.
resource "aws_cloudwatch_metric_alarm" "stats_data_lag" {
  alarm_name          = "wsf-prod-stats-data-lag"
  alarm_description   = "Published stats trail the calendar by more than 2 days - collection or transform is behind."
  namespace           = "WSF/Analytics"
  metric_name         = "StatsDataLagDays"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 2
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

# A slip name we have never seen means the vocabulary drifted and those
# sailings are sitting in quarantine, out of every statistic.
resource "aws_cloudwatch_metric_alarm" "unmapped_slip" {
  alarm_name          = "wsf-prod-analytics-unmapped-slip"
  alarm_description   = "Transform quarantined sailings under an unknown slip name - curate wsf_core.slips and re-drain."
  namespace           = "WSF/Analytics"
  metric_name         = "UnmappedSlip"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

# One boat failing is tolerable and isolated by design; a sweep where
# several fail is an upstream or credential problem.
resource "aws_cloudwatch_metric_alarm" "history_vessel_failures" {
  alarm_name          = "wsf-prod-analytics-history-failures"
  alarm_description   = "Three or more vessels failed a nightly history sweep."
  namespace           = "WSF/Analytics"
  metric_name         = "HistoryVesselFailures"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

# 200 [] for every vessel: an outage or a name-vocabulary change, never
# "no ferries ran last week".
resource "aws_cloudwatch_metric_alarm" "history_empty_night" {
  alarm_name          = "wsf-prod-analytics-empty-night"
  alarm_description   = "Every vessel returned zero history rows - upstream outage or vessel-name drift."
  namespace           = "WSF/Analytics"
  metric_name         = "HistoryEmptyNight"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarms_topic_arn]
}

# Crashes in the derived-data path. Split per function so the page says
# which stage broke.
resource "aws_cloudwatch_metric_alarm" "transform_errors" {
  alarm_name          = "wsf-prod-analytics-transform-errors"
  alarm_description   = "The transform Lambda raised - partitions may be stale or partially rewritten."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.transform.function_name }
  alarm_actions       = [var.alarms_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "stats_errors" {
  alarm_name          = "wsf-prod-analytics-stats-errors"
  alarm_description   = "The stats Lambda raised - contracts were not republished this run."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.stats.function_name }
  alarm_actions       = [var.alarms_topic_arn]
}
