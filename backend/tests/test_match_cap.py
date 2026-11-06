from types import SimpleNamespace

from app.api.routers.matching import _match_ceiling_error
from app.config.settings import settings
from app.matching import runner


def test_the_default_maximum_is_ten_thousand():
    assert settings.MATCH_MAX_CVS == 10_000


def test_a_request_above_the_maximum_is_refused_with_a_clear_message():
    assert _match_ceiling_error(10_000) is None
    msg = _match_ceiling_error(10_001)
    assert msg and "10,000" in msg and "10,001" in msg


def test_a_match_that_names_no_cvs_scores_only_the_newest_ten_thousand(monkeypatch):
    asked = {}

    class Q:
        def uploaded_at_ready(self):
            return True

        def list_cv_ids_newest_first(self, offset, limit, category=None):
            asked["limit"] = limit
            return [f"c{i}" for i in range(limit)]

        def list_all_cvs(self):
            raise AssertionError("must not read every CV in the database")

    ids = runner._candidate_ids(Q(), None)
    assert asked["limit"] == 10_000 and len(ids) == 10_000
    # named CVs are de-duplicated and also kept inside the maximum
    named = runner._candidate_ids(Q(), [f"x{i % 12_000}" for i in range(20_000)])
    assert len(named) == 10_000
