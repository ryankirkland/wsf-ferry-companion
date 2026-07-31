"""Raw archive: every poll preserved, batched one gzipped NDJSON per invocation.

Keys partition by FETCH time UTC - never by upstream dates (the server's
"today" lags midnight; verified quirk). Layout is hive-style for future
Athena-over-raw (M4 compaction reads these).
"""

import gzip
import json
from datetime import UTC, datetime


class ArchiveBatch:
    def __init__(self, s3, bucket: str):
        self._s3 = s3
        self._bucket = bucket
        self._lines: list[str] = []

    def add(self, *, fetched_at: datetime, status: int, body: object) -> None:
        self._lines.append(
            json.dumps(
                {
                    "fetched_at": fetched_at.astimezone(UTC).isoformat(),
                    "status": status,
                    "body": body,
                },
                separators=(",", ":"),
            )
        )

    def flush(
        self, dataset: str = "vessellocations", now: datetime | None = None, suffix: str = ""
    ) -> str | None:
        """Write the batch; returns the S3 key, or None when empty.

        `suffix` disambiguates concurrent same-minute writers (the M4
        backfill flushes per vessel-year); keys stay hive-partitioned."""
        if not self._lines:
            return None
        now = (now or datetime.now(UTC)).astimezone(UTC)
        tag = f"-{suffix}" if suffix else ""
        key = f"raw/{dataset}/dt={now:%Y-%m-%d}/{now:%H%M}{tag}.ndjson.gz"
        payload = gzip.compress(("\n".join(self._lines) + "\n").encode())
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=payload,
            ContentType="application/x-ndjson",
            ContentEncoding="gzip",
        )
        self._lines.clear()
        return key


def archive_dim(s3, bucket: str, dataset: str, body: object, cacheflushdate: str) -> str:
    now = datetime.now(UTC)
    key = f"raw/{dataset}/dt={now:%Y-%m-%d}/{now:%H%M%S}.json.gz"
    payload = gzip.compress(
        json.dumps({"cacheflushdate": cacheflushdate, "body": body}, separators=(",", ":")).encode()
    )
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=payload,
        ContentType="application/json",
        ContentEncoding="gzip",
    )
    return key
