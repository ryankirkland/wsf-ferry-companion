# Cost Explorer surfaces a tag key only after ~24 h of tagged billing data;
# activation succeeded 2026-07-29 (day 2) and feeds the PRD's monthly
# cost-review ritual. Data is tagged from activation forward only.
resource "aws_ce_cost_allocation_tag" "project" {
  tag_key = "project"
  status  = "Active"
}
