# The M0 coming-soon placeholder is now managed by the web-deploy CI sync.
# `removed` forgets the object without deleting it - a plain resource
# deletion would destroy the live site's index.html.
removed {
  from = module.static_site.aws_s3_object.index

  lifecycle {
    destroy = false
  }
}
