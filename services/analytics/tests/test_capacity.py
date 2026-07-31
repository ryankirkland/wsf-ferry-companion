from wsf_analytics import capacity


class FakeWsf:
    def __init__(self, rows):
        self.rows = rows

    def terminal_sailing_space_raw(self):
        return self.rows


def test_reporting_terminals_archive(aws, monkeypatch):
    monkeypatch.setattr(capacity, "_client", FakeWsf([{"TerminalID": 7}, {"TerminalID": 3}]))
    result = capacity.lambda_handler({}, None)
    assert result["terminals"] == 2
    assert result["key"].startswith("raw/terminalsailingspace/dt=")


def test_overnight_empty_still_archives(aws, monkeypatch):
    monkeypatch.setattr(capacity, "_client", FakeWsf([]))
    result = capacity.lambda_handler({}, None)
    assert result["terminals"] == 0
    assert result["key"] is not None  # the [] itself is evidence
