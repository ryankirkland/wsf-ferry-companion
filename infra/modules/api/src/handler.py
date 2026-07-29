"""Walking-skeleton hello endpoint. Replaced by the real API in M2."""

import json
import os
from datetime import datetime, timezone


def lambda_handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(
            {
                "service": "wsf",
                "version": "m0",
                "region": os.environ.get("AWS_REGION", "unknown"),
                "time": datetime.now(timezone.utc).isoformat(),
            }
        ),
    }
