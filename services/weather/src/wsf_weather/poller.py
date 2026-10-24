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
from datetime import UTC, date, datetime, timedelta, timezone
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

# AirNow retired /aq/observation/latLong/current/ on 2026-10-01 (HTTP 410,
# announced June 2026); this is its named replacement. It ignores
# `distance` (fixed 50-mile lookup) and picks the closest monitor PER
# POLLUTANT, so one answer can mix sites. Probed live 2026-10-24.
AIRNOW_OBSERVATIONS_URL = "https://www.airnowapi.org/aq/observation/current/ziplatlong/"
# An AQI older than this is not "current air quality" and is never
# published, fresh or last-good. NowCast labels the current hour, so a
# healthy reading is under an hour old; 3 h tolerates two missed hours.
# Without a cap, the 2026-10-01 retirement served one 3 a.m. reading as
# current for 23 days.
AQI_MAX_AGE = timedelta(hours=3)
# AirNow's localTimeZone labels (US + the Canadian monitors it now returns).
_TZ_OFFSET_H = {
    "HST": -10,
    "AKST": -9,
    "AKDT": -8,
    "PST": -8,
    "PDT": -7,
    "MST": -7,
    "MDT": -6,
    "CST": -6,
    "CDT": -5,
    "EST": -5,
    "EDT": -4,
    "AST": -4,
    "ADT": -3,
}

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


def _now() -> datetime:
    return datetime.now(UTC)


def _observed_at(date_s: str, hour_s: str | int, tz_label: str) -> str | None:
    """AirNow's local date + hour + zone label -> ISO UTC, or None when any
    part is unreadable (callers fail closed: no time, no AQI)."""
    offset = _TZ_OFFSET_H.get(str(tz_label).strip().upper())
    try:
        d = date.fromisoformat(str(date_s).strip())
        hour = int(str(hour_s).split(":")[0])
    except ValueError:
        return None
    if offset is None or not 0 <= hour <= 23:
        return None
    local = datetime(d.year, d.month, d.day, hour, tzinfo=timezone(timedelta(hours=offset)))
    return local.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _aqi_current(aqi: dict | None, now: datetime) -> bool:
    """True when an AQI entry carries an observation time within the cap.
    Entries from before the 2026-10-24 migration have no observed_at and
    are therefore never current."""
    stamp = (aqi or {}).get("observed_at")
    if not stamp:
        return False
    try:
        observed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    return now - observed <= AQI_MAX_AGE


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


def _aqi_for_area(area: str, lat: float, lon: float) -> dict | None:
    # No retry: AQI is the garnish, and six areas must never eat the time
    # budget the forecast publish needs.
    body = _get_json(
        AIRNOW_OBSERVATIONS_URL,
        params={
            "format": "application/json",
            "latitude": lat,
            "longitude": lon,
            "api_key": _key(),
        },
        retry=False,
    )
    if isinstance(body, dict) and body.get("WebServiceError"):
        # "No data" is a 200 with an error body, not an empty list.
        message = str(body["WebServiceError"][0].get("Message", ""))[:200]
        print(json.dumps({"AirNowNoData": {"area": area, "message": message}}))
        return None
    if not body or not isinstance(body, list):
        return None
    try:
        # Overall AQI is the worst reporting parameter - the EPA convention.
        worst = max(body, key=lambda r: r["nowcastAQI"])
        observed_at = _observed_at(
            worst["dateObserved"], worst["hourObserved"], worst["localTimeZone"]
        )
        entry = {
            "aqi": worst["nowcastAQI"],
            "category": worst["aqiCategoryName"],
            "pollutant": worst["parameterName"],
            # Our pinned area name: AirNow's reportingAreaName came back
            # null for 4 of 6 areas at the 2026-10-24 probe.
            "area": area,
            # The monitor that set the AQI - it can sit up to 50 miles away.
            "site": worst.get("siteName") or None,
            "observed_date": str(worst["dateObserved"]).strip(),
            "observed_hour": int(str(worst["hourObserved"]).split(":")[0]),
            "observed_at": observed_at,
        }
    except (KeyError, TypeError, ValueError) as exc:
        print(json.dumps({"AirNowParseError": {"area": area, "error": repr(exc)[:200]}}))
        return None
    if observed_at is None:
        print(
            json.dumps({"AirNowParseError": {"area": area, "error": "unreadable observation time"}})
        )
        return None
    return entry


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
    now = _now()
    counts = {"NwsCellErrors": 0, "AirNowAreaErrors": 0, "LastGoodFallbacks": 0, "AqiExpired": 0}

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
        aqi = _aqi_for_area(area, rep["lat"], rep["lon"])
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
            aqi = old["aqi"]
            if _aqi_current(aqi, now):
                counts["LastGoodFallbacks"] += 1
                print(json.dumps({"LastGoodFallback": {"terminal": t["name"], "kind": "aqi"}}))
        if aqi is not None and not _aqi_current(aqi, now):
            # Too old to call current - from AirNow or from last-good alike.
            # Counted separately so the degraded alarm still sees a dead
            # integration once the fallback window has run out.
            counts["AqiExpired"] += 1
            print(
                json.dumps(
                    {"AqiExpired": {"terminal": t["name"], "observed_at": aqi.get("observed_at")}}
                )
            )
            aqi = None
        entry["aqi"] = aqi
        terminals[tid] = entry

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
