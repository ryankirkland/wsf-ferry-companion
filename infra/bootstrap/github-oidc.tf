# Both sub-claim spellings are accepted, each pinned to exactly this repo:
# the ID-stamped form GitHub sends today (owner/repo names qualified with
# their immutable numeric ids - verified live 2026-07-29) and the classic
# name-only form, in case the format reverts or varies. OR semantics, no
# widening: every entry names this repository and this event.
locals {
  gh_owner     = split("/", var.github_repo)[0]
  gh_repo_name = split("/", var.github_repo)[1]

  gh_sub_prefixes = [
    "repo:${var.github_repo}",
    "repo:${local.gh_owner}@${var.github_owner_id}/${local.gh_repo_name}@${var.github_repo_id}",
  ]
}

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
      values   = [for p in local.gh_sub_prefixes : "${p}:pull_request"]
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
      values   = [for p in local.gh_sub_prefixes : "${p}:ref:refs/heads/main"]
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

# ---------------------------------------------------------------------------
# Web deploy lane: three permissions, not admin.
#
# The apply lane's AdministratorAccess is argued for above and stands. The
# WEB DEPLOY lane inherited that role without the same argument, and it is a
# materially different shape of job: it runs `pnpm install` and `pnpm build`
# - thousands of transitive packages, arbitrary postinstall hooks - and THEN
# assumes a role. A compromised dependency cannot read credentials at install
# time (none exist yet), but it owns the filesystem and $GITHUB_ENV for the
# rest of the job, so it can wait for the session that arrives three steps
# later. Admin in that window means the subscriber table, mail sent as
# alerts@soundferries.com, and IAM itself.
#
# The workflow now also splits build (no credentials) from deploy (credentials,
# no third-party code), so the untrusted step and the session never share a
# job. This role is the second half of that: even if they did, it can only
# write the web bucket and invalidate the distribution.
data "aws_iam_policy_document" "github_web_deploy_trust" {
  statement {
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
      values   = [for p in local.gh_sub_prefixes : "${p}:ref:refs/heads/main"]
    }
  }
}

data "aws_iam_policy_document" "github_web_deploy" {
  statement {
    sid       = "SyncTheStaticExport"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["arn:aws:s3:::wsf-prod-web-${data.aws_caller_identity.current.account_id}/*"]
  }

  statement {
    # s3 sync diffs the destination before copying: it needs to list.
    sid       = "DiffTheDestination"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::wsf-prod-web-${data.aws_caller_identity.current.account_id}"]
  }

  statement {
    sid       = "PublishTheNewBytes"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"]
  }
}

resource "aws_iam_role" "github_web_deploy" {
  name                 = "wsf-github-web-deploy"
  description          = "Static-site sync + invalidation for pushes to main. Deliberately not admin."
  assume_role_policy   = data.aws_iam_policy_document.github_web_deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "github_web_deploy" {
  name   = "web-deploy"
  role   = aws_iam_role.github_web_deploy.name
  policy = data.aws_iam_policy_document.github_web_deploy.json
}
