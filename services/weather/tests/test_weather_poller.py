import json

import boto3
from wsf_weather import poller
from wsf_weather.icons import icon_token

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


def airnow(aqi_pm25=54, aqi_o3=26):
    return [
        {
            "DateObserved": "2026-08-19 ",
            "HourObserved": 12,
            "LocalTimeZone": "PST",
            "ReportingArea": "Seattle-Bellevue-Kent Valley",
            "ParameterName": "O3",
            "AQI": aqi_o3,
            "Category": {"Number": 1, "Name": "Good"},
        },
        {
            "DateObserved": "2026-08-19 ",
            "HourObserved": 12,
            "LocalTimeZone": "PST",
            "ReportingArea": "Seattle-Bellevue-Kent Valley",
            "ParameterName": "PM2.5",
            "AQI": aqi_pm25,
            "Category": {"Number": 2, "Name": "Moderate"},
        },
    ]


def run(monkeypatch, responses):
    """responses: url-substring -> payload (None = failure after retries)."""
    monkeypatch.setattr(poller, "_gridcells", DIM)

    def fake_get(url, params=None):
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
