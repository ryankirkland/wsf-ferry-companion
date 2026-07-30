from wsf_core.alerts import Alert, alert_text_hash, alerts_watermark


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
    assert alerts_watermark([]) == "d:empty"


def test_watermark_sees_edits_and_withdrawals(alerts_rows):
    # The M2 max-based watermark was blind to both of these.
    alerts = [Alert.model_validate(a) for a in alerts_rows]
    w1 = alerts_watermark(alerts)

    # Edit an OLDER bulletin's text without touching PublishDate.
    oldest = min(alerts, key=lambda a: a.published)
    edited = [
        a if a is not oldest else oldest.model_copy(update={"text": "now cancelled"})
        for a in alerts
    ]
    assert alerts_watermark(edited) != w1

    # Withdraw a non-newest bulletin.
    withdrawn = [a for a in alerts if a is not oldest]
    assert alerts_watermark(withdrawn) != w1

    # Order never matters.
    assert alerts_watermark(list(reversed(alerts))) == w1


def test_text_hash_ignores_whitespace_only_edits(alerts_rows):
    a = Alert.model_validate(alerts_rows[0])
    noisy = a.model_copy(update={"text": "  " + (a.text or "").replace(" ", "   ") + " \n"})
    assert alert_text_hash(noisy) == alert_text_hash(a)
    assert alerts_watermark([noisy]) == alerts_watermark([a])
    changed = a.model_copy(update={"text": (a.text or "") + " updated"})
    assert alert_text_hash(changed) != alert_text_hash(a)
