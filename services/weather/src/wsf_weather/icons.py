"""NWS icon-URL -> Ferry Sound icon token.

NWS marks its /icons endpoints deprecated, but every forecast period
still carries an icon URL whose PATH SEGMENT names the condition
(".../land/day/rain_showers,40?size=medium" -> "rain_showers"). We parse
that name and map it to our own small token set; the frontend owns the
artwork. An unrecognized name maps to the closest generic bucket rather
than breaking - a new NWS condition must never blank a forecast.
"""

import re

# NWS condition name -> Ferry Sound token. Grouped by target token.
_MAP: dict[str, str] = {
    "skc": "clear",
    "few": "mostly-clear",
    "sct": "partly",
    "bkn": "cloudy",
    "ovc": "cloudy",
    "wind_skc": "wind",
    "wind_few": "wind",
    "wind_sct": "wind",
    "wind_bkn": "wind",
    "wind_ovc": "wind",
    "rain": "rain",
    "rain_showers": "showers",
    "rain_showers_hi": "showers",
    "tsra": "tstorm",
    "tsra_sct": "tstorm",
    "tsra_hi": "tstorm",
    "snow": "snow",
    "rain_snow": "snow",
    "snow_sleet": "snow",
    "rain_sleet": "sleet",
    "sleet": "sleet",
    "fzra": "sleet",
    "rain_fzra": "sleet",
    "snow_fzra": "sleet",
    "fog": "fog",
    "haze": "fog",
    "smoke": "smoke",
    "dust": "smoke",
    "hot": "hot",
    "cold": "cold",
    "blizzard": "snow",
    "tornado": "tstorm",
    "hurricane": "tstorm",
    "tropical_storm": "tstorm",
}

_NAME_RE = re.compile(r"/(?:land|marine)/(?:day|night)/([a-z_]+)")


def icon_token(icon_url: str | None) -> str:
    if not icon_url:
        return "cloudy"
    m = _NAME_RE.search(icon_url)
    if not m:
        return "cloudy"
    return _MAP.get(m.group(1), "cloudy")
