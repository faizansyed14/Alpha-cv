"""multilingual-e5-small settings: task prefix, 384-d vectors, re-tuned cutoffs and weights, and the LLM minimum-score filter."""

import asyncio

import numpy as np
import pytest

from app.config.settings import settings
from app.matching import runner
from app.matching.engine import MatchingService
from app.providers.embeddings import service as emb_mod
from app.providers.embeddings.service import EmbeddingService
from app.schemas.matching import CandidateBreakdown, MatchWeights


class _RecordingModel:
    """Stands in for the model-server client: records the texts it is asked to embed."""

    def __init__(self):
        self.texts = []

    def get_sentence_embedding_dimension(self):
        return settings.EMBEDDING_DIM

    def encode(self, sentences, **_kw):
        single = isinstance(sentences, str)
        batch = [sentences] if single else list(sentences)
        self.texts += batch
        out = np.ones((len(batch), settings.EMBEDDING_DIM), dtype=np.float32)
        return out[0] if single else out


@pytest.fixture
def service(monkeypatch):
    model = _RecordingModel()
    monkeypatch.setattr(emb_mod, "_shared_model", model)
    svc = EmbeddingService()
    svc.redis_cache = None                    # no cache hits between tests
    svc._embedding_cache.clear()
    return svc, model


def test_defaults_are_e5_small():
    fields = type(settings).model_fields          # the code defaults, whatever the environment overrides
    assert fields["EMBEDDING_MODEL_NAME"].default == "intfloat/multilingual-e5-small"
    assert fields["EMBEDDING_DIM"].default == 384
    assert fields["EMBEDDING_TEXT_PREFIX"].default == "query: "


def test_every_text_gets_the_query_prefix_after_truncation(service, monkeypatch):
    svc, model = service
    long_text = "x" * 600
    svc.generate_single_embedding("python  developer")
    svc._encode_batch(["sql", long_text])
    assert model.texts[0] == "query: python developer"
    assert model.texts[1] == "query: sql"
    assert model.texts[2] == "query: " + "x" * 512            # 512 characters of the text, then the prefix is added


def test_prefix_can_be_switched_off_for_a_non_e5_model(service, monkeypatch):
    svc, model = service
    monkeypatch.setattr(settings, "EMBEDDING_TEXT_PREFIX", "")
    svc.generate_single_embedding("kubernetes")
    assert model.texts == ["kubernetes"]


def test_the_cache_key_changes_with_the_prefix(service, monkeypatch):
    svc, _ = service
    with_prefix = svc._cache_key(svc._prepare_text("java"))
    monkeypatch.setattr(settings, "EMBEDDING_TEXT_PREFIX", "")
    assert svc._cache_key(svc._prepare_text("java")) != with_prefix


def test_dimension_and_health(service):
    svc, _ = service
    assert svc.get_embedding_dimension() == settings.EMBEDDING_DIM
    assert svc.health_check()["embedding_dimension"] == settings.EMBEDDING_DIM and svc.health_check()["model_loaded"]


def test_similarity_cutoffs_are_tuned_for_e5(service):
    svc, _ = service
    assert svc.SIMILARITY_THRESHOLDS["skills"] == {"minimum": 0.86, "moderate": 0.88, "good": 0.90, "excellent": 0.92}
    assert svc.SIMILARITY_THRESHOLDS["responsibilities"] == {"minimum": 0.85, "moderate": 0.87, "good": 0.89, "excellent": 0.91}
    assert svc.get_match_quality(0.80, "skills") == "unmatched"      # e5 gives unrelated skill pairs about 0.8
    assert svc.get_match_quality(0.86, "skills") == "minimum"
    assert svc.get_match_quality(0.93, "skills") == "excellent"
    assert svc.get_match_quality(0.85, "responsibilities") == "minimum"


def test_default_weights_are_the_original_50_20_20_10():
    assert MatchingService.SCORING_WEIGHTS == {"job_title": 0.20, "skills": 0.50, "experience": 0.10, "responsibilities": 0.20}
    w = MatchWeights()
    assert (w.skills, w.responsibilities, w.job_title, w.experience) == (50, 20, 20, 10)


# ---- LLM minimum-score filter -------------------------------------------------------------------------------------------

def _candidate(cv_id: str, score: float) -> CandidateBreakdown:
    return CandidateBreakdown(cv_id=cv_id, cv_name=cv_id, overall_score=score)


class _FakeQdrant:
    def __init__(self, scores):
        self.scores = scores

    def list_all_cvs(self):
        return [{"id": i} for i in self.scores]

    def get_structured_cvs_batch(self, ids):
        return [{"id": i, "name": i} for i in ids]

    def retrieve_embeddings_batch(self, ids, doc_type="cv"):
        return {i: {"skill_vectors": [[0.0]]} for i in ids}


@pytest.fixture
def match(monkeypatch):
    """run_match against a JD id with the given semantic scores; returns the CV ids the LLM step was asked about."""

    def build(scores, *, min_score, top_n=50):
        sent = []
        monkeypatch.setattr(runner, "get_qdrant_utils", lambda: _FakeQdrant(scores))
        monkeypatch.setattr(runner, "get_matching_service", lambda: object())
        monkeypatch.setattr(runner, "_resolve_jd", lambda *_a: {"id": "jd1", "job_title": "Dev"})
        monkeypatch.setattr(settings, "LLM_MATCH_MIN_SCORE", min_score)
        monkeypatch.setattr(settings, "LLM_MATCH_TOP_N", top_n)

        async def fake_chunk(candidates, jd, svc, weights, on_done, embeddings=None):
            out = []
            for c in candidates:
                out.append(_candidate(c["id"], scores[c["id"]]))
                on_done(c["id"], c["id"])
            return out

        async def fake_llm(semantic_results, jd_id, on_batch=None, **_kw):
            sent.extend(r["cv_id"] for r in semantic_results)
            return [{"has_llm_analysis": False} for _ in semantic_results]

        monkeypatch.setattr(runner, "process_candidates_chunk_parallel", fake_chunk)
        monkeypatch.setattr(runner, "enhance_with_llm_analysis_batched", fake_llm)
        resp = asyncio.run(runner.run_match(jd_id="jd1"))
        return resp, sent

    return build


def test_only_candidates_at_or_above_the_minimum_score_go_to_the_llm(match):
    scores = {"a": 82.0, "b": 55.0, "c": 30.0, "d": 29.9, "e": 12.0}
    resp, sent = match(scores, min_score=30.0)
    assert sent == ["a", "b", "c"]                                  # best first, the two below 30 are not sent
    assert [c.cv_id for c in resp.candidates] == ["a", "b", "c", "d", "e"]   # everyone is still in the result
    assert {c.cv_id: c.overall_score for c in resp.candidates}["e"] == 12.0  # a skipped candidate keeps its semantic score


def test_the_top_n_cap_still_applies_before_the_minimum_score(match):
    scores = {f"c{i}": 90.0 - i for i in range(10)}
    _, sent = match(scores, min_score=0.0, top_n=4)
    assert sent == ["c0", "c1", "c2", "c3"]


def test_nobody_qualifying_means_no_llm_call(match):
    resp, sent = match({"a": 10.0, "b": 5.0}, min_score=30.0)
    assert sent == [] and len(resp.candidates) == 2
