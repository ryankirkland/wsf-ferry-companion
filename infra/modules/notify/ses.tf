# M3 email foundations (ADR-0006). Domain identity with Easy DKIM, a
# custom MAIL FROM subdomain, and DMARC - the full alignment story
# Gmail/Yahoo now require of bulk-ish senders. The account starts in the
# SES sandbox; production access is requested at D2 exit when the whole
# opt-in/opt-out loop is demonstrable.

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain_name
}

resource "aws_route53_record" "dkim" {
  count = 3

  zone_id = var.zone_id
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 3600
  records = ["${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity   = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain = "mail.${var.domain_name}"
  # If MAIL FROM MX resolution fails, fall back to amazonses.com rather
  # than refusing to send - alerts still beat SPF alignment.
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.zone_id
  name    = "mail.${var.domain_name}"
  type    = "MX"
  ttl     = 3600
  records = ["10 feedback-smtp.us-west-2.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.zone_id
  name    = "mail.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=none;"]
}

# Every alert send rides this configuration set; bounce/complaint events
# drive automated suppression (D2), Delivery gives true delivery-time
# latency. No Open/Click tracking - privacy posture, and tracking pixels
# hurt deliverability.
resource "aws_sesv2_configuration_set" "alerts" {
  configuration_set_name = "wsf-prod-alerts"

  reputation_options {
    reputation_metrics_enabled = true
  }
}

resource "aws_sns_topic" "ses_events" {
  name = "wsf-prod-ses-events"
}

resource "aws_sesv2_configuration_set_event_destination" "sns" {
  configuration_set_name = aws_sesv2_configuration_set.alerts.configuration_set_name
  event_destination_name = "ses-events-sns"

  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT", "REJECT", "DELIVERY"]

    sns_destination {
      topic_arn = aws_sns_topic.ses_events.arn
    }
  }
}
