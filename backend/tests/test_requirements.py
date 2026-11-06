"""Mandatory languages / certifications: extraction cleaning, symbolic matching, statuses, score adjustment, runner wiring."""

import asyncio
from types import SimpleNamespace

import pytest

from app.config.settings import settings
from app.matching import requirements as rq
from app.matching import runner


# ---- languages ---------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("Arabic", "arabic"), ("Arabic (Native)", "arabic"), ("English - fluent", "english"), ("  ENGLISH ", "english"),
    ("Professional working proficiency in French", "french"), ("العربية", "arabic"), ("Filipino", "tagalog"),
    ("", ""), ("fluent", ""), (None, ""),
])
def test_language_names_are_normalised(raw, expected):
    assert rq.normalize_language(raw) == expected


# ---- certifications ----------------------------------------------------------------------------------------------------

SAME = [("Association of Chartered Certified Accountants", "ACCA"), ("Association of Chartered Certified Accountants (ACCA)", "ACCA qualified, affiliate member"),
        ("Certified Public Accountant", "CPA"), ("Certified Public Accountant (CPA)", "US Certified Public Accountant (CPA)"),
        ("Project Management Professional", "PMP certification"), ("Project Management Professional (PMP)", "PMI Project Management Professional (PMP)"),
        ("Amazon Web Services Certified Developer Associate", "AWS Certified Developer - Associate"),
        ("Amazon Web Services Certified Developer Associate", "AWS Developer Associate certification"),
        ("Certified Information Systems Security Professional", "CISSP"), ("Google Ads Search certification", "Google Ads Search certified"),
        ("Certified Scrum Master", "Scrum Master certification (CSM)"), ("Registered Nurse license", "RN license"),
        ("Chartered Institute of Marketing professional diploma", "CIM Professional Diploma in Marketing")]
DIFFERENT = [("Certified Public Accountant", "Certified Management Accountant"),
             ("Association of Chartered Certified Accountants", "Chartered Institute of Management Accountants"),
             ("Association of Chartered Certified Accountants", "Certified Public Accountant"),
             ("Project Management Professional", "PRINCE2 Practitioner"), ("Project Management Professional", "Certified Scrum Master"),
             ("Amazon Web Services Certified Developer Associate", "Amazon Web Services Certified Solutions Architect Associate"),
             ("Amazon Web Services Certified Developer Associate", "Amazon Web Services Certified Cloud Practitioner"),
             ("Amazon Web Services Certified Developer Associate", "Microsoft Azure Developer Associate"),
             ("Certified Information Systems Security Professional", "Certified Information Systems Auditor"),
             ("Google Ads Search certification", "Google Analytics certification"),
             ("Certified Scrum Master", "Professional Scrum Product Owner"), ("Registered Nurse license", "Basic Life Support certification"),
             ("Certified Public Accountant", "Certified Internal Auditor"), ("Association of Chartered Certified Accountants", "Registered Nurse license")]


@pytest.mark.parametrize("required,listed", SAME)
def test_the_same_certificate_in_other_words_matches(required, listed):
    assert rq.certification_matches(required, listed) and rq.certification_matches(listed, required)


@pytest.mark.parametrize("required,listed", DIFFERENT)
def test_a_different_certificate_never_matches_even_a_near_miss(required, listed):
    assert not rq.certification_matches(required, listed) and not rq.certification_matches(listed, required)


# ---- reading a job's requirements --------------------------------------------------------------------------------------

def test_job_requirements_accept_objects_strings_and_nested_structured_info():
    jd = {"required_languages": [{"name": "Arabic", "mandatory": True}, "English", {"name": "French", "mandatory": False}, {"name": ""}],
          "structured_info": {"required_certifications": [{"name": "ACCA OR CPA", "mandatory": "true"}, {"name": "CMA", "mandatory": "preferred"}]}}
    reqs = rq.jd_requirements(jd)
    assert reqs["languages"] == [{"name": "Arabic", "mandatory": True}, {"name": "English", "mandatory": True}, {"name": "French", "mandatory": False}]
    assert reqs["certifications"] == [{"name": "ACCA OR CPA", "mandatory": True}, {"name": "CMA", "mandatory": False}]
    assert rq.has_requirements(reqs)
    assert not rq.has_requirements(rq.jd_requirements({})) and not rq.has_requirements(rq.jd_requirements(None))


# ---- statuses ----------------------------------------------------------------------------------------------------------

REQS = {"languages": [{"name": "Arabic", "mandatory": True}],
        "certifications": [{"name": "Association of Chartered Certified Accountants (ACCA) OR Certified Public Accountant (CPA)", "mandatory": True}]}


def _status(cv):
    return {r["type"]: r["status"] for r in rq.check_candidate(REQS, cv)}


def test_met_when_the_cv_lists_the_language_or_any_accepted_certificate():
    assert _status({"languages": ["English", "Arabic (Native)"], "certifications": ["CPA"]}) == {"language": "met", "certification": "met"}
    assert _status({"languages": ["arabic"], "certifications": ["ACCA qualified"]}) == {"language": "met", "certification": "met"}


def test_missing_only_when_the_cv_lists_other_items_of_that_kind():
    assert _status({"languages": ["English", "French"], "certifications": ["Certified Management Accountant"]}) == \
        {"language": "missing", "certification": "missing"}


def test_unknown_when_the_cv_lists_nothing_of_that_kind():
    assert _status({"languages": [], "certifications": []}) == {"language": "unknown", "certification": "unknown"}
    assert _status({}) == {"language": "unknown", "certification": "unknown"}
    assert _status({"languages": ["English"], "certifications": None}) == {"language": "missing", "certification": "unknown"}


# ---- score adjustment --------------------------------------------------------------------------------------------------

def _rows(*specs, kind="certification"):
    return [{"type": kind, "name": "x", "mandatory": m, "status": s} for s, m in specs]


def test_unknown_never_changes_the_score():
    assert rq.adjust_score(70.0, _rows(("unknown", True), ("unknown", True))) == 70.0


def test_a_known_missing_mandatory_requirement_multiplies_the_score_down():
    assert rq.adjust_score(80.0, _rows(("missing", True))) == pytest.approx(80.0 * settings.REQUIREMENT_MISSING_FACTOR)
    assert rq.adjust_score(80.0, _rows(("missing", True), ("missing", True))) == pytest.approx(80.0 * settings.REQUIREMENT_MISSING_FACTOR ** 2)


def test_a_met_language_earns_no_bonus_but_a_missing_one_still_costs():
    assert rq.adjust_score(50.0, _rows(("met", True), ("met", True), kind="language")) == 50.0
    assert rq.adjust_score(50.0, _rows(("met", False), kind="language")) == 50.0
    assert rq.adjust_score(80.0, _rows(("missing", True), kind="language")) == pytest.approx(80.0 * settings.REQUIREMENT_MISSING_FACTOR)


def test_a_met_mandatory_certificate_adds_a_capped_bonus():
    assert rq.adjust_score(50.0, _rows(("met", True))) == 50.0 + settings.REQUIREMENT_MET_BONUS
    assert rq.adjust_score(50.0, _rows(("met", True),) * 5) == 50.0 + 2 * settings.REQUIREMENT_MET_BONUS     # capped at two
    assert rq.adjust_score(97.0, _rows(("met", True), ("met", True))) == 100.0                               # never above 100


def test_preferred_requirements_can_only_add_a_little_and_never_cost_points():
    assert rq.adjust_score(60.0, _rows(("missing", False))) == 60.0
    assert rq.adjust_score(60.0, _rows(("met", False))) == 60.0 + settings.REQUIREMENT_PREFERRED_BONUS


def test_switched_off_means_no_change(monkeypatch):
    monkeypatch.setattr(settings, "REQUIREMENTS_MATCHING_ENABLED", False)
    assert rq.adjust_score(80.0, _rows(("missing", True))) == 80.0


def test_the_note_for_the_llm_names_each_requirement_and_its_status():
    note = rq.summary_line([{"type": "language", "name": "Arabic", "mandatory": True, "status": "met"},
                            {"type": "certification", "name": "ACCA", "mandatory": False, "status": "unknown"}])
    assert "Arabic (mandatory language): listed on the CV" in note and "ACCA (preferred certification)" in note and "unknown" in note


# ---- extraction cleaning (no real LLM) ---------------------------------------------------------------------------------

@pytest.fixture
def llm():
    from app.providers.llm.service import LLMService
    return LLMService.__new__(LLMService)


def test_cv_certifications_are_cleaned_and_stored(llm):
    out = llm._validate_cv_response({"certifications": [" Project Management Professional (PMP) ", "project management professional (pmp)", "", 5, "ACCA"]},
                                    source_text="")
    assert out["certifications"] == ["Project Management Professional (PMP)", "ACCA"]
    assert llm._validate_cv_response({}, source_text="")["certifications"] == []
    assert llm._validate_cv_response({"certifications": "PMP, CISSP"}, source_text="")["certifications"] == ["PMP", "CISSP"]


def test_jd_requirements_are_cleaned_and_stored(llm):
    out = llm._validate_jd_response({"required_languages": [{"name": "Arabic ", "mandatory": True}, {"name": "arabic", "mandatory": False}, "English", 7],
                                     "required_certifications": [{"name": "ACCA OR CPA", "mandatory": "false"}, None]}, source_text="")
    assert out["required_languages"] == [{"name": "Arabic", "mandatory": True}, {"name": "English", "mandatory": True}]
    assert out["required_certifications"] == [{"name": "ACCA OR CPA", "mandatory": False}]
    empty = llm._validate_jd_response({}, source_text="")
    assert empty["required_languages"] == [] and empty["required_certifications"] == []


def test_prompts_and_strict_schemas_ask_for_the_new_fields():
    from app.providers import llm as llm_pkg
    svc = llm_pkg.service
    assert "CERTIFICATIONS:" in svc.DEFAULT_CV_PROMPT and '"certifications"' in svc.DEFAULT_CV_PROMPT
    assert "REQUIRED LANGUAGES" in svc.DEFAULT_JD_PROMPT and "REQUIRED CERTIFICATIONS" in svc.DEFAULT_JD_PROMPT
    assert "certifications" in svc.CV_JSON_SCHEMA["schema"]["required"] and "certifications" in svc.CV_JSON_SCHEMA["schema"]["properties"]
    for key in ("required_languages", "required_certifications"):
        assert key in svc.JD_JSON_SCHEMA["schema"]["required"] and key in svc.JD_JSON_SCHEMA["schema"]["properties"]


def test_the_llm_scoring_prompt_carries_the_requirement_note():
    from app.matching.llm_scoring import LLMMatchingService
    svc = LLMMatchingService.__new__(LLMMatchingService)
    with_note = svc._build_bulk_analysis_prompt("a job description " * 10, [
        {"cv_id": "c1", "cv_raw_text": "cv text " * 20, "semantic_score": 50.0, "requirements_note": "Arabic (mandatory language): NOT among the CV's listed ones"}])
    without = svc._build_bulk_analysis_prompt("a job description " * 10, [{"cv_id": "c1", "cv_raw_text": "cv text " * 20, "semantic_score": 50.0}])
    assert "Parsed requirement check" in with_note and "Arabic (mandatory language)" in with_note
    assert "Parsed requirement check" not in without


# ---- runner wiring -----------------------------------------------------------------------------------------------------

def _match_result(overall):
    return SimpleNamespace(match_details={}, skills_score=60.0, responsibilities_score=60.0, title_score=60.0, experience_score=60.0,
                           overall_score=overall)


class _Service:
    def match_structured_data(self, cv, jd, weights):
        return _match_result(70.0)


def _score(jd_reqs, cv):
    jd = {"id": "text_jd", "job_title": "Dev", "years_of_experience": 3, "skills": [], "responsibilities": [], "requirements": jd_reqs}
    return asyncio.run(runner.process_candidates_chunk_parallel([cv], jd, _Service(), {}))[0]


CV = {"id": "c1", "name": "Sam", "job_title": "Accountant", "years_of_experience": 5, "skills_sentences": ["x"], "responsibility_sentences": ["y"]}


def test_runner_penalises_only_a_known_missing_mandatory_requirement():
    reqs = rq.jd_requirements({"required_languages": [{"name": "Arabic", "mandatory": True}]})
    known_missing = _score(reqs, {**CV, "languages": ["English"]})
    unknown = _score(reqs, {**CV, "languages": []})
    met = _score(reqs, {**CV, "languages": ["Arabic"]})
    assert unknown.overall_score == pytest.approx(0.70) and unknown.requirements[0]["status"] == "unknown"
    assert known_missing.overall_score == pytest.approx(0.70 * settings.REQUIREMENT_MISSING_FACTOR)
    assert met.overall_score == pytest.approx(0.70) and met.requirements[0]["status"] == "met"     # a language match earns nothing
    assert known_missing.overall_score < unknown.overall_score == met.overall_score


def test_runner_rewards_a_met_mandatory_certificate():
    reqs = rq.jd_requirements({"required_certifications": [{"name": "Certified Public Accountant (CPA)", "mandatory": True}]})
    met = _score(reqs, {**CV, "certifications": ["CPA"]})
    other = _score(reqs, {**CV, "certifications": ["Certified Management Accountant"]})
    unknown = _score(reqs, {**CV, "certifications": []})
    assert met.overall_score == pytest.approx(0.70 + settings.REQUIREMENT_MET_BONUS / 100)
    assert other.overall_score == pytest.approx(0.70 * settings.REQUIREMENT_MISSING_FACTOR)
    assert unknown.overall_score == pytest.approx(0.70)


def test_runner_leaves_jobs_without_requirements_untouched(monkeypatch):
    assert _score({"languages": [], "certifications": []}, {**CV, "languages": ["English"]}).overall_score == pytest.approx(0.70)
    assert _score({"languages": [], "certifications": []}, CV).requirements == []
    monkeypatch.setattr(settings, "REQUIREMENTS_MATCHING_ENABLED", False)
    reqs = rq.jd_requirements({"required_languages": [{"name": "Arabic", "mandatory": True}]})
    assert _score(reqs, {**CV, "languages": ["English"]}).overall_score == pytest.approx(0.70)
