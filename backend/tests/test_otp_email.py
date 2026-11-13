"""The sign-in code email: what it shows, and that nothing typed by a person can inject markup into it."""

from app.integrations.email.email_otp_service import otp_email_html


def test_the_email_shows_the_code_the_name_and_the_real_lifetime():
    body = otp_email_html("482915", "sam", minutes=5)
    assert ">482915<" in body and "Hi sam, use this code" in body and "5 minutes" in body
    assert "1 minute<" in otp_email_html("482915", None, minutes=1)            # singular, and no greeting without a name
    assert ">Use this code" in otp_email_html("482915", "  ", minutes=5)


def test_a_name_with_markup_is_shown_as_text():
    body = otp_email_html("482915", '<img src=x onerror=alert(1)>"', minutes=5)
    assert "<img" not in body and "&lt;img src=x onerror=alert(1)&gt;" in body


def test_the_email_needs_nothing_from_the_network():
    body = otp_email_html("482915", "sam")
    assert "<img" not in body and "http" not in body and "<script" not in body and "<link" not in body
    assert "482915" not in body.split("<table", 1)[0]                           # the code is not in the preview line mail programs show
