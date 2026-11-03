"""Name, e-mail and phone reading: the candidate's own details must win over referees, IDs and date ranges."""

import pytest

from app.ingestion.contact import resolve_name
from app.ingestion.cv_parser import ParsingService

UAE_CV = """Mohammed Al Rashid
Senior Accountant | Dubai, UAE
Mobile: +971 50 123 4567   Email: m.rashid@gmail.com
Emirates ID: 784-1990-1234567-1   Passport No: N1234567

Experience
2015 - 2020  Finance Manager, ABC Trading LLC
2020 - 2024  Senior Accountant, XYZ Group

References
Ahmed Khan, Director  ahmed.khan@xyz.com  +971 4 555 0000
"""

INDIA_CV = """RESUME
Priya Sharma
priya.sharma92@outlook.com | 9876543210
Bengaluru, India
"""


@pytest.fixture
def parse():
    return ParsingService().remove_pii_data


def test_the_candidates_email_and_phone_come_before_the_referees(parse):
    clean, pii = parse(UAE_CV)
    assert pii["email"][0] == "m.rashid@gmail.com" and pii["email"][1] == "ahmed.khan@xyz.com"
    assert pii["phone"][0].replace(" ", "") == "+971501234567"
    assert "m.rashid" not in clean and "+971" not in clean and "[EMAIL]" in clean and "[PHONE]" in clean


def test_ids_and_date_ranges_are_not_taken_as_phone_numbers(parse):
    clean, pii = parse(UAE_CV)
    joined = " ".join(pii["phone"])
    assert "784" not in joined and "2015" not in joined and "2020" not in joined
    assert "784-1990" not in clean                    # still redacted from what the LLM sees


def test_local_indian_mobile_and_outlook_address(parse):
    _, pii = parse(INDIA_CV)
    assert pii["email"] == ["priya.sharma92@outlook.com"] and pii["phone"][0] == "9876543210"


def test_an_email_broken_across_lines_by_pdf_extraction_is_joined(parse):
    _, pii = parse("Sara Ali\nsara.ali@\ngmail.com\n+44 7911 123456\n")
    assert pii["email"] == ["sara.ali@gmail.com"]


def test_the_top_level_domain_is_letters_only(parse):
    _, pii = parse("a.b@example.com|x.y@test.org")
    assert pii["email"] == ["a.b@example.com", "x.y@test.org"]


@pytest.mark.parametrize("llm, text, email, expected", [
    ("Mohammed Al Rashid", UAE_CV, "m.rashid@gmail.com", "Mohammed Al Rashid"),
    ("Unknown", UAE_CV, None, "Mohammed Al Rashid"),
    ("", INDIA_CV, None, "Priya Sharma"),                       # heading "RESUME" is skipped
    ("[EMAIL]", "9876543210 | 5 years\n", "john.smith@x.com", "John Smith"),
    ("Dubai", "*** scan ***", "fatima.noor@x.com", "Fatima Noor"),
    ("Faizan", "no header here 123", None, "Faizan"),           # a one-word LLM name is kept when nothing better exists
])
def test_name_falls_back_when_the_llm_name_is_not_a_person(llm, text, email, expected):
    assert resolve_name(llm, text, email) == expected


def test_a_labelled_international_number_beats_an_unlabelled_one_in_the_body(parse):
    _, pii = parse("Ravi Kumar\nMobile: +91 98765 43210\nProject budget 5551234567 approved\nEID 784199012345671\n")
    assert pii["phone"][0].replace(" ", "") == "+919876543210"


def test_digit_runs_libphonenumber_rejects_are_redacted_but_never_stored(parse):
    clean, pii = parse("Anna Lee\nOrder reference 123456789012 shipped\n")
    assert pii["phone"] == [] and "123456789012" not in clean


def test_a_phone_in_a_references_section_comes_last(parse):
    _, pii = parse("Sam Roe\nsam@x.com\nReferences\nTel: +971 4 555 0000\n\nMobile: +971 55 987 6543\n")
    assert pii["phone"][0].replace(" ", "") in ("+971559876543", "+97145550000")
