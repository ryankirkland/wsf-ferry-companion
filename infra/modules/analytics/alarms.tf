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
  alarm_description   = <<-EOT
    Why: no successful stats publish in 24 h (SLO: fresh daily by 06:00 PT, with the 05:15 catch-up giving 100 minutes of slack before this fires). A dead chain, a broken cron and a silent Athena failure all look identical here on purpose.
    Source: the nightly sync -> transform -> stats chain over WSDOT vesselhistory.
    Feature: F4 on-time record (/stats and the reliability section of every pair page).
    Severity: MEDIUM - riders read yesterday's numbers, honestly labeled with their window; fix before the lag compounds.
    First stop: /aws/lambda/wsf-prod-analytics-stats, then -sync and -transform.
  EOT
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
  alarm_description   = <<-EOT
    Why: stats published fine but describe a world more than 2 days old - collection or transform fell behind, which the freshness alarm cannot see because publishing still succeeds.
    Source: the data_through watermark on the published stats contracts.
    Feature: F4 on-time record.
    Severity: MEDIUM - the numbers are real but aging; the window label on the page keeps it honest meanwhile.
    First stop: /aws/lambda/wsf-prod-analytics-sync (did the sweep run?) then -transform.
  EOT
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
  alarm_description   = <<-EOT
    Why: the transform met a slip name it has never seen - WSDOT renamed or added a slip - and quarantined those sailings, so they are missing from every statistic until the vocabulary catches up.
    Source: WSDOT vesselhistory slip names vs the curated wsf_core.slips vocabulary.
    Feature: F4 on-time record.
    Severity: MEDIUM - stats are silently incomplete, nothing is wrong-wrong. Action: curate wsf_core.slips, redeploy, re-drain the quarantine.
    First stop: /aws/lambda/wsf-prod-analytics-transform (the quarantined name is logged).
  EOT
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
  alarm_description   = <<-EOT
    Why: three or more vessels failed the nightly history sweep. One boat failing is tolerated and isolated by design; several at once points at the upstream feed or credentials, not at any one boat.
    Source: WSDOT vesselhistory, pulled per vessel nightly.
    Feature: F4 on-time record.
    Severity: MEDIUM - last night's sailings are missing from stats until a rerun; the sweep retries nightly.
    First stop: /aws/lambda/wsf-prod-analytics-sync (per-vessel failures are logged with reasons).
  EOT
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
  alarm_description   = <<-EOT
    Why: every vessel returned zero history rows for the night. "No ferries ran" is never true of this fleet - this is a WSDOT outage or the vessel-name vocabulary drifted out from under our queries.
    Source: WSDOT vesselhistory.
    Feature: F4 on-time record.
    Severity: MEDIUM - one night's evidence missing; recheck names before blaming the outage.
    First stop: /aws/lambda/wsf-prod-analytics-sync.
  EOT
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
  alarm_description   = <<-EOT
    Why: the raw -> Parquet transform crashed (unhandled exception). Partitions may be stale or partially rewritten until a clean rerun; handled data problems (like unknown slips) have their own metrics and do not land here.
    Source: the wsf-prod-analytics-transform Lambda (bug or Athena/S3 dependency), not the feed.
    Feature: F4 on-time record.
    Severity: MEDIUM - stats will describe an older world until rerun; wsf-prod-stats-not-fresh backstops it.
    First stop: aws logs tail /aws/lambda/wsf-prod-analytics-transform --since 2h.
  EOT
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
  alarm_description   = <<-EOT
    Why: the stats publisher crashed (unhandled exception), so the /data/stats contracts were not republished this run - riders keep the previous night's numbers.
    Source: the wsf-prod-analytics-stats Lambda (bug or Athena dependency), not the feed.
    Feature: F4 on-time record.
    Severity: MEDIUM - the 05:15 catch-up retries; wsf-prod-stats-not-fresh fires if it stays broken past the slack.
    First stop: aws logs tail /aws/lambda/wsf-prod-analytics-stats --since 2h.
  EOT
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
