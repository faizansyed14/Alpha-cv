from app.api.routers import cvs


def test_the_dropped_whole_database_endpoints_are_gone():
    paths = {r.path for r in cvs.router.routes}
    assert "/cv/notes/all" not in paths and "/cv/keyword-search" not in paths and "/cv/cvs/category/{category}" not in paths
