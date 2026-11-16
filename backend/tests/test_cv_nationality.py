"""The CV extraction reads the candidate's nationality when the CV states it, and never makes one up."""
import pytest

from app.ingestion.pipeline import _candidate_facts
from app.providers.llm import service as svc
from app.providers.llm.service import LLMService


@pytest.fixture
def llm():
    return LLMService.__new__(LLMService)


def test_the_prompt_and_both_schemas_ask_for_it():
    assert "NATIONALITY:" in svc.DEFAULT_CV_PROMPT and '"nationality": string | null' in svc.DEFAULT_CV_PROMPT
    assert "nationality" in svc.CV_JSON_SCHEMA["schema"]["properties"] and "nationality" in svc.CV_JSON_SCHEMA["schema"]["required"]


def test_the_prompt_says_to_use_the_country_name_and_not_to_guess():
    p = svc.DEFAULT_CV_PROMPT
    assert "COUNTRY NAME" in p and '"Indian" → "India"' in p
    assert "Do NOT infer it" in p and "visa" in p.lower() and "return null" in p


@pytest.mark.parametrize("given, expected", [
    ("India", "India"), ("  United   Arab Emirates. ", "United Arab Emirates"), ("Philippines;", "Philippines"),
    (None, None), ("", None), ("null", None), ("N/A", None), ("Not specified", None), ("unknown", None),
    ("-", None), (123, None), (["India"], None), ("12345", None), ("x" * 80, None),
])
def test_the_answer_is_cleaned_and_placeholders_are_dropped(llm, given, expected):
    assert llm._validate_cv_response({"nationality": given}, source_text="")["nationality"] == expected


def test_a_missing_field_is_none(llm):
    assert llm._validate_cv_response({}, source_text="")["nationality"] is None


def test_it_reaches_the_candidate_record_and_a_form_answer_still_wins():
    from app.ingestion.pipeline import CVSubmission
    standardized = {"name": "Priya Sharma", "nationality": "India"}
    sub = CVSubmission(source="upload", filename="a.pdf")
    assert _candidate_facts(sub, standardized, {})["nationality"] == "India"
    sub = CVSubmission(source="careers", filename="a.pdf", candidate={"nationality": "Nepal"})        # what the applicant picked on the form
    assert _candidate_facts(sub, standardized, {})["nationality"] == "Nepal"
    assert "nationality" not in _candidate_facts(CVSubmission(source="upload", filename="a.pdf"), {"name": "A", "nationality": None}, {})
