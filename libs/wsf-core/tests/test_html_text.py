from wsf_core.alerts import Alert
from wsf_core.html_text import html_to_text


def test_paragraphs_survive_as_blank_lines_and_markup_does_not(alerts_rows):
    edm = next(r for r in alerts_rows if r["BulletinID"] == 116721)
    text = html_to_text(edm["BulletinText"])
    assert text is not None
    assert "<" not in text and "&" not in text
    paragraphs = text.split("\n\n")
    assert paragraphs[0] == "The #1 Spokane is running an estimated 25-30 minutes behind schedule."
    assert paragraphs[1] == "The #2 Puyallup is back on schedule."
    # Anchors reduce to their label - upstream markup is never rendered.
    assert "online schedule and" in paragraphs[2]
    assert "href" not in text and "http" not in text


def test_entities_nbsp_and_word_paste_spans_collapse():
    soup = (
        '<p><span data-contrast="none">Plan for&nbsp;extra time.&#8217;</span></p>\r\n'
        "<p></p>\r\n<p>Second&amp;last<br />line</p>"
    )
    assert html_to_text(soup) == "Plan for extra time.\u2019\n\nSecond&last\nline"


def test_escaped_markup_stays_literal_text():
    assert html_to_text("<p>a &lt;b&gt; c</p>") == "a <b> c"


def test_empty_bodies_are_absent_not_blank():
    assert html_to_text(None) is None
    assert html_to_text("") is None
    assert html_to_text("<p></p>\r\n<p> </p>") is None


def test_every_sample_body_is_plain_multi_line_text(alerts_rows):
    for alert in (Alert.model_validate(r) for r in alerts_rows):
        assert alert.body, alert.id
        assert "<" not in alert.body
        assert not alert.body.startswith("\n") and not alert.body.endswith("\n")


def test_script_and_style_content_is_dropped_not_rendered():
    # Review finding, 2026-09-03: their CONTENT is not prose.
    html = (
        "<p>Hi</p><script type='text/javascript'>var x = 1 < 2;</script>"
        "<style>p{color:red}</style><p>Bye</p>"
    )
    assert html_to_text(html) == "Hi\n\nBye"
    assert html_to_text("<STYLE>\n.a{}\n</STYLE >text") == "text"
