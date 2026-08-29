"""M3 alert notifications (ADR-0006, docs/features/alerts.md).

Four Lambdas live here:
- api:        subscription CRUD behind the Cognito JWT authorizer
- suppress:   SES bounce/complaint events -> suppression + sub removal
- notifier:   bulletin diff + subscription matching -> SQS
- delivery:   retryable SQS message -> capped SES send

Shared primitives (tokens, alert digest, parsing) live in wsf-core.
"""
