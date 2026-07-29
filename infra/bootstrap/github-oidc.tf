# AWS validates GitHub's OIDC issuer through its trusted CA chain and has
# ignored thumbprints for this provider since 2023, but the API still requires
# the field; the value below is the conventional placeholder.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_plan_trust" {
  statement {
    # sts:TagSession is required because configure-aws-credentials v6.2+
    # passes session tags by default (useful CloudTrail attribution).
    actions = ["sts:AssumeRoleWithWebIdentity", "sts:TagSession"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:pull_request"]
    }
  }
}

resource "aws_iam_role" "github_plan" {
  name                 = "wsf-github-plan"
  description          = "Read-only terraform plan for pull requests. Plans run with -lock=false so no write access is needed."
  assume_role_policy   = data.aws_iam_policy_document.github_plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "github_plan_readonly" {
  role       = aws_iam_role.github_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "github_apply_trust" {
  statement {
    # sts:TagSession: see github_plan_trust.
    actions = ["sts:AssumeRoleWithWebIdentity", "sts:TagSession"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

# AdministratorAccess on the apply lane is an explicit, documented trade-off
# (ADR-0004): Terraform manages IAM and a dozen services across M0-M4, so a
# hand-curated allow-list would be admin with extra steps. The operative
# controls are the repo- and branch-pinned trust policy above, branch
# protection on main, CloudTrail, and the $15 budget. Revisit with a
# permissions boundary if the repo ever gains collaborators.
resource "aws_iam_role" "github_apply" {
  name                 = "wsf-github-apply"
  description          = "Terraform apply for pushes to main via GitHub Actions OIDC."
  assume_role_policy   = data.aws_iam_policy_document.github_apply_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "github_apply_admin" {
  role       = aws_iam_role.github_apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
