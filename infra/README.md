# Infrastructure

Terraform for the whole product. Layout:

- `bootstrap/` - account-level stack: state bucket, GitHub OIDC + CI roles,
  billing budget. **Applied locally by a human only** (`AWS_PROFILE=ryan`),
  never by CI. Rarely changes.
- `envs/prod/` - the production environment root. Planned on PRs and applied
  on merge to main by GitHub Actions (see ADR-0004). A future `envs/dev` is a
  new thin root reusing the same modules.
- `modules/static-site/` - CloudFront + web/map-assets buckets + certs + DNS
  for `https://<domain>`.
- `modules/api/` - HTTP API + Lambda + cert + DNS for `https://api.<domain>`.

## Local commands

The `ryan` profile uses `aws login` sessions, which the Terraform AWS SDK
cannot read directly - export env credentials first:

```bash
eval "$(aws configure export-credentials --profile ryan --format env)"
terraform -chdir=infra/envs/prod plan
```

## Bootstrap runbook (already executed 2026-07-28; for rebuild reference)

1. `bootstrap/` with `backend.tf` absent: `terraform init && terraform apply`
   (local state). Creates the state bucket, OIDC provider, roles, budget.
2. Add `backend.tf` (key `bootstrap/terraform.tfstate`), then
   `terraform init -migrate-state` - the stack's state moves into the bucket
   it just created.
3. Delete local `terraform.tfstate*`; commit `backend.tf`.
4. `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`
   in every stack and commit the lock files - CI init fails hash verification
   without the linux hashes.

Destroying bootstrap would require reverse-migrating its state to local
first. Not expected to ever happen; the state bucket carries
`prevent_destroy`.

## Known quirks

- **First prod apply vs NS propagation:** domain registration delegates to
  the Terraform-managed zone via `aws_route53domains_registered_domain`.
  Until the registry NS change propagates (minutes to hours), ACM DNS
  validation can time out. Everything is idempotent - just re-run the apply.
- **us-east-1 provider alias** exists only because CloudFront requires its
  ACM cert there and the Route53 Domains API is us-east-1-only. No data or
  compute lives outside us-west-2.
- **Cost allocation tag (day-2):** `bootstrap/cost-tags.tf` ships commented
  because Cost Explorer cannot activate a tag key until it has appeared in
  billing data (~24 h lag). Uncomment and apply bootstrap locally the day
  after first deploy.
- **Lambda packaging:** dep-free functions are zipped by `archive_file` into
  `.terraform/build/` (gitignored). Functions that grow third-party deps move
  to a CI build step that produces the zip and passes its hash to
  `source_code_hash` (pattern starts with the M1 pollers).
