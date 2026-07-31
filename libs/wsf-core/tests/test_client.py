import json

import pytest
from wsf_core.client import WsfApiError, WsfAuthError, WsfBadRequestError, WsfClient


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


def test_400_discrimination_auth_vs_bad_request():
    """The two verified 400+Message signatures must classify differently -
    a bad fare pair must never trip the auth canary."""
    auth, _ = _client(FakeResponse(400, {"Message": "please register for an access code"}))
    with pytest.raises(WsfAuthError):
        auth.vessel_locations()

    bad, _ = _client(
        FakeResponse(
            400,
            {"Message": "valid range begins with today's date (7/23/2026) and extends..."},
        )
    )
    with pytest.raises(WsfBadRequestError):
        bad.vessel_locations()


class FlakyHttp:
    """Raises transport errors for the first N requests, then succeeds."""

    def __init__(self, failures: int, response: FakeResponse):
        self._failures = failures
        self._response = response
        self.calls = 0

    def request(self, method: str, url: str) -> FakeResponse:
        self.calls += 1
        if self.calls <= self._failures:
            raise TimeoutError("read timed out")
        return self._response


def test_transport_retry_recovers_from_one_timeout(monkeypatch):
    monkeypatch.setattr("wsf_core.client.time.sleep", lambda s: None)
    http = FlakyHttp(1, FakeResponse(200, [{"ok": True}]))
    client = WsfClient("test-code", transport_retries=1, http=http)  # type: ignore[arg-type]
    assert client.alerts_raw() == [{"ok": True}]
    assert http.calls == 2


def test_transport_retry_exhausted_raises(monkeypatch):
    monkeypatch.setattr("wsf_core.client.time.sleep", lambda s: None)
    http = FlakyHttp(2, FakeResponse(200, []))
    client = WsfClient("test-code", transport_retries=1, http=http)  # type: ignore[arg-type]
    with pytest.raises(WsfApiError, match="transport failure"):
        client.alerts_raw()
    assert http.calls == 2


def test_default_client_never_retries_transport():
    http = FlakyHttp(1, FakeResponse(200, []))
    client = WsfClient("test-code", http=http)  # type: ignore[arg-type]
    with pytest.raises(WsfApiError, match="transport failure"):
        client.alerts_raw()
    assert http.calls == 1


def test_http_errors_never_retry():
    class CountingHttp(FakeHttp):
        pass

    http = CountingHttp(FakeResponse(503, b"unavailable"))
    client = WsfClient("test-code", transport_retries=3, http=http)  # type: ignore[arg-type]
    with pytest.raises(WsfApiError):
        client.vessel_locations()
    assert len(http.requested_urls) == 1


def test_vessel_history_strips_spaces_from_names():
    # Probed live 2026-07-30: "Walla%20Walla" silently returns [] while
    # "WallaWalla" returns the real 8,157 rows for 2015.
    http = FakeHttp(FakeResponse(200, []))
    client = WsfClient("test-code", http=http)  # type: ignore[arg-type]
    client.vessel_history_raw("Walla Walla", "2015-01-01", "2015-12-31")
    assert "/vesselhistory/WallaWalla/2015-01-01/2015-12-31" in http.requested_urls[0]
