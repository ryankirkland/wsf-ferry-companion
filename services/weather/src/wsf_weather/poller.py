"""F6 weather poller Lambda: NWS hourly forecasts + AirNow AQI ->
/data/weather.json (ADR-0005 static snapshot).

Runs every 30 minutes. The terminal->gridcell dim is COMMITTED
(gridcells.json, written by tools/weather/resolve-gridcells.py) because
NWS grid assignment is rounding-sensitive; the poller never re-derives
it. 19 distinct grid cells cover 20 terminals; 6 AirNow reporting areas
cover the same 20 (both by measurement, 2026-08-19). Sidney B.C. is
outside both - published as an honest labeled absence, never omitted.

Failure honesty (the WallaWalla lesson): a cell or area that fails after
one retry keeps its LAST PUBLISHED entry - whose as_of stays old, so the
client can label staleness - and the fallback emits a metric + log line.
A fallback indistinguishable from success is the worst bug this pipeline
can have.

`as_of` for forecasts is NWS's updateTime (when forecasters published),
never our fetch time: claiming freshness we merely downloaded would
overstate it.
"""

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path

import boto3
import httpx

from wsf_weather.icons import icon_token
from wsf_weather.metrics import emit

UA = {"User-Agent": "soundferries.com weather poller (contact: via site)"}
NWS_RETRY_WAIT_S = 3
HOURS_PUBLISHED = 156  # NWS's full hourly horizon (~6.5 days)
# Publishing beats completeness: leave this much budget for the S3 put.
PUBLISH_RESERVE_MS = 20_000

_gridcells: dict | None = None
_airnow_key: str | None = None

# Force IPv4: airnowapi.org advertises AAAA records, httpx has no
# happy-eyeballs, and Lambdas have no IPv6 route - the connect hung for
# its full timeout on every call (live, first deploy 2026-08-19) while
# the same code sailed locally. Binding 0.0.0.0 pins every connection
# to IPv4; harmless for NWS, which worked either way.
_client = httpx.Client(
    transport=httpx.HTTPTransport(local_address="0.0.0.0"),
    headers=UA,
    timeout=15,
)


def _cells() -> dict:
    global _gridcells
    if _gridcells is None:
        _gridcells = json.loads((Path(__file__).parent / "gridcells.json").read_text())
    return _gridcells


def _key() -> str:
    global _airnow_key
    if _airnow_key is None:
        _airnow_key = boto3.client("ssm").get_parameter(
            Name=os.environ["AIRNOW_KEY_PARAM"], WithDecryption=True
        )["Parameter"]["Value"]
    return _airnow_key


def _get_json(url: str, params: dict | None = None, retry: bool = True) -> dict | list | None:
    """One retry on 5xx/transport errors (NWS has documented multi-office
    503 stretches); None on any final failure - the caller falls back to
    last-good. The failure REASON is always logged: the first deploy's
    silent Nones cost a diagnosis round-trip."""
    reason = "unknown"
    for attempt in (1, 2):
        try:
            resp = _client.get(url, params=params)
            if resp.status_code >= 500 and retry and attempt == 1:
                time.sleep(NWS_RETRY_WAIT_S)
                continue
            if resp.status_code != 200:
                reason = f"http {resp.status_code}"
                break
            return resp.json()
        except httpx.HTTPError as exc:
            reason = type(exc).__name__
            if retry and attempt == 1:
                time.sleep(NWS_RETRY_WAIT_S)
                continue
            break
        if not retry:
            break
    print(json.dumps({"FetchFailed": {"url": url.split("?")[0], "reason": reason}}))
    return None


def _wind_mph(text: str | None) -> int | None:
    """NWS windSpeed is prose: "8 mph" or "5 to 10 mph" - take the max."""
    if not text:
        return None
    numbers = [int(n) for n in text.replace("mph", "").split() if n.isdigit()]
    return max(numbers) if numbers else None


def _hours_from_forecast(fc: dict) -> tuple[list, str | None]:
    """-> (compact hour rows, updateTime). Row shape (a documented tuple,
    kept lean because 20 terminals x 156 hours ride one JSON file):
    [epoch_ms, temp_f, icon_token, pop_pct, wind_mph, wind_dir, short]."""
    props = fc.get("properties", {})
    rows = []
    for p in props.get("periods", [])[:HOURS_PUBLISHED]:
        ms = int(datetime.fromisoformat(p["startTime"]).timestamp() * 1000)
        pop = (p.get("probabilityOfPrecipitation") or {}).get("value")
        rows.append(
            [
                ms,
                p.get("temperature"),
                icon_token(p.get("icon")),
                pop if pop is not None else 0,
                _wind_mph(p.get("windSpeed")),
                p.get("windDirection") or "",
                p.get("shortForecast") or "",
            ]
        )
    return rows, props.get("updateTime")


def _aqi_for_area(lat: float, lon: float) -> dict | None:
    # No retry: AQI is the garnish, and six areas must never eat the time
    # budget the forecast publish needs.
    rows = _get_json(
        "https://www.airnowapi.org/aq/observation/latLong/current/",
        params={
            "format": "application/json",
            "latitude": lat,
            "longitude": lon,
            "distance": 30,
            "API_KEY": _key(),
        },
        retry=False,
    )
    if not rows or not isinstance(rows, list):
        return None
    # Overall AQI is the worst reporting parameter - the EPA convention.
    worst = max(rows, key=lambda r: r["AQI"])
    return {
        "aqi": worst["AQI"],
        "category": worst["Category"]["Name"],
        "pollutant": worst["ParameterName"],
        "area": worst["ReportingArea"],
        # AirNow reports a local observation hour (its LocalTimeZone is
        # famously always "PST"); published raw for honest client display.
        "observed_date": worst["DateObserved"].strip(),
        "observed_hour": worst["HourObserved"],
    }


def _last_good(s3, bucket: str, key: str) -> dict:
    try:
        return json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    except Exception:
        return {"terminals": {}}


def lambda_handler(event, context):
    dim = _cells()
    bucket = os.environ["DATA_BUCKET"]
    s3 = boto3.client("s3")
    prior = _last_good(s3, bucket, "data/weather.json")
    counts = {"NwsCellErrors": 0, "AirNowAreaErrors": 0, "LastGoodFallbacks": 0}

    # One fetch per DISTINCT grid cell; terminals fan out from it.
    forecasts: dict[tuple, tuple[list, str | None] | None] = {}
    for t in dim["terminals"]:
        if not t["grid"]:
            continue
        cell = (t["grid"]["office"], t["grid"]["x"], t["grid"]["y"])
        if cell in forecasts:
            continue
        fc = _get_json(
            f"https://api.weather.gov/gridpoints/{cell[0]}/{cell[1]},{cell[2]}/forecast/hourly"
        )
        if fc:
            forecasts[cell] = _hours_from_forecast(fc)
        else:
            forecasts[cell] = None
            counts["NwsCellErrors"] += 1
            print(json.dumps({"NwsCellError": {"cell": list(cell)}}))

    # One AirNow observation per reporting area, via its representative
    # terminal's pinned coordinates. The remaining-time guard exists
    # because the first deploy died mid-AirNow at the Lambda ceiling and
    # never reached the publish: forecasts without AQI beat nothing.
    by_id = {t["terminal_id"]: t for t in dim["terminals"]}
    area_aqi: dict[str, dict | None] = {}
    for area, rep_id in dim["airnow_area_representatives"].items():
        remaining = context.get_remaining_time_in_millis() if context else None
        if remaining is not None and remaining < PUBLISH_RESERVE_MS:
            counts["AirNowAreaErrors"] += 1
            print(json.dumps({"AirNowSkipped": {"area": area, "remaining_ms": remaining}}))
            area_aqi[area] = None
            continue
        rep = by_id[rep_id]
        aqi = _aqi_for_area(rep["lat"], rep["lon"])
        if aqi is None:
            counts["AirNowAreaErrors"] += 1
            print(json.dumps({"AirNowAreaError": {"area": area}}))
        area_aqi[area] = aqi

    terminals: dict[str, dict] = {}
    for t in dim["terminals"]:
        tid = str(t["terminal_id"])
        old = prior.get("terminals", {}).get(tid, {})
        if not t["grid"]:
            terminals[tid] = {
                "name": t["name"],
                "unavailable": "Outside US forecast coverage",
            }
            continue

        cell = (t["grid"]["office"], t["grid"]["x"], t["grid"]["y"])
        fresh = forecasts.get(cell)
        if fresh:
            hours, update_time = fresh
            entry = {"name": t["name"], "as_of": update_time, "hours": hours}
        elif old.get("hours"):
            # Last-good, loudly: the old as_of rides along so the client
            # can label the staleness the metric is already counting.
            counts["LastGoodFallbacks"] += 1
            print(json.dumps({"LastGoodFallback": {"terminal": t["name"], "kind": "nws"}}))
            entry = {"name": t["name"], "as_of": old.get("as_of"), "hours": old["hours"]}
        else:
            entry = {"name": t["name"], "unavailable": "Forecast temporarily unavailable"}
            terminals[tid] = entry
            continue

        aqi = area_aqi.get(t["airnow_area"]) if t["airnow_area"] else None
        if aqi is None and old.get("aqi"):
            counts["LastGoodFallbacks"] += 1
            print(json.dumps({"LastGoodFallback": {"terminal": t["name"], "kind": "aqi"}}))
            aqi = old["aqi"]
        entry["aqi"] = aqi
        terminals[tid] = entry

    now = datetime.now(UTC)
    doc = {
        "v": 1,
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "hour_row": ["epoch_ms", "temp_f", "icon", "pop_pct", "wind_mph", "wind_dir", "short"],
        "terminals": terminals,
    }
    body = json.dumps(doc, separators=(",", ":")).encode()
    s3.put_object(
        Bucket=bucket,
        Key="data/weather.json",
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=300, must-revalidate",
    )

    # Raw archive (owner's call, 2026-08-19): every poll banked so weather
    # can one day be JOINED against the on-time record - measured wind/rain
    # vs delay correlations are what could eventually EARN the derived
    # warnings the display-only rule currently forbids. Collectors first:
    # every idle day is history that never exists.
    if raw_bucket := os.environ.get("RAW_BUCKET"):
        import gzip

        s3.put_object(
            Bucket=raw_bucket,
            Key=f"raw/weather/dt={now:%Y-%m-%d}/{now:%H%M}.json.gz",
            Body=gzip.compress(body),
            ContentType="application/json",
            ContentEncoding="gzip",
        )

    emit(WeatherPublished=1, **{k: v for k, v in counts.items() if v > 0})
    return {
        "published": True,
        "covered": sum(1 for t in terminals.values() if "hours" in t),
        **counts,
    }
