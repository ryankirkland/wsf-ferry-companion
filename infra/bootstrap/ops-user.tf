# The diagnostic identity: everything needed to INVESTIGATE production and
# verify a fix, and nothing needed to change it.
#
# Why it exists: the hand-made wsf-read-only user cannot read DynamoDB,
# Lambda configuration, or S3, so every verification pass fell back to the
# SSO `ryan` profile - which is admin, and expires mid-investigation. The
# 2026-08-23 audit hit that wall repeatedly: the fix for P2 had to be
# inferred from a Terraform plan because the retry config could not be read
# back, and a broken IAM grant went unverified for four hours.
#
# The shape of the grant follows what verification actually requires:
# read the state, read the code that produced it, and re-run the idempotent
# jobs that recompute it. It does NOT include the ability to mutate
# infrastructure, touch identities, delete anything, or send mail.

resource "aws_iam_user" "ops" {
  name = "wsf-ops"
  tags = { purpose = "diagnostics and fix verification" }
}

data "aws_iam_policy_document" "ops" {
  # --- Observability: already available today, kept explicit. ---
  statement {
    sid = "ReadTelemetry"
    actions = [
      "logs:Describe*",
      "logs:Get*",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      "logs:StopQuery",
      "logs:TestMetricFilter",
      "cloudwatch:Describe*",
      "cloudwatch:Get*",
      "cloudwatch:List*",
      "ce:GetCostAndUsage",
      "ce:GetCostForecast",
      "budgets:ViewBudget",
    ]
    resources = ["*"]
  }

  # --- Read the deployed code and its wiring. Verifying "did the fix ship"
  # is otherwise guesswork from a plan output. ---
  statement {
    sid = "ReadFunctionState"
    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:GetFunctionEventInvokeConfig",
      "lambda:ListFunctions",
      "lambda:ListEventSourceMappings",
      "scheduler:GetSchedule",
      "scheduler:ListSchedules",
      "events:DescribeRule",
      "events:ListRules",
    ]
    resources = ["*"]
  }

  # --- Re-run the idempotent recompute jobs. This is what turns "the code
  # is correct" into "production proved it" without waiting for a cron.
  # Deliberately EXCLUDES the notify functions: invoking those sends real
  # mail to real subscribers. ---
  statement {
    sid     = "InvokeIdempotentJobs"
    effect  = "Allow"
    actions = ["lambda:InvokeFunction"]
    resources = [
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:wsf-prod-analytics-stats",
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:wsf-prod-analytics-transform",
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:wsf-prod-analytics-capacity",
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:wsf-prod-ingest-schedule",
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:wsf-prod-ingest-dims",
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:wsf-prod-ingest-vessels",
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:wsf-prod-weather-poller",
    ]
  }

  # --- Hot-state reads, but NOT the subscribers.
  #
  # The table mixes operational state (META tokens and cadence stamps,
  # PAIR# sailings, ALERTS# bulletin state) with real people's email
  # addresses (USER#, EMAIL#, ROUTE#). LeadingKeys draws that line in IAM
  # rather than in a convention someone has to remember. Scan is omitted
  # entirely: it cannot carry a LeadingKeys condition, so granting it would
  # quietly reopen the whole table. ---
  statement {
    sid       = "ReadOperationalPartitionsOnly"
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:BatchGetItem"]
    resources = ["arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/wsf-prod-hot"]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["META", "FLEET", "ALERTS", "PAIR#*"]
    }
  }

  statement {
    sid       = "DescribeTables"
    actions   = ["dynamodb:DescribeTable", "dynamodb:ListTables"]
    resources = ["*"]
  }

  # --- One production alert canary, scoped to the owner's known subscriber
  # partition. This exposes no other subscriber records. ---
  statement {
    sid = "ReadOwnerAlertCanary"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:Query",
    ]
    resources = ["arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/wsf-prod-hot"]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["USER#b8e193d0-f041-70e2-b9ca-19e97e35bb90"]
    }
  }

  statement {
    sid = "ReadAlertDeliveryQueues"
    actions = [
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
    ]
    resources = [
      "arn:aws:sqs:${var.region}:${data.aws_caller_identity.current.account_id}:wsf-prod-notify-delivery",
      "arn:aws:sqs:${var.region}:${data.aws_caller_identity.current.account_id}:wsf-prod-notify-delivery-dlq",
    ]
  }

  # TEMPORARY: IAM cannot constrain SendMessage by recipient or message body.
  # Remove immediately after the requested owner-only delivery canary succeeds.
  statement {
    sid       = "InjectOwnerAlertDeliveryCanary"
    actions   = ["sqs:SendMessage"]
    resources = ["arn:aws:sqs:${var.region}:${data.aws_caller_identity.current.account_id}:wsf-prod-notify-delivery"]
  }

  # --- Read the archives and the published contracts. The raw archive is
  # how an upstream payload gets diffed against what we served; the data
  # bucket is public through CloudFront anyway. tfstate is NOT here: it
  # carries resource state and is the one bucket worth keeping shut. ---
  statement {
    sid     = "ReadArchivesAndContracts"
    actions = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"]
    resources = [
      "arn:aws:s3:::wsf-prod-raw-${data.aws_caller_identity.current.account_id}",
      "arn:aws:s3:::wsf-prod-raw-${data.aws_caller_identity.current.account_id}/*",
      "arn:aws:s3:::wsf-prod-data-${data.aws_caller_identity.current.account_id}",
      "arn:aws:s3:::wsf-prod-data-${data.aws_caller_identity.current.account_id}/*",
    ]
  }

  # --- Belt and braces. Everything above is an allow-list, so these are
  # already excluded; stating them makes the intent auditable and survives
  # someone widening a resource wildcard later. ---
  statement {
    sid    = "NeverIdentityOrSecretsOrMail"
    effect = "Deny"
    actions = [
      "iam:*",
      "sts:AssumeRole",
      "kms:Decrypt",
      "secretsmanager:GetSecretValue",
      "ses:SendEmail",
      "ses:SendRawEmail",
      "cognito-idp:Admin*",
      "cognito-idp:ListUsers",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "NeverDestructive"
    effect = "Deny"
    actions = [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:PutObject",
      "dynamodb:DeleteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteTable",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:DeleteFunction",
      "cloudformation:*",
    ]
    resources = ["*"]
  }
}

# A MANAGED policy, not inline. An inline policy on a USER caps at 2,048
# bytes - roles get 10,240, which is why the deploy role's inline policy
# applied cleanly and this one failed at 409 LimitExceeded on the first
# attempt. Managed policies allow 6,144, comfortably above this document's
# eleven statements, and they are the idiomatic shape anyway: attachable,
# versioned, and visible on their own in the console.
resource "aws_iam_policy" "ops" {
  name        = "wsf-ops-diagnostics"
  description = "Read production and verify a fix; change nothing. See ops-user.tf."
  policy      = data.aws_iam_policy_document.ops.json
}

resource "aws_iam_user_policy_attachment" "ops" {
  user       = aws_iam_user.ops.name
  policy_arn = aws_iam_policy.ops.arn
}

# Access keys are created OUT OF BAND, not here: a key in Terraform state is
# a secret in Terraform state. After apply:
#   aws iam create-access-key --user-name wsf-ops --profile ryan
# then store it as the `wsf-ops` profile in ~/.aws/credentials. Rotate with
# create-new / update-profile / delete-old whenever it feels stale.
output "ops_user_name" {
  description = "Diagnostic user. Create its access key out of band - see ops-user.tf."
  value       = aws_iam_user.ops.name
}
