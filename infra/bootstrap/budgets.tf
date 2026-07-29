# One monthly budget carrying all three PRD thresholds. Notification-only
# budgets are free and unlimited (the "first two free" cap applies only to
# action-enabled budgets). Deliberately unfiltered by tag so untagged mistakes
# still count against the ceiling.
resource "aws_budgets_budget" "monthly_ceiling" {
  name         = "wsf-monthly-ceiling"
  budget_type  = "COST"
  limit_amount = "15"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # The PRD's $10 early-warning line.
  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 66.7
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_email]
  }

  # Trend breach before it happens.
  notification {
    notification_type          = "FORECASTED"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_email]
  }

  # Ceiling hit.
  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_email]
  }
}
