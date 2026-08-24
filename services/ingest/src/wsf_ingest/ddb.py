"""DynamoDB writes for the vessel poller: its own liveness meta, and
nothing else.

The per-vessel FLEET#/VESSEL# rows were retired on 2026-08-24 (ADR-0005,
amended). They were ~93,000 write units/day maintaining 21 items that no
production code read: the map is served from the S3 snapshot via
CloudFront, alert evaluation reads ALERTS#/PAIR#/USER#, and there is no
server-side trip query at all because the site is a static export. The
raw NDJSON archive - not these rows - is the position history, and it
keeps every field of every poll rather than the latest overwrite.
"""

from datetime import UTC, datetime

META_PK = "META"


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


class PollerState:
    """The poller's own last-attempt record. Read by operators, not by
    the serving path."""

    def __init__(self, table):
        self._table = table

    def write_meta(self, *, polls_ok: int, polls_failed: int, last_error: str | None) -> None:
        now = datetime.now(UTC)
        item = {
            "PK": META_PK,
            "SK": "POLLER#vessellocations",
            "last_attempt_utc": _iso(now),
            "polls_ok": polls_ok,
            "polls_failed": polls_failed,
        }
        if polls_ok:
            item["last_success_utc"] = _iso(now)
        if last_error:
            item["last_error"] = last_error[:1000]
        self._table.put_item(Item=item)
