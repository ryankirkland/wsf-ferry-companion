# ADR-0004: Terraform state backend and CI deployment model

- **Status:** Accepted (2026-07-28)
- **Context:** M0 needs remote Terraform state, a credential story for CI,
  and a deployment model before the first production resource exists. Version
  facts verified 2026-07-28: Terraform 1.15.x current; S3-native state
  locking (`use_lockfile`) GA since 1.11 with the DynamoDB path deprecated
  upstream; notification-only AWS Budgets free and unlimited.

## Decision

Terraform state lives in a versioned, SSE-S3-encrypted, public-access-blocked,
TLS-only S3 bucket (`wsf-tfstate-654654574183`, us-west-2) using Terraform's
native S3 lockfile - no DynamoDB lock table, which is deprecated upstream and
adds a resource for nothing at our concurrency (one human plus a serialized CI
lane).

A thin account-level bootstrap stack (`infra/bootstrap`), applied only locally
by a human, creates the bucket, the GitHub OIDC provider, the CI roles, and
the billing budget, then migrates its own state into the bucket it created
(the standard self-referential bootstrap pattern). CI never applies bootstrap:
a pipeline must not manage its own credentials or the bucket its state
depends on.

All environment stacks (`infra/envs/*`) are driven by GitHub Actions via OIDC
with no long-lived AWS keys:

- **Pull requests** plan under `wsf-github-plan` (`ReadOnlyAccess`), whose
  trust policy is sub-claim-locked to
  `repo:ryankirkland/wsf-ferry-companion:pull_request`. Plans run with
  `-lock=false`, so the lane is structurally incapable of mutation - proven
  at M0 by an AccessDenied test in the PR lane.
- **Pushes to main** (which branch protection restricts to PR merges) apply
  under `wsf-github-apply` (`AdministratorAccess`), locked to
  `ref:refs/heads/main`. Admin on the apply lane is an explicit trade:
  Terraform manages IAM and a dozen services across M0-M4, so a hand-curated
  allow-list is admin with extra steps plus a recurring maintenance tax. The
  operative controls are the repo- and branch-pinned trust policy, branch
  protection on main (PRs required), CloudTrail management events, and the
  $15 budget as blast-radius alarm. Revisit with a permissions boundary if
  the repo ever gains collaborators.

A GitHub Actions concurrency group serializes applies; the S3 lockfile is the
backstop. The apply lane re-plans on main rather than trusting PR artifacts,
and shows the plan in the run summary immediately before applying.

Two OIDC trust-policy facts learned the hard way at M0 (three failed runs,
diagnosed by decoding the token's claim fields in a throwaway CI step):

1. GitHub stamps immutable numeric ids into sub claims - the live format is
   `repo:OWNER@OWNER_ID/REPO@REPO_ID:pull_request`, not the classic
   `repo:owner/repo:pull_request`. Trust policies accept both spellings, each
   pinned to exactly this repository.
2. `configure-aws-credentials` v6.2+ passes session tags by default, so the
   trust policies must also allow `sts:TagSession` (a win anyway: the tags
   give CloudTrail per-run attribution).

## Alternatives considered

- **DynamoDB lock table:** the pre-1.11 standard; rejected as deprecated
  upstream and strictly more moving parts.
- **Local-only bootstrap state:** laptop loss would orphan the account-level
  resources; rejected.
- **CI plans, human applies from laptop:** maximum control, but main drifts
  ahead of deployed reality and the portfolio story is weaker. Rejected with
  Ryan's sign-off.
- **Least-privilege apply policy:** honest-sounding, practically admin with
  extra steps at this service breadth; rejected for now, revisit condition
  recorded above.

## Consequences

- `main` is always what is deployed (post-merge, within one CI run).
- Direct pushes to main are blocked for everyone, including the owner.
- Fork PRs cannot mint OIDC tokens; their plan job fails at credential
  exchange (static checks still run). Acceptable solo; revisit with
  collaborators.
- Bootstrap changes remain a deliberate, local, human act.
