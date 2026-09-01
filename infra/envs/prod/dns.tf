data "aws_route53_zone" "primary" {
  name         = var.domain_name
  private_zone = false
}

resource "aws_route53_zone" "main" {
  # This state address intentionally remains `main`: it already owns the
  # ferrysound.com zone. Renaming it during the cutover adds state risk with
  # no runtime benefit.
  name = var.legacy_domain_name
}

# Adopts the manually registered domain (this resource never registers or
# deletes a registration; destroy only forgets it) and keeps the
# registration's name servers pointed at our zone declaratively - if the zone
# is ever recreated, delegation follows automatically. First apply requires
# the registration to exist; registry NS propagation can take a few hours,
# during which ACM validation may time out - just re-run the apply.
resource "aws_route53domains_registered_domain" "main" {
  provider = aws.us_east_1

  domain_name   = var.legacy_domain_name
  auto_renew    = true
  transfer_lock = true

  dynamic "name_server" {
    for_each = aws_route53_zone.main.name_servers

    content {
      name = name_server.value
    }
  }
}
