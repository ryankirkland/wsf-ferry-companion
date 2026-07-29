import json

import pytest
from wsf_core.client import WsfApiError, WsfAuthError, WsfClient


class FakeResponse:
    def __init__(self, status: int, body: object):
        self.status = status
        self.data = body if isinstance(body, bytes) else json.dumps(body).encode()


class FakeHttp:
    def __init__(self, response: FakeResponse):
        self._response = response
        self.requested_urls: list[str] = []

    def request(self, method: str, url: str) -> FakeResponse:
        self.requested_urls.append(url)
        return self._response


def _client(response: FakeResponse) -> tuple[WsfClient, FakeHttp]:
    http = FakeHttp(response)
    return WsfClient("test-code", http=http), http  # type: ignore[arg-type]


def test_auth_signature_is_400_plus_message():
    client, _ = _client(FakeResponse(400, {"Message": "please register"}))
    with pytest.raises(WsfAuthError, match="please register"):
        client.vessel_locations()


def test_400_without_message_is_not_auth():
    client, _ = _client(FakeResponse(400, {"weird": True}))
    with pytest.raises(WsfApiError) as exc_info:
        client.vessel_locations()
    assert not isinstance(exc_info.value, WsfAuthError)


def test_non_200_raises_with_status():
    client, _ = _client(FakeResponse(503, b"unavailable"))
    with pytest.raises(WsfApiError) as exc_info:
        client.vessel_locations()
    assert exc_info.value.status == 503


def test_non_json_200_raises():
    client, _ = _client(FakeResponse(200, b"<html>surprise</html>"))
    with pytest.raises(WsfApiError, match="non-JSON"):
        client.vessel_locations()


def test_happy_path_parses_and_sends_access_code(vessellocations_rows):
    client, http = _client(FakeResponse(200, vessellocations_rows))
    fleet = client.vessel_locations()
    assert len(fleet) == 21
    assert http.requested_urls[0].endswith("?apiaccesscode=test-code")


def test_empty_list_is_returned_not_raised():
    # 200 + [] is a real upstream failure signature, but interpreting it is
    # the caller's job (EmptyFleet metric) - the client stays transport-pure.
    client, _ = _client(FakeResponse(200, []))
    assert client.vessel_locations() == []


def test_cache_flush_date_validates_sub_api():
    client, _ = _client(FakeResponse(200, "/Date(0)/"))
    assert client.cache_flush_date("vessels") == "/Date(0)/"
    with pytest.raises(ValueError):
        client.cache_flush_date("nope")
