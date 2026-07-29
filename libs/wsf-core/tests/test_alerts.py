from wsf_core.alerts import Alert, alerts_watermark


def test_alerts_parse(alerts_rows):
    alerts = [Alert.model_validate(a) for a in alerts_rows]
    assert len(alerts) == 9
    assert all(a.published.tzinfo is not None for a in alerts)
    assert all("<" not in (a.text or "") for a in alerts)
    # The FVS crew cancellation from the exploration night is in the sample.
    fvs = next(a for a in alerts if "cancel" in (a.text or "").lower())
    assert fvs.route_ids  # route linkage present for banner matching


def test_watermark_moves_on_new_bulletin(alerts_rows):
    alerts = [Alert.model_validate(a) for a in alerts_rows]
    w1 = alerts_watermark(alerts)
    newer = alerts[0].model_copy(update={"id": alerts[0].id + 1000})
    assert alerts_watermark([*alerts, newer]) != w1
    assert alerts_watermark([]) == "0:0"
