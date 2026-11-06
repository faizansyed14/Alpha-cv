from types import SimpleNamespace

from app.api.routers import cvs


class _Client:
    """A Qdrant stand-in whose count() answers how many applicants of a job score above a value."""

    def __init__(self, scores_by_job):
        self.scores_by_job, self.calls = scores_by_job, 0

    def count(self, collection, count_filter=None, exact=True):
        self.calls += 1
        must = count_filter.must
        job = next(c.match.value for c in must if c.key == "job_id")
        gt = next(c.range.gt for c in must if c.key == "applied_job_match.overall_score")
        return SimpleNamespace(count=sum(1 for s in self.scores_by_job[job] if s > gt))


def test_rank_is_counted_per_applicant_on_the_page_not_by_reading_every_applicant():
    q = SimpleNamespace(client=_Client({"j1": [0.9, 0.8, 0.5, 0.3]}))
    structs = {
        "a": {"is_job_application": True, "job_id": "j1", "applied_job_match": {"overall_score": 0.8}},
        "b": {"is_job_application": True, "job_id": "j1", "applied_job_match": {"overall_score": 0.9}},
        "plain": {"is_job_application": False},                                            # not an applicant
        "unscored": {"is_job_application": True, "job_id": "j1", "applied_job_match": None},
    }
    assert cvs._ranks_for_page(q, structs) == {"a": 2, "b": 1}
    assert q.client.calls == 2                       # one query per scored applicant, nothing else
    assert cvs._ranks_for_page(q, {"x": {"is_job_application": False}}) == {}


def test_the_dropped_whole_database_endpoints_are_gone():
    paths = {r.path for r in cvs.router.routes}
    assert "/cv/notes/all" not in paths and "/cv/keyword-search" not in paths and "/cv/cvs/category/{category}" not in paths
