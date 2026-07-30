"""CloudWatch metrics via EMF - one structured log line, zero API calls."""

import json
import time

NAMESPACE = "WSF/Notify"


def _line(metrics: list[dict], values: dict) -> str:
    return json.dumps(
        {
            "_aws": {
                "Timestamp": int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {"Namespace": NAMESPACE, "Dimensions": [[]], "Metrics": metrics}
                ],
            },
            **values,
        }
    )


def emit(**counts: int) -> None:
    if not counts:
        return
    print(_line([{"Name": k, "Unit": "Count"} for k in counts], counts))


def emit_latency(ms: int) -> None:
    """AlertEmailLatency: first-seen-by-our-poller -> SES accept (PRD SLO
    anchor - upstream publish lag is instrumented separately)."""
    print(_line([{"Name": "AlertEmailLatency", "Unit": "Milliseconds"}], {"AlertEmailLatency": ms}))
