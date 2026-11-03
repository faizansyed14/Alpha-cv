"""run_match streams any number of CVs in chunks with bounded memory and returns them all, ranked."""

import asyncio

import pytest

from app.config.settings import settings
from app.matching import runner
from app.schemas.matching import AlternativesItem, AssignmentItem, CandidateBreakdown


def _candidate(cv_id: str, score: float) -> CandidateBreakdown:
    item = AssignmentItem(type="skill", jd_index=0, jd_item="Python", cv_index=0, cv_item="Python", score=score)
    return CandidateBreakdown(
        cv_id=cv_id, cv_name=cv_id, overall_score=score, skills_assignments=[item],
        responsibilities_assignments=[item], skills_alternatives=[AlternativesItem(jd_index=0, items=[{"x": 1}])])


class FakeQdrant:
    def __init__(self, n):
        self.ids = [f"cv{i}" for i in range(n)]
        self.batches = []

    def list_all_cvs(self):
        return [{"id": i} for i in self.ids]

    def get_structured_cvs_batch(self, ids):
        self.batches.append(len(ids))
        return [{"id": i, "name": i} for i in ids]

    def retrieve_embeddings_batch(self, ids, doc_type="cv"):
        self.embedding_batches = getattr(self, "embedding_batches", []) + [len(ids)]
        return {i: {"skill_vectors": [[0.0]]} for i in ids}


@pytest.fixture
def harness(monkeypatch):
    def build(n, *, detail_top=100, chunk=50):
        q = FakeQdrant(n)
        monkeypatch.setattr(runner, "get_qdrant_utils", lambda: q)
        monkeypatch.setattr(runner, "get_matching_service", lambda: object())
        monkeypatch.setattr(runner, "_resolve_jd", lambda *_a: {"id": "text_jd", "job_title": "Dev"})
        monkeypatch.setattr(settings, "MATCH_DETAIL_TOP_N", detail_top)
        monkeypatch.setattr(settings, "MATCH_CHUNK_SIZE", chunk)

        async def fake_chunk(candidates, jd, svc, weights, on_done, embeddings=None):
            q.received_embeddings = getattr(q, "received_embeddings", 0) + len(embeddings or {})
            out = []
            for c in candidates:
                n_ = int(c["id"][2:])
                out.append(_candidate(c["id"], round((n_ % 997) / 997, 6)))
                on_done(c["id"], c["id"])
            await asyncio.sleep(0)
            return out

        monkeypatch.setattr(runner, "process_candidates_chunk_parallel", fake_chunk)
        return q

    return build


def test_all_candidates_are_returned_ranked_whatever_the_count(harness):
    q = harness(2300)
    resp = asyncio.run(runner.run_match(jd_text="python developer"))
    scores = [c.overall_score for c in resp.candidates]
    assert len(resp.candidates) == 2300 and scores == sorted(scores, reverse=True)


def test_cvs_are_fetched_in_chunk_sized_batches_not_all_at_once(harness):
    q = harness(1234, chunk=50)
    asyncio.run(runner.run_match(jd_text="python developer"))
    assert max(q.batches) <= 50 and len(q.batches) == 25     # 24 full + 1 remainder, never one giant read


def test_heavy_detail_is_kept_only_for_the_top_n(harness):
    harness(600, detail_top=100)
    resp = asyncio.run(runner.run_match(jd_text="python developer"))
    detailed = [c for c in resp.candidates if c.skills_assignments]
    assert len(detailed) == 100
    assert [c.cv_id for c in resp.candidates[:100]] == [c.cv_id for c in detailed]   # the best ones keep their detail
    assert all(not c.responsibilities_alternatives and not c.skills_alternatives for c in resp.candidates[100:])


def test_progress_counts_every_cv(harness):
    harness(180)
    seen = []
    asyncio.run(runner.run_match(jd_text="python developer", progress_cb=seen.append))
    assert seen[-1]["status"] == "completed" and seen[-1]["processed_candidates"] == 180


def test_no_ceiling_by_default():
    assert settings.MATCH_MAX_CVS == 0


def test_ranked_results_keep_the_best_in_the_detailed_head():
    ranked = runner._RankedResults(keep_detail=3)
    ranked.add([_candidate(f"a{i}", i / 10) for i in range(5)])
    ranked.add([_candidate("b", 0.95), _candidate("c", 0.05)])
    head_ids = {c.cv_id for c in ranked.head}
    assert head_ids == {"b", "a4", "a3"} and len(ranked) == 7


def test_progress_is_one_honest_scale_that_never_goes_backwards(harness):
    harness(400)
    seen = []
    asyncio.run(runner.run_match(jd_text="python developer", progress_cb=seen.append))
    percents = [p["progress_percent"] for p in seen if "progress_percent" in p]
    assert percents == sorted(percents)                       # monotonic
    assert max(p["progress_percent"] for p in seen if p.get("phase") == "scoring") <= 88   # scoring keeps to its share
    assert percents[-2:] == [99, 100]                         # then saving, then done
    assert percents[-1] == 100 and seen[-1]["status"] == "completed"
    scoring = [p for p in seen if p.get("phase") == "scoring" and p.get("processed_candidates")]
    assert scoring[-1]["processed_candidates"] == 400 and scoring[-1]["total_candidates"] == 400


def test_the_percentage_tracks_the_cvs_actually_scored(harness):
    harness(200)
    seen = []
    asyncio.run(runner.run_match(jd_text="python developer", progress_cb=seen.append))
    for p in seen:
        if p.get("phase") == "scoring" and p.get("processed_candidates") is not None and p.get("total_candidates"):
            expected = 2 + 86 * p["processed_candidates"] / p["total_candidates"]
            assert abs(p["progress_percent"] - expected) < 0.2


def test_embeddings_are_read_once_per_chunk_and_handed_to_the_scorer(harness):
    """Embeddings come in a few small batch reads per chunk (and reach the scorer), not one read per CV."""
    q = harness(1234, chunk=50)
    asyncio.run(runner.run_match(jd_text="python developer"))
    assert q.received_embeddings == 1234 and sum(q.embedding_batches) == 1234
    assert max(q.embedding_batches) <= settings.MATCH_EMBEDDINGS_FETCH_BATCH   # small requests: bounded memory
