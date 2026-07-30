"""M3 alert notifications (ADR-0006, docs/features/alerts.md).

Three Lambdas grow here:
- api:        subscription CRUD behind the Cognito JWT authorizer (D2)
- suppress:   SES bounce/complaint events -> suppression + sub removal (D2)
- notifier:   bulletin diff -> window matching -> capped SES fan-out (D3)

Shared primitives (tokens, alert digest, parsing) live in wsf-core.
"""
