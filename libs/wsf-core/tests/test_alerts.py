from wsf_core.alert_text import alert_details
from wsf_core.alerts import Alert, alert_text_hash, alerts_watermark, body_hash, text_hash


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


def test_body_is_ingested_as_plain_text(alerts_rows):
    alerts = [Alert.model_validate(a) for a in alerts_rows]
    # RouteAlertText repeats the title for most bulletins (6 of 9 once case,
    # punctuation and spacing are folded away); BulletinText never does.
    assert sum(1 for a in alerts if alert_details(a.title, a.text) == []) == 6
    assert all(a.body and a.body != a.text and "<" not in a.body for a in alerts)
    kingston = next(a for a in alerts if a.id == 113728)
    assert kingston.body is not None and len(kingston.body) > 900  # the 5 KB HTML notice, stripped


def test_notification_key_is_pinned_and_ignores_the_body():
    # Golden values computed with the formula the deployed notifier and
    # delivery worker store in BULLETIN#.text_hash / SENT#.last_hash. If
    # this test fails, every live bulletin re-notifies on the next poll.
    cancel = "The 1630 SEA/BBI sailing is cancelled due to crewing."
    labor = "Service during Labor Day weekend"
    assert text_hash("Sea/BI - Service update", cancel) == "c2f3913e86ef0741"
    assert text_hash(labor, labor) == "a280053c682c2666"
    assert text_hash(labor, None) == text_hash(labor, "") == "8f95fb67f5190b7f"

    with_body = Alert.model_validate(
        {
            "BulletinID": 117482,
            "AlertFullTitle": labor,
            "RouteAlertText": labor,
            "BulletinText": "<p>Sailings on Monday follow the Sunday schedule.</p>",
            "PublishDate": "/Date(1788800000000-0700)/",
        }
    )
    without_body = with_body.model_copy(update={"body": None})
    assert alert_text_hash(with_body) == alert_text_hash(without_body) == "a280053c682c2666"


def test_watermark_moves_on_body_only_edits(alerts_rows):
    alerts = [Alert.model_validate(a) for a in alerts_rows]
    w1 = alerts_watermark(alerts)
    edited = [
        a if a.id != 116670 else a.model_copy(update={"body": "Elevator repaired."}) for a in alerts
    ]
    assert alerts_watermark(edited) != w1
    assert body_hash("a  b\n") == body_hash("a b") != body_hash("ab")
    assert body_hash(None) == body_hash("")
