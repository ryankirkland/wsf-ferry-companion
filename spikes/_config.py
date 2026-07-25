"""Shared config for the Phase C bake-off spikes.

Everything created carries TAGS and the wsf-spike name prefix so 99_teardown.py
can find and destroy it. Hard budget: $5 (pre-approved). Nothing here is
production infrastructure - Terraform starts in M0.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REGION = "us-west-2"
PREFIX = "wsf-spike"
TAGS = [{"Key": "project", "Value": PREFIX}]
TAGS_DICT = {"project": PREFIX}
BUDGET_USD = 5.00

SPIKES_DIR = Path(__file__).resolve().parent
DATA_DIR = SPIKES_DIR / "data"
RESULTS_DIR = SPIKES_DIR / "results"
SPEND_FILE = SPIKES_DIR / ".spend.json"


def session():
    import boto3
    return boto3.session.Session(region_name=REGION)


def account_id(sess) -> str:
    ident = sess.client("sts").get_caller_identity()
    print(f"AWS account: {ident['Account']} ({ident['Arn'].split('/')[-1]}) region: {REGION}")
    return ident["Account"]


def bucket_name(acct: str) -> str:
    return f"{PREFIX}-{acct}-usw2"


def record_spend(item: str, usd: float) -> float:
    """Track estimated spend across spike runs; abort past the budget."""
    spent = {}
    if SPEND_FILE.exists():
        spent = json.loads(SPEND_FILE.read_text())
    spent[item] = round(spent.get(item, 0) + usd, 4)
    total = round(sum(spent.values()), 4)
    SPEND_FILE.write_text(json.dumps(spent, indent=1))
    print(f"  est. spend: +${usd:.4f} ({item}) -> total ${total:.2f} / ${BUDGET_USD:.2f}")
    if total > BUDGET_USD:
        sys.exit(f"BUDGET GUARD: estimated total ${total:.2f} exceeds ${BUDGET_USD:.2f} - stop and review.")
    return total


def save_results(name: str, payload: dict) -> Path:
    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"{name}.json"
    payload["captured_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    out.write_text(json.dumps(payload, indent=1, default=str))
    print(f"  results -> {out}")
    return out


def pctile(values, p):
    xs = sorted(values)
    if not xs:
        return None
    k = min(len(xs) - 1, max(0, round(p / 100 * (len(xs) - 1))))
    return xs[k]
