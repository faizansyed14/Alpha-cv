"""CV / job categories: one fixed list, the LLM's answer is mapped onto it, nothing outside it can be created."""

import pytest

from app.ingestion import categories as cat
from app.providers.llm import service as svc


def test_the_nine_it_categories_are_unchanged_so_saved_records_stay_valid():
    assert cat.IT_CATEGORIES == [
        "Cloud & Infrastructure Engineering", "Software & Application Development", "Data & Analytics", "Cybersecurity & Governance",
        "Project & Program Management", "Business Applications & Functional Consulting", "IT Operations & Support",
        "Networking & Systems", "Specialized Technical Roles"]


def test_non_it_is_split_by_function_and_the_old_bucket_is_still_accepted():
    assert "Finance & Accounting" in cat.CATEGORIES and "Human Resources & Administration" in cat.CATEGORIES
    assert "Non IT" not in cat.CATEGORIES                              # no longer offered to the model...
    assert cat.normalize_category("Non IT") == "Non IT"                # ...but records saved with it stay valid
    assert cat.normalize_category("General") == "General"
    assert len(cat.CATEGORIES) == len(set(cat.CATEGORIES))


@pytest.mark.parametrize("raw,expected", [
    ("Finance & Accounting", "Finance & Accounting"), ("finance & accounting", "Finance & Accounting"), ("  Data & Analytics ", "Data & Analytics"),
    ("Accounting", "Finance & Accounting"), ("HR", "Human Resources & Administration"), ("Sales", "Sales & Business Development"),
    ("Finance and Accounting", "Finance & Accounting"), ("Healthcare", "Healthcare & Life Sciences"),
    ("Underwater Basket Weaving", "Other"), ("", "Other"), (None, "Other"), (42, "Other"),
])
def test_whatever_the_model_answers_lands_on_the_list(raw, expected):
    assert cat.normalize_category(raw) == expected


def test_a_category_can_never_be_outside_the_list():
    allowed = set(cat.CATEGORIES) | set(cat.LEGACY_CATEGORIES)
    for raw in ["Finance", "Quantum Plumbing", "IT", "software", "Non-IT", "Data Science & Analytics", "###", "x" * 300]:
        assert cat.normalize_category(raw) in allowed


def test_both_prompts_list_every_category_and_leave_no_placeholder():
    for prompt in (svc.DEFAULT_CV_PROMPT, svc.DEFAULT_JD_PROMPT):
        assert "<<CATEGORIES>>" not in prompt
        for name in cat.CATEGORIES:
            assert name in prompt, name
    assert "accountants, auditors and finance staff" in svc.DEFAULT_CV_PROMPT


def test_strict_schemas_only_allow_listed_categories():
    for schema in (svc.CV_JSON_SCHEMA, svc.JD_JSON_SCHEMA):
        assert schema["schema"]["properties"]["category"]["enum"] == cat.CATEGORIES + [None]


@pytest.fixture
def llm():
    return svc.LLMService.__new__(svc.LLMService)


def test_extraction_results_are_mapped_onto_the_list(llm):
    assert llm._validate_cv_response({"category": "Accounting"}, source_text="")["category"] == "Finance & Accounting"
    assert llm._validate_cv_response({"category": "Quantum Plumbing"}, source_text="")["category"] == "Other"
    assert llm._validate_cv_response({}, source_text="")["category"] == "Other"
    assert llm._validate_jd_response({"category": "Sales"}, source_text="")["category"] == "Sales & Business Development"
    assert llm._validate_jd_response({"category": "Data & Analytics"}, source_text="")["category"] == "Data & Analytics"
