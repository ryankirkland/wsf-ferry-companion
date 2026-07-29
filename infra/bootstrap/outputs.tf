output "tfstate_bucket" {
  description = "S3 bucket holding Terraform state for all stacks."
  value       = aws_s3_bucket.tfstate.id
}

output "github_plan_role_arn" {
  description = "Role assumed by pull-request plan runs."
  value       = aws_iam_role.github_plan.arn
}

output "github_apply_role_arn" {
  description = "Role assumed by main-branch apply runs."
  value       = aws_iam_role.github_apply.arn
}

output "github_oidc_provider_arn" {
  description = "GitHub Actions OIDC identity provider."
  value       = aws_iam_openid_connect_provider.github.arn
}
