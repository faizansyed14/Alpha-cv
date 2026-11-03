import pytest

from app.ingestion import boolean_query as bq
from app.ingestion.search_index import normalize


def hit(q, text):
    return bq.evaluate(bq.parse(q), normalize(text))


def test_naukri_style_string():
    q = '("Cloud Engineer") AND ("Azure" OR "Terraform" OR "Kubernetes")'
    assert hit(q, "Senior Cloud Engineer with Terraform and CI/CD")
    assert not hit(q, "Cloud Engineer, AWS only")
    assert not hit(q, "Azure expert, network admin")


def test_whole_words_and_phrases():
    assert hit('"Java"', "Java developer")
    assert not hit('"Java"', "JavaScript developer")
    assert hit('"project management"', "Led project management office")
    assert not hit('"project management"', "managed a project")


def test_not_and_implicit_and():
    assert hit("python django", "python and django dev")
    assert not hit("python django", "python only")
    assert hit("python NOT intern", "senior python dev")
    assert not hit("python NOT intern", "python intern")
    assert hit("a OR b AND c", "a")           # AND binds tighter than OR
    assert not hit("(a OR b) AND c", "a")


def test_case_insensitive_terms_and_curly_quotes():
    assert hit("\u201cSAP FICO\u201d", "sap fico consultant")


@pytest.mark.parametrize("bad", ["", "(a AND b", "a AND", ") a", "AND a", '"" AND a'])
def test_invalid_strings(bad):
    with pytest.raises(bq.BooleanQueryError):
        bq.parse(bad)


def test_positive_terms_skip_negated():
    node = bq.parse("a AND (b OR c) NOT d")
    assert [n.term for n in bq.positive_terms(node)] == ["a", "b", "c"]


def test_filter_never_narrows_negations():
    assert bq.to_filter(bq.parse("NOT a")) is None
    assert bq.to_filter(bq.parse("a OR NOT b")) is None
    assert bq.to_filter(bq.parse("a AND NOT b")) is not None
