"""CloudWatch metrics via EMF - one structured log line, zero API calls."""

import json
import time

NAMESPACE = "WSF/Ingest"


def emit(**counts: int) -> None:
    """Print one EMF line carrying the given counters."""
    print(
        json.dumps(
            {
                "_aws": {
                    "Timestamp": int(time.time() * 1000),
                    "CloudWatchMetrics": [
                        {
                            "Namespace": NAMESPACE,
                            "Dimensions": [[]],
                            "Metrics": [{"Name": k, "Unit": "Count"} for k in counts],
                        }
                    ],
                },
                **counts,
            }
        )
    )
