"""The Careers page's location filter: only the jobs in Dubai, or only those in Abu Dhabi (the job's own location text)."""
from app.store import get_store


def _post(store, n, place):
    jd = store.save_job_description({"id": f"jd-{n}", "filename": "j.pdf", "raw_text": "Dev", "standardized": {"job_title": f"Job {n}"}})
    pid = store.create_job_posting({"job_description_id": jd, "public_token": f"tok-{n}"})
    store.update_job_posting(pid, {"job_location": place})
    return pid


def test_the_list_and_its_tab_counts_follow_the_location():
    store = get_store()
    dubai = {_post(store, 1, "Dubai, UAE"), _post(store, 2, "DUBAI")}
    abu = {_post(store, 3, "Abu Dhabi, United Arab Emirates")}
    other = {_post(store, 4, "Riyadh"), _post(store, 5, None)}
    store.update_job_posting(next(iter(abu)), {"is_active": False})
    ids = lambda **kw: {j["id"] for j in store.list_job_postings(include_inactive=True, **kw)[0]}
    assert ids(location="Dubai") == dubai
    assert ids(location="Abu Dhabi") == abu                                                    # Abu Dhabi is not "Dubai", and inactive jobs count
    assert ids() == dubai | abu | other
    assert store.list_job_postings(include_inactive=True, location="Dubai")[1] == 2           # the total
    assert store.posting_status_counts(location="Abu Dhabi") == {"all": 1, "active": 0, "inactive": 1}
    assert store.posting_status_counts(location="Dubai") == {"all": 2, "active": 2, "inactive": 0}
