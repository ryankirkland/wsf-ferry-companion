output "site_url" {
  description = "The product."
  value       = "https://${var.domain_name}"
}

output "api_url" {
  description = "The API."
  value       = "https://${module.api.api_domain}"
}

output "cloudfront_domain_name" {
  description = "CloudFront hostname (pre-DNS smoke tests)."
  value       = module.static_site.cloudfront_domain_name
}

output "api_endpoint" {
  description = "Raw API Gateway endpoint (pre-DNS smoke tests)."
  value       = module.api.api_endpoint
}

output "map_assets_bucket" {
  description = "Bucket for glyphs/sprites/style JSON (ADR-0003)."
  value       = module.static_site.map_assets_bucket
}

output "fleet_snapshot_url" {
  description = "The map's data contract (ADR-0005)."
  value       = "https://${var.domain_name}/data/fleet.json"
}

output "raw_bucket" {
  description = "Raw archive bucket."
  value       = module.ingest.raw_bucket
}

output "user_pool_id" {
  description = "Cognito user pool ID - needed for the one-time `admin-add-user-to-group` step that grants /admin/analytics access (docs/features/site-analytics.md)."
  value       = module.notify.user_pool_id
}
