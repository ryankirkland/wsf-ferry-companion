import json
from datetime import UTC, datetime
from pathlib import Path

import boto3
import pytest
from wsf_weather import poller
from wsf_weather.icons import icon_token

# Live AirNow responses captured 2026-10-24 (key scrubbed) - the first real
# payloads from the replacement endpoint.
SAMPLES = Path(__file__).resolve().parents[3] / "api-exploration-weather/samples/airnow-2026-10-24"
# The fixtures' observations are 12:00 PDT on 2026-08-19 = 19:00Z; the
# pinned clock sits 30 minutes later, inside the AQI age cap.
NOW = datetime(2026, 8, 19, 19, 30, tzinfo=UTC)

# Two covered terminals sharing conventions with production (Seattle,
# Bainbridge on distinct cells) plus the real coverage gap (Sidney).
DIM = {
    "resolved_at": "2026-08-19",
    "terminals": [
        {
            "terminal_id": 7,
            "name": "Seattle",
            "lat": 47.6025,
            "lon": -122.3387,
            "grid": {"office": "SEW", "x": 124, "y": 68},
            "airnow_area": "Seattle-Bellevue-Kent Valley",
        },
        {
            "terminal_id": 3,
            "name": "Bainbridge Island",
            "lat": 47.6231,
            "lon": -122.5112,
            "grid": {"office": "SEW", "x": 119, "y": 70},
            "airnow_area": "Bremerton-Silverdale-Bainbridge Island",
        },
        {
            "terminal_id": 19,
            "name": "Sidney B.C.",
            "lat": 48.6431,
            "lon": -123.3986,
            "grid": None,
            "airnow_area": None,
        },
    ],
    "airnow_area_representatives": {
        "Seattle-Bellevue-Kent Valley": 7,
        "Bremerton-Silverdale-Bainbridge Island": 3,
    },
}


def forecast(update_time="2026-08-19T20:00:00+00:00", temp=64, short="Rain Showers Likely"):
    return {
        "properties": {
            "updateTime": update_time,
            "periods": [
                {
                    "startTime": "2026-08-19T13:00:00-07:00",
                    "temperature": temp,
                    "probabilityOfPrecipitation": {"value": 40},
                    "windSpeed": "5 to 10 mph",
                    "windDirection": "SW",
                    "shortForecast": short,
                    "icon": "https://api.weather.gov/icons/land/day/rain_showers,40?size=medium",
                },
                {
                    "startTime": "2026-08-19T14:00:00-07:00",
                    "temperature": temp + 1,
                    "probabilityOfPrecipitation": {"value": None},
                    "windSpeed": "8 mph",
                    "windDirection": "W",
                    "shortForecast": "Partly Sunny",
                    "icon": "https://api.weather.gov/icons/land/day/sct?size=medium",
                },
            ],
        }
    }


def airnow(aqi_pm25=54, aqi_o3=26, date="2026-08-19", hour="12:00", tz="PDT"):
    """The /aq/observation/current/ziplatlong/ row shape (live probe 2026-10-24)."""

    def row(param, aqi, category, site):
        return {
            "dateObserved": date,
            "hourObserved": hour,
            "localTimeZone": tz,
            "reportingAreaName": None,  # null for 4 of 6 areas live
            "siteID": "530330080",
            "siteName": site,
            "parameterName": param,
            "nowcastAQI": aqi,
            "aqiCategoryName": category,
            "reportingAgency": "Washington State Dept. of Ecology",
            "lookupBehavior": "Closest Reading By Pollutant",
            "consideredMonitors": "All",
            "lookupBoundary": "50 Miles",
        }

    return [
        row("OZONE", aqi_o3, "Good", "Seattle-Beacon Hill"),
        row("PM2.5", aqi_pm25, "Moderate", "Seattle-10th & Weller"),
    ]


def run(monkeypatch, responses, now=NOW):
    """responses: url-substring -> payload (None = failure after retries)."""
    monkeypatch.setattr(poller, "_gridcells", DIM)
    monkeypatch.setattr(poller, "_now", lambda: now)
    monkeypatch.setattr(poller, "_key", lambda: "test-key")

    def fake_get(url, params=None, retry=True):
        for frag, payload in responses.items():
            if frag in url:
                return payload
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(poller, "_get_json", fake_get)
    return poller.lambda_handler({}, None)


def published():
    body = boto3.client("s3").get_object(Bucket="wsf-test-data", Key="data/weather.json")
    return json.loads(body["Body"].read())


def test_contract_shape_and_honest_absence(aws, monkeypatch):
    result = run(
        monkeypatch,
        {
            "gridpoints/SEW/124,68": forecast(),
            "gridpoints/SEW/119,70": forecast(temp=58, short="Mostly Cloudy"),
            "airnowapi.org": airnow(),
        },
    )
    assert result["published"] and result["covered"] == 2

    doc = published()
    sea = doc["terminals"]["7"]
    assert sea["as_of"] == "2026-08-19T20:00:00+00:00"  # NWS updateTime, not fetch time
    _ms, temp, icon, pop, wind, wind_dir, short = sea["hours"][0]
    assert (temp, icon, pop, wind, wind_dir) == (64, "showers", 40, 10, "SW")
    assert short == "Rain Showers Likely"
    assert sea["hours"][1][3] == 0  # null precipitation -> 0, never None
    assert sea["aqi"]["aqi"] == 54 and sea["aqi"]["pollutant"] == "PM2.5"
    # Area is OUR pinned name (AirNow's came back null); the site is real.
    assert sea["aqi"]["area"] == "Seattle-Bellevue-Kent Valley"
    assert sea["aqi"]["site"] == "Seattle-10th & Weller"
    assert sea["aqi"]["observed_at"] == "2026-08-19T19:00:00Z"
    assert sea["aqi"]["observed_hour"] == 12  # v1 contract stays an int

    # The coverage gap is PUBLISHED as a labeled absence, never omitted.
    sidney = doc["terminals"]["19"]
    assert sidney["unavailable"] == "Outside US forecast coverage"
    assert "hours" not in sidney


def test_aqi_is_the_worst_reporting_parameter(aws, monkeypatch):
    run(
        monkeypatch,
        {
            "gridpoints": forecast(),
            "airnowapi.org": airnow(aqi_pm25=12, aqi_o3=47),
        },
    )
    assert published()["terminals"]["7"]["aqi"]["aqi"] == 47  # O3 wins today


def test_failed_cell_keeps_last_good_and_says_so(aws, monkeypatch):
    run(
        monkeypatch,
        {
            "gridpoints/SEW/124,68": forecast(update_time="2026-08-19T08:00:00+00:00"),
            "gridpoints/SEW/119,70": forecast(),
            "airnowapi.org": airnow(),
        },
    )
    # Second poll: Seattle's cell dies; its entry must survive with the OLD
    # as_of (so the client can label staleness) and the fallback counted -
    # a fallback indistinguishable from success is the WallaWalla bug.
    result = run(
        monkeypatch,
        {
            "gridpoints/SEW/124,68": None,
            "gridpoints/SEW/119,70": forecast(update_time="2026-08-19T21:00:00+00:00"),
            "airnowapi.org": airnow(),
        },
    )
    assert result["NwsCellErrors"] == 1
    assert result["LastGoodFallbacks"] >= 1

    doc = published()
    assert doc["terminals"]["7"]["as_of"] == "2026-08-19T08:00:00+00:00"  # honest age
    assert doc["terminals"]["3"]["as_of"] == "2026-08-19T21:00:00+00:00"  # fresh neighbor


def test_cold_failure_without_history_is_a_labeled_absence(aws, monkeypatch):
    result = run(
        monkeypatch,
        {
            "gridpoints/SEW/124,68": None,
            "gridpoints/SEW/119,70": forecast(),
            "airnowapi.org": airnow(),
        },
    )
    assert result["covered"] == 1
    assert published()["terminals"]["7"]["unavailable"] == "Forecast temporarily unavailable"


def test_wind_prose_parsing():
    assert poller._wind_mph("5 to 10 mph") == 10
    assert poller._wind_mph("8 mph") == 8
    assert poller._wind_mph(None) is None


def test_icon_tokens_cover_the_nws_vocabulary():
    assert icon_token("https://api.weather.gov/icons/land/day/tsra_sct,60") == "tstorm"
    assert icon_token("https://api.weather.gov/icons/land/night/sct") == "partly"
    assert icon_token("https://api.weather.gov/icons/land/day/smoke") == "smoke"
    # A condition NWS invents later degrades to the generic bucket.
    assert icon_token("https://api.weather.gov/icons/land/day/volcanic_ash") == "cloudy"
    assert icon_token(None) == "cloudy"


def test_every_poll_is_banked_to_the_raw_archive(aws, monkeypatch):
    """Owner's call: weather history accrues from day one so wind/rain can
    one day be JOINED against the on-time record - the measurement that
    could earn the derived warnings the display-only rule forbids today."""
    import gzip

    boto3.client("s3").create_bucket(
        Bucket="wsf-test-raw",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    monkeypatch.setenv("RAW_BUCKET", "wsf-test-raw")
    run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": airnow()})

    keys = [o["Key"] for o in boto3.client("s3").list_objects_v2(Bucket="wsf-test-raw")["Contents"]]
    assert len(keys) == 1 and keys[0].startswith("raw/weather/dt=")
    raw = gzip.decompress(
        boto3.client("s3").get_object(Bucket="wsf-test-raw", Key=keys[0])["Body"].read()
    )
    assert json.loads(raw)["terminals"]["7"]["hours"]  # the full published doc


def test_requests_the_replacement_endpoint(monkeypatch):
    """The HTTP layer is stubbed everywhere else, which is why the
    2026-10-01 retirement could never have failed a test. Pin the request."""
    seen = {}

    def fake_get(url, params=None, retry=True):
        seen.update(url=url, params=params, retry=retry)
        return airnow()

    monkeypatch.setattr(poller, "_get_json", fake_get)
    monkeypatch.setattr(poller, "_key", lambda: "test-key")
    poller._aqi_for_area("Seattle-Bellevue-Kent Valley", 47.6025, -122.3387)

    assert seen["url"] == "https://www.airnowapi.org/aq/observation/current/ziplatlong/"
    assert seen["params"]["latitude"] == 47.6025 and seen["params"]["longitude"] == -122.3387
    assert seen["params"]["api_key"] == "test-key"  # apiKey is a 401 (probe)
    assert "distance" not in seen["params"]  # ignored by the new service
    assert seen["retry"] is False


@pytest.mark.parametrize(
    "sample, worst_aqi, pollutant, site",
    [
        ("ziplatlong_seattle.json", 28, "PM2.5", "Seattle-10th & Weller"),
        ("ziplatlong_anacortes_null_area.json", 25, "PM2.5", "Anacortes-202 Ave (SO-AQS)"),
    ],
)
def test_parses_real_payloads(monkeypatch, sample, worst_aqi, pollutant, site):
    body = json.loads((SAMPLES / sample).read_text())
    monkeypatch.setattr(poller, "_get_json", lambda url, params=None, retry=True: body)
    monkeypatch.setattr(poller, "_key", lambda: "test-key")
    aqi = poller._aqi_for_area("Pinned Area", 48.0, -122.0)

    assert aqi is not None
    assert (aqi["aqi"], aqi["pollutant"], aqi["site"]) == (worst_aqi, pollutant, site)
    assert aqi["area"] == "Pinned Area"  # never AirNow's (possibly null) name
    assert aqi["observed_at"] == "2026-10-24T21:00:00Z"  # 14:00 PDT


def test_no_data_error_body_is_an_absence_not_a_crash(monkeypatch, capsys):
    body = {"WebServiceError": [{"Message": "There are no observations available"}]}
    monkeypatch.setattr(poller, "_get_json", lambda url, params=None, retry=True: body)
    monkeypatch.setattr(poller, "_key", lambda: "test-key")

    assert poller._aqi_for_area("Port Townsend", 48.1, -122.8) is None
    assert "AirNowNoData" in capsys.readouterr().out


def test_unexpected_shape_fails_closed(monkeypatch, capsys):
    """The old field names are exactly what a silent parse break looks like."""
    old_shape = [{"AQI": 40, "Category": {"Name": "Good"}, "ParameterName": "PM2.5"}]
    monkeypatch.setattr(poller, "_get_json", lambda url, params=None, retry=True: old_shape)
    monkeypatch.setattr(poller, "_key", lambda: "test-key")

    assert poller._aqi_for_area("Seattle", 47.6, -122.3) is None
    assert "AirNowParseError" in capsys.readouterr().out


@pytest.mark.parametrize(
    "date, hour, tz, expected",
    [
        ("2026-10-24", "14:00", "PDT", "2026-10-24T21:00:00Z"),
        ("2026-01-15", "23:00", "PST", "2026-01-16T07:00:00Z"),  # crosses UTC midnight
        ("2026-08-19 ", 12, "PDT", "2026-08-19T19:00:00Z"),  # legacy int hour, padded date
        ("2026-10-24", "14:00", "XYZ", None),  # unknown zone label
        ("2026-10-24", "25:00", "PDT", None),
        ("not-a-date", "14:00", "PDT", None),
    ],
)
def test_observed_at_converts_airnow_local_time(date, hour, tz, expected):
    assert poller._observed_at(date, hour, tz) == expected


def test_stale_reading_from_airnow_is_not_published(aws, monkeypatch):
    # AirNow answered, but with a reading from 08:00 PDT - 4.5 h before NOW.
    result = run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": airnow(hour="08:00")})

    assert published()["terminals"]["7"]["aqi"] is None
    assert result["AqiUnavailable"] == 2  # both covered terminals


def test_last_good_aqi_survives_only_inside_the_age_cap(aws, monkeypatch):
    run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": airnow()})

    # AirNow dies 30 min later: the 19:00Z reading is still current.
    result = run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": None})
    assert published()["terminals"]["7"]["aqi"]["aqi"] == 54
    assert result["LastGoodFallbacks"] == 2 and result["AqiUnavailable"] == 0

    # Still dead 4 h later: the reading has aged out and is withdrawn.
    later = NOW.replace(hour=23)
    result = run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": None}, now=later)
    assert published()["terminals"]["7"]["aqi"] is None
    assert result["AqiUnavailable"] == 2 and result["LastGoodFallbacks"] == 0

    # And every run after that keeps counting: the published aqi is now
    # null, and the first cut of this cap counted nothing from here on, so
    # a sustained outage summed far below the degraded alarm's threshold.
    from datetime import timedelta

    for step in (1, 2):
        result = run(
            monkeypatch,
            {"gridpoints": forecast(), "airnowapi.org": None},
            now=later + timedelta(minutes=30 * step),
        )
        assert result["AqiUnavailable"] == 2 and result["LastGoodFallbacks"] == 0


def test_a_sustained_blackout_reaches_the_alarm_total(aws, monkeypatch):
    """infra/modules/weather: each covered terminal contributes exactly one
    of LastGoodFallbacks or AqiUnavailable per run, so a 12 h blackout at
    2 runs/h sums to 24 runs x covered terminals - the 480 the threshold
    of 400 is set against (20 terminals in production, 2 here)."""
    from datetime import timedelta

    run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": airnow()})
    total = 0
    for i in range(24):
        now = NOW + timedelta(minutes=30 * (i + 1))
        result = run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": None}, now=now)
        total += result["LastGoodFallbacks"] + result["AqiUnavailable"]
    assert total == 24 * 2


def test_cold_start_without_aqi_counts_as_unavailable(aws, monkeypatch):
    result = run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": None})
    assert published()["terminals"]["7"]["aqi"] is None
    assert result["AqiUnavailable"] == 2 and result["LastGoodFallbacks"] == 0


def test_a_future_stamped_reading_is_not_current(aws, monkeypatch):
    # 23:00 PDT on the 19th is 06:00Z on the 20th - 10.5 h after NOW. A
    # mislabeled zone or bad row, not a forecast.
    result = run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": airnow(hour="23:00")})
    assert published()["terminals"]["7"]["aqi"] is None
    assert result["AqiUnavailable"] == 2


def test_one_null_pollutant_does_not_drop_the_area(monkeypatch):
    body = airnow(aqi_pm25=54, aqi_o3=26)
    body[1]["nowcastAQI"] = None  # PM2.5 missing its number
    monkeypatch.setattr(poller, "_get_json", lambda url, params=None, retry=True: body)
    monkeypatch.setattr(poller, "_key", lambda: "test-key")
    aqi = poller._aqi_for_area("Seattle", 47.6, -122.3)
    assert aqi is not None and (aqi["aqi"], aqi["pollutant"]) == (26, "OZONE")


@pytest.mark.parametrize(
    "body",
    [
        {"WebServiceError": {"Message": "a dict, not a list"}},
        {"WebServiceError": "a bare string"},
        {"WebServiceError": []},
    ],
)
def test_any_error_body_shape_is_an_absence_not_a_crash(monkeypatch, capsys, body):
    monkeypatch.setattr(poller, "_get_json", lambda url, params=None, retry=True: body)
    monkeypatch.setattr(poller, "_key", lambda: "test-key")
    assert poller._aqi_for_area("Port Townsend", 48.1, -122.8) is None
    assert "AirNowNoData" in capsys.readouterr().out


def test_pre_migration_entry_is_withdrawn(aws, monkeypatch):
    """The 2026-10-01 bug: a last-good entry with no observed_at was served
    as current for 23 days. Without a time, it is never current."""
    legacy = {
        "terminals": {
            "7": {
                "name": "Seattle",
                "as_of": "2026-08-19T18:00:00+00:00",
                "hours": [[0, 60, "partly", 0, 5, "N", "x"]],
                "aqi": {
                    "aqi": 35,
                    "category": "Good",
                    "pollutant": "PM2.5",
                    "area": "Seattle-Bellevue-Kent Valley",
                    "observed_date": "2026-10-01",
                    "observed_hour": 3,
                },
            }
        }
    }
    boto3.client("s3").put_object(
        Bucket="wsf-test-data", Key="data/weather.json", Body=json.dumps(legacy)
    )
    result = run(monkeypatch, {"gridpoints": forecast(), "airnowapi.org": None})

    assert published()["terminals"]["7"]["aqi"] is None
    # Seattle's legacy entry and Bainbridge's absent one both count.
    assert result["AqiUnavailable"] == 2
