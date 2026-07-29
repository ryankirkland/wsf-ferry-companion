# Day-2 task: Cost Explorer can only activate a cost allocation tag after the
# key has appeared in billing data, which lags up to ~24 h behind the first
# tagged resource accruing usage. Attempting this on day one fails with a
# not-found error. Once the skeleton has been deployed for a day, uncomment
# and `terraform apply` this stack locally; activation affects billing data
# from that point forward only.
#
# resource "aws_ce_cost_allocation_tag" "project" {
#   tag_key = "project"
#   status  = "Active"
# }
