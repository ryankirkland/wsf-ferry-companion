# Verified AWS Pricing - us-west-2 (research appendix)

Produced 2026-07-24 for ADR-0001 by a research pass against the AWS Price
List bulk API, cross-checked with marketing pages. Scenario math and the
condensed verdicts live in ADR-0001; this file preserves the full price
table and citations.

| Service | Dimension | us-west-2 price | Free tier | Checked |
|---|---|---|---|---|
| Lambda | Requests | $0.20/M | 1M req/mo always free | 2026-07-24 |
| Lambda | GB-second (x86) | $0.0000166667 | 400k GB-s/mo always free | 2026-07-24 |
| Lambda | GB-second (arm64) | $0.0000133334 | shared | 2026-07-24 |
| API Gateway | HTTP API | $1.00/M (first 300M) | 1M/mo, 12-month accounts only | 2026-07-24 |
| DynamoDB | On-demand write | $0.625/M WRU | none | 2026-07-24 |
| DynamoDB | On-demand read | $0.125/M RRU | none | 2026-07-24 |
| DynamoDB | Storage | $0.25/GB-mo | 25 GB free | 2026-07-24 |
| S3 Standard | Storage first 50 TB | $0.023/GB-mo | none | 2026-07-24 |
| S3 Standard | PUT | $0.005/1k | none | 2026-07-24 |
| S3 Standard | GET | $0.0004/1k | none | 2026-07-24 |
| Athena | Data scanned | $5.00/TB | none | 2026-07-24 |
| Glue Catalog | Objects / requests | $1.00/100k-mo / $1.00/M | 1M objects + 1M req free | 2026-07-24 |
| S3 Tables | Storage | $0.0265/GB-mo (+15% vs Standard) | none | 2026-07-24 |
| S3 Tables | Monitoring | $0.025/1k objects-mo | none | 2026-07-24 |
| S3 Tables | Compaction | $0.002/1k objects + $0.005/GB | none | 2026-07-24 |
| RDS Postgres | db.t4g.micro single-AZ | $0.016/hr = $11.68/mo | 750 h, 12-month accounts only | 2026-07-24 |
| RDS | gp3 storage | $0.115/GB-mo | none | 2026-07-24 |
| RDS Proxy | Per vCPU-hr | $0.015, 2-vCPU minimum = $21.90/mo on t4g | none | 2026-07-24 |
| Aurora DSQL | DPU | $8.00/M | 100k DPU/mo recurring | 2026-07-24 |
| Aurora DSQL | Storage | $0.33/GB-mo | 1 GB-mo recurring | 2026-07-24 |
| CloudFront | DTO US first 10 TB | $0.085/GB | 1 TB + 10M req/mo always free | 2026-07-24 |
| CloudFront | HTTPS requests | $0.0100/10k | included | 2026-07-24 |
| Cognito | Essentials MAU | $0.015 | 10k MAU free | 2026-07-24 |
| SES | Outbound | $0.10/1k | credits only | 2026-07-24 |
| SNS | Publishes | $0.50/M | 1M/mo free | 2026-07-24 |
| End User Messaging | US SMS (10DLC or toll-free) | $0.00774 + $0.00421 carrier = $0.01195/part | none | 2026-07-24 |
| End User Messaging | 10DLC fixed | brand $4.50 + auth $12.50 one-time; campaign $10/mo; number $1/mo; T-Mobile $50 one-time | - | 2026-07-24 |
| End User Messaging | Toll-free number | $2/mo | - | 2026-07-24 |
| EventBridge | Scheduler invocations | $1.00/M | 14M/mo free | 2026-07-24 |
| CloudWatch | Custom metric | $0.30/mo | 10 free | 2026-07-24 |
| CloudWatch | Std / hi-res alarm | $0.10 / $0.30 | 10 alarm-metrics free | 2026-07-24 |
| CloudWatch | Logs ingest / store | $0.50/GB / $0.03/GB-mo | 5 GB free | 2026-07-24 |
| Data transfer | Origin DTO | first 100 GB/mo free account-wide | always free | 2026-07-24 |

Free Tier program note: changed 2025-07-15 (new accounts pick $200-credit
Free plan or Paid plan); always-free allowances persist on both. 12-month
offers not applied in ADR scenarios.

Primary sources: AWS Price List bulk API us-west-2 offer files (AWSLambda,
AmazonApiGateway, AmazonDynamoDB, AmazonS3, AmazonAthena, AWSGlue, AmazonRDS,
AmazonCloudFront, AmazonCognito, AmazonSES, AmazonSNS, AWSEvents,
AmazonCloudWatch, AuroraDSQL) at pricing.us-east-1.amazonaws.com; service
pricing pages: aws.amazon.com/{lambda,api-gateway,dynamodb,s3,athena,glue,
rds/postgresql,rds/proxy,rds/aurora/dsql,cloudfront,cognito,ses,
end-user-messaging,eventbridge,cloudwatch}/pricing; SMS live rate feed
s3.amazonaws.com/aws-messaging-pricing-information/TextMessageOutbound/prices.json;
aws.amazon.com/free. All checked 2026-07-24.
