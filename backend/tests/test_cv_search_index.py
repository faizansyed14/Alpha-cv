"""How text is normalised for search and what counts as a match (the queries themselves are exercised in test_store.py)."""

import pytest

from app.ingestion.search_index import build_search_documents, experience_years, matched_terms, normalize


@pytest.mark.parametrize("typed, expected", [
    ("PYTHON", "python"),
    ("Project-Management", "project management"),
    ("C#", "csharp"),
    ("C++ and C#", "cplusplus and csharp"),
    ("ASP.NET Core", "asp dotnet core"),
    (".NET", "dotnet"),
    ("Node.js", "node js"),
    ("  S/4HANA ", "s 4hana"),
])
def test_typed_text_and_cv_text_normalise_the_same_way(typed, expected):
    assert normalize(typed) == expected


@pytest.mark.parametrize("value, years", [
    (5, 5.0), (3.5, 3.5), ("7", 7.0), ("5+ years", 5.0), ("Not specified", None), (None, None), (True, None), (120, None),
])
def test_experience_is_read_as_a_number(value, years):
    assert experience_years(value) == years


def test_keywords_match_whole_words_and_phrases_only():
    text = normalize("Java developer. Led project management. JavaScript basics.")
    assert matched_terms(text, ["java", "javascript", "project management"]) == ["java", "javascript", "project management"]
    assert matched_terms(normalize("JavaScript and React"), ["java"]) == []
    assert matched_terms(normalize("managed a project as account manager"), ["project management"]) == []


def test_search_documents_cover_the_cv_text_and_the_candidates_facts():
    person = {"full_name": "Aisha Khan", "job_title": "Data Scientist", "keywords": ["TensorFlow"], "skills": ["feature engineering"],
              "certifications": ["AWS Certified Machine Learning"], "location": "Dubai, UAE", "phone": "+971 50 123 4567",
              "nationality": "Indian"}
    docs = build_search_documents(person, "Built ML models")
    for term in ("aisha khan", "data scientist", "tensorflow", "feature engineering", "aws certified machine learning", "built ml models",
                 "971501234567", "dubai uae"):
        assert matched_terms(docs["text"], [term]) == [term]
    assert docs["location"] == "dubai uae" and docs["nationality"] == "indian"


def test_the_literal_text_has_only_what_the_cv_says():
    """Boolean search is decided on the CV's own words: AI-written skills, keywords and certifications are not in it."""
    person = {"full_name": "Sam", "keywords": ["Kubernetes"], "skills": ["Kubernetes operations"], "certifications": ["CKA"]}
    docs = build_search_documents(person, "Worked on Docker")
    assert matched_terms(docs["literal"], ["docker", "sam"]) == ["docker", "sam"]
    assert matched_terms(docs["literal"], ["kubernetes"]) == []
    assert matched_terms(docs["text"], ["kubernetes"]) == ["kubernetes"]
