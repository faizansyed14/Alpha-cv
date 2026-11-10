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


def test_narrowing_never_narrows_negations():
    from app.models.talent import CandidateSearch

    col = CandidateSearch.literal
    assert bq.to_narrowing(bq.parse("NOT a"), col) is None
    assert bq.to_narrowing(bq.parse("a OR NOT b"), col) is None
    assert bq.to_narrowing(bq.parse("a AND NOT b"), col) is not None


def test_the_sql_form_decides_like_the_in_memory_form():
    """to_sql is the same rule as evaluate: checked on a real (SQLite) table against the Python evaluator."""
    from sqlalchemy import create_engine, select
    from sqlmodel import Session, SQLModel

    from app.models.talent import Candidate, CandidateSearch

    texts = ["senior cloud engineer with terraform", "cloud engineer aws only", "azure expert network admin", "java developer",
             "javascript developer", "led project management office", "managed a project", "python intern"]
    queries = ['("Cloud Engineer") AND ("Azure" OR "Terraform")', '"Java"', '"project management"', "python NOT intern", "a OR b AND c",
               "(cloud OR azure) AND NOT terraform", "NOT intern"]
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        for i, t in enumerate(texts):
            s.add(Candidate(id=str(i), content_sha256=str(i), original_filename="f"))
        s.commit()
        for i, t in enumerate(texts):
            s.add(CandidateSearch(candidate_id=str(i), literal=normalize(t), text=normalize(t)))
        s.commit()
        for q in queries:
            node = bq.parse(q)
            in_sql = {int(r) for r in s.execute(select(CandidateSearch.candidate_id).where(bq.to_sql(node, CandidateSearch.literal))).scalars()}
            in_python = {i for i, t in enumerate(texts) if bq.evaluate(node, normalize(t))}
            assert in_sql == in_python, q
