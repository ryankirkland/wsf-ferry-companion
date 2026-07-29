# Day-2 task: Cost Explorer can only activate a cost allocation tag after the
# key has appeared in billing data, which lags up to ~24 h behind the first
# tagged resource accruing usage. Attempted 2026-07-29 (skeleton deploy day):
# still "Tag keys not found: project" - retry the next day by uncommenting
# and applying this stack locally. Activation affects billing data from that
# point forward only.
#
# resource "aws_ce_cost_allocation_tag" "project" {
#   tag_key = "project"
#   status  = "Active"
# }
