"""One candidate per person: a newer CV of someone already in the database (same e-mail AND phone) replaces their CV, and the
duplicates made before that rule can be joined (app/services/duplicates.py).

The LLM, the embedding model and the document parser are faked; the database and the vector store are the real test ones. File
storage is a fake that keeps the bytes, so the tests see which file is stored under which candidate after every step."""
import os
import tempfile
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

from app.config.settings import settings
from app.ingestion import pipeline
from app.ingestion.identity import email_key, email_keys, phone_key
from app.ingestion.pipeline import SOURCE_JOB_PAGE, SOURCE_UPLOAD, CVSubmission, DuplicateApplication, IngestError, ingest_cv
from app.services.duplicates import find_groups, merge_group
from app.store import get_store

DIM = settings.EMBEDDING_DIM
PAD = " with many years of experience delivering projects for clients across the region."


def uid(n):
    return f"00000000-0000-0000-0000-{n:012d}"


class FakeStorage:
    """The storage service, keeping each file's bytes under (type, id, extension) as S3 does under its key."""

    def __init__(self):
        self.files = {}
        self.base_dir = tempfile.mkdtemp()
        self.fail_upload = False

    def upload_file(self, local, doc_id, doc_type, ext):
        if self.fail_upload:
            raise OSError("S3 is down")
        with open(local, "rb") as fh:
            self.files[(doc_type, doc_id, ext)] = fh.read()
        return f"s3://bucket/{doc_type}s/{doc_id}{ext}"

    def download_file(self, doc_id, doc_type, ext, dest):
        if (doc_type, doc_id, ext) not in self.files:
            raise FileNotFoundError(f"{doc_type}/{doc_id}{ext}")
        with open(dest, "wb") as fh:
            fh.write(self.files[(doc_type, doc_id, ext)])
        return dest

    def delete_file(self, doc_id, doc_type, ext):
        return self.files.pop((doc_type, doc_id, ext), None) is not None

    def cv(self, cid):
        """{extension: bytes} of the files stored for this candidate id."""
        return {ext: data for (t, i, ext), data in self.files.items() if t == "cv" and i == cid}


def _vectors(seed):
    m = np.random.default_rng(seed).normal(size=(31, DIM)).astype(np.float32)
    m = (m / np.linalg.norm(m, axis=1, keepdims=True)).tolist()
    return {"skill_vectors": m[:20], "responsibility_vectors": m[20:30], "job_title_vector": m[30:]}


def _parse(path, _kind="cv"):
    """A test CV file says who it is: 'email=..', 'phone=..', 'title=..' lines (each optional)."""
    with open(path, encoding="utf-8") as fh:
        lines = dict(line.split("=", 1) for line in fh.read().splitlines() if "=" in line)
    text = f"{lines.get('title', 'Engineer')} {lines.get('extra', '')}{PAD}"
    pii = {"email": [lines["email"]] if lines.get("email") else [], "phone": [lines["phone"]] if lines.get("phone") else []}
    return {"raw_text": text, "clean_text": text, "extracted_pii": pii}


@pytest.fixture
def world(monkeypatch):
    storage = FakeStorage()
    llm = MagicMock()
    llm.standardize_cv.side_effect = lambda text, _name=None: {
        "name": "Jane Smith", "job_title": text.split(" with ")[0].split(" ")[0], "skills": [f"{text.split(' ')[0]} skill"],
        "category": "Software & Application Development", "nationality": None}
    emb = MagicMock()
    counter = {"n": 0}

    def embed(_std):
        counter["n"] += 1
        return _vectors(counter["n"])

    emb.generate_document_embeddings.side_effect = embed
    parsing = MagicMock()
    parsing.process_document.side_effect = _parse
    parsing.remove_pii_data.side_effect = lambda t: (t, {"email": [], "phone": []})
    for name, obj in (("get_llm_service", llm), ("get_embedding_service", emb), ("get_parsing_service", parsing),
                      ("get_storage_service", storage)):
        monkeypatch.setattr(pipeline, name, lambda obj=obj: obj)
    monkeypatch.setattr(settings, "CV_REPLACE_SAME_PERSON", True)
    store = get_store()

    def job(n):
        jd = store.save_job_description({"id": f"jd-{n}", "filename": "j.pdf", "raw_text": "Dev", "standardized": {"job_title": "Dev"}})
        return store.create_job_posting({"job_description_id": jd, "public_token": f"tok-{n}"})

    return SimpleNamespace(store=store, storage=storage, llm=llm, job=job, tmp=tempfile.mkdtemp())


def cv_file(world, name, *, email="jane@x.com", phone="+971 50 123 4567", title="Accountant", extra=""):
    path = os.path.join(world.tmp, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"email={email}\n" if email else "")
        fh.write(f"phone={phone}\n" if phone else "")
        fh.write(f"title={title}\nextra={extra or name}\n")
    return path


def upload(world, name, cv_id, **who):
    return ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename=name, file_path=cv_file(world, name, **who), cv_id=cv_id))


def apply(world, job_id, name, cv_id, form=None, **who):
    """Like the careers page: the file is saved to storage under the application's id first, then queued."""
    path = cv_file(world, name, **who)
    ext = os.path.splitext(name)[1]
    stored = world.storage.upload_file(path, cv_id, "cv", ext)
    return ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename=name, cv_id=cv_id, persisted_path=stored,
                                  candidate=form or {}, job={"job_id": job_id}))


def candidates(world):
    return world.store.list_candidate_ids(0, 1000)


def row(world, cid):
    return world.store.candidate_detail(cid)


def doc(world, cid):
    return world.store.candidate_document(cid)


# --------------------------------------------------------------------------------------------------------------- identity keys
@pytest.mark.parametrize("a,b", [("+971 50 123 4567", "0501234567"), ("00971501234567", "+971-50-123-4567"), ("(050) 123 4567", "971501234567")])
def test_the_same_phone_written_differently_has_the_same_key(a, b):
    assert phone_key(a) == phone_key(b) == "501234567"


def test_keys_refuse_what_cannot_identify_anyone():
    assert phone_key("12345") is None and phone_key(None) is None and phone_key("") is None
    assert email_key("  Jane@X.com ") == "jane@x.com" and email_key("not-an-email") is None and email_key(None) is None
    assert email_keys(["Jane@x.com", "jane@x.com", None, ""]) == ["jane@x.com"]


# --------------------------------------------------------------------------------------------------------------- replacing
def test_a_newer_cv_of_the_same_person_replaces_the_old_one(world):
    first = upload(world, "old.pdf", uid(1), title="Accountant")
    before = row(world, uid(1))
    old_vectors = world.store.retrieve_embeddings(uid(1), "cv")
    time.sleep(0.01)
    second = upload(world, "new.pdf", uid(2), title="Controller", email="JANE@x.com", phone="050 123 4567")
    assert not first.replaced and second.replaced and not second.merged and second.cv_id == uid(1)
    assert candidates(world) == [uid(1)]                                                 # one person, one candidate
    after = row(world, uid(1))
    assert after["job_title"] == "Controller" and after["skills"] == ["Controller skill"]   # the new CV's data ...
    assert doc(world, uid(1))["filename"] == "new.pdf" and "Controller" in doc(world, uid(1))["raw_text"]
    assert world.store.retrieve_embeddings(uid(1), "cv") != old_vectors                  # ... its vectors ...
    assert b"Controller" in world.storage.cv(uid(1))[".pdf"]                             # ... and its file, under the candidate's id
    assert after["upload_date"] > before["upload_date"]                                  # the CV date moves on (lists, freshness, age box)
    assert after["first_added_at"] == before["first_added_at"]                           # the first time we saw the person stays


def test_the_old_file_sent_again_joins_the_candidate_and_never_brings_the_old_cv_back(world):
    upload(world, "old.pdf", uid(1), title="Accountant")
    upload(world, "new.pdf", uid(2), title="Controller")
    calls = world.llm.standardize_cv.call_count
    again = upload(world, "old.pdf", uid(3), title="Accountant")                        # the very same old file
    assert again.merged and again.cv_id == uid(1)
    assert row(world, uid(1))["job_title"] == "Controller"                               # still the newest CV
    assert world.llm.standardize_cv.call_count == calls                                  # and no AI work for a file already seen
    assert candidates(world) == [uid(1)]


@pytest.mark.parametrize("who", [
    {"email": "jane@x.com", "phone": "+971 55 999 8888"},     # same e-mail, another phone: a shared or family address
    {"email": "other@x.com", "phone": "+971 50 123 4567"},    # same phone, another e-mail
    {"email": "jane@x.com", "phone": None},                   # no phone on the new CV
    {"email": None, "phone": "+971 50 123 4567"},             # no e-mail on the new CV
])
def test_without_both_email_and_phone_matching_it_is_a_new_candidate(world, who):
    upload(world, "old.pdf", uid(1), title="Accountant")
    second = upload(world, "other.pdf", uid(2), title="Controller", **who)
    assert not second.replaced and second.cv_id == uid(2)
    assert set(candidates(world)) == {uid(1), uid(2)}
    assert row(world, uid(1))["job_title"] == "Accountant"                               # nobody's CV was touched


def test_switched_off_every_different_file_is_a_new_candidate(world, monkeypatch):
    monkeypatch.setattr(settings, "CV_REPLACE_SAME_PERSON", False)
    upload(world, "old.pdf", uid(1))
    assert not upload(world, "new.pdf", uid(2), title="Controller").replaced
    assert set(candidates(world)) == {uid(1), uid(2)}


def test_job_a_with_the_old_cv_and_job_b_with_the_new_cv_is_one_candidate_on_both_jobs(world):
    job_a, job_b = world.job(1), world.job(2)
    apply(world, job_a, "old.pdf", uid(1), title="Accountant")
    result = apply(world, job_b, "new.pdf", uid(2), title="Controller")
    assert result.replaced and result.cv_id == uid(1)
    assert [a["id"] for a in world.store.applications_for_job(job_a)] == [uid(1)]        # Job A still has the person ...
    assert [a["id"] for a in world.store.applications_for_job(job_b)] == [uid(1)]        # ... and so does Job B
    assert world.store.get_structured_cv(uid(1))["job_title"] == "Controller"            # matching Job A now reads the new CV
    assert world.storage.cv(uid(2)) == {}                                                # the copy saved under the application id is gone
    assert b"Controller" in world.storage.cv(uid(1))[".pdf"]


def test_the_same_job_again_with_a_new_cv_is_still_refused(world):
    job = world.job(1)
    apply(world, job, "old.pdf", uid(1), form={"email": "jane@x.com"})
    with pytest.raises(DuplicateApplication):
        apply(world, job, "new.pdf", uid(2), form={"email": "jane@x.com"}, title="Controller")
    assert row(world, uid(1))["job_title"] == "Accountant"


def test_notes_applications_and_form_details_stay_with_the_person(world):
    job = world.job(1)
    apply(world, job, "old.pdf", uid(1), form={"nationality": "India", "notice_period": "30 days", "expected_salary": 9000})
    world.store.upsert_note(uid(1), "rita", "Strong communicator")
    upload(world, "new.pdf", uid(2), title="Controller")
    r = row(world, uid(1))
    assert [n["note"] for n in r["notes"]] == ["Strong communicator"]
    assert [a["job_id"] for a in r["applications"]] == [job]
    assert (r["nationality"], r["notice_period"], float(r["expected_salary"])) == ("India", "30 days", 9000)


def test_a_new_form_value_wins_over_the_old_one(world):
    apply(world, world.job(1), "old.pdf", uid(1), form={"notice_period": "30 days"})
    apply(world, world.job(2), "new.pdf", uid(2), form={"notice_period": "Immediate"}, title="Controller")
    assert row(world, uid(1))["notice_period"] == "Immediate"


def test_a_new_cv_of_another_file_type_replaces_the_old_file_and_removes_it(world):
    upload(world, "old.pdf", uid(1))
    upload(world, "new.docx", uid(2), title="Controller")
    assert list(world.storage.cv(uid(1))) == [".docx"]                                   # the old .pdf is gone, not left behind
    assert doc(world, uid(1))["filename"] == "new.docx" and doc(world, uid(1))["file_format"] == "docx"


def test_pasted_text_replaces_too_and_is_stored_as_text(world):
    upload(world, "old.pdf", uid(1))
    result = ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="pasted.txt", cv_id=uid(2),
                                    text="Controller with ten years in finance. jane@x.com +971501234567" + PAD,
                                    hints={"email": "jane@x.com", "phone": "+971501234567"}))
    assert result.replaced and list(world.storage.cv(uid(1))) == [".txt"]


def test_with_two_old_duplicates_the_newest_is_replaced_and_the_other_is_left_alone(world, monkeypatch):
    monkeypatch.setattr(settings, "CV_REPLACE_SAME_PERSON", False)                       # two duplicates made before the rule
    upload(world, "a.pdf", uid(1), title="Accountant")
    time.sleep(0.01)
    upload(world, "b.pdf", uid(2), title="Auditor")
    monkeypatch.setattr(settings, "CV_REPLACE_SAME_PERSON", True)
    result = upload(world, "c.pdf", uid(3), title="Controller")
    assert result.cv_id == uid(2)
    assert row(world, uid(2))["job_title"] == "Controller" and row(world, uid(1))["job_title"] == "Accountant"


# --------------------------------------------------------------------------------------------------------------- failures put everything back
def _rounded(vectors):
    """Vectors to 5 decimals: the vector store normalises what it is given, so a vector put back differs in the last float digits only
    (the new CV's vectors are entirely different numbers, so this still tells old from new)."""
    return {k: [[round(x, 5) for x in v] for v in vs] for k, vs in (vectors or {}).items()}


def _snapshot(world, cid):
    return (row(world, cid)["job_title"], doc(world, cid)["filename"], dict(world.storage.cv(cid)),
            _rounded(world.store.retrieve_embeddings(cid, "cv")))


def test_when_the_vectors_cannot_be_saved_the_old_cv_stays_exactly_as_it_was(world, monkeypatch):
    upload(world, "old.pdf", uid(1))
    before = _snapshot(world, uid(1))
    real = world.store.store_embeddings
    calls = {"n": 0}

    def store_embeddings(t, i, e):
        calls["n"] += 1
        return False if calls["n"] == 1 else real(t, i, e)                               # the new CV's vectors fail; putting back works

    monkeypatch.setattr(world.store, "store_embeddings", store_embeddings)
    with pytest.raises(IngestError):
        upload(world, "new.pdf", uid(2), title="Controller")
    assert _snapshot(world, uid(1)) == before and candidates(world) == [uid(1)]


def test_when_the_database_write_fails_the_old_file_and_vectors_are_put_back(world, monkeypatch):
    upload(world, "old.pdf", uid(1))
    before = _snapshot(world, uid(1))

    def broken(*_a, **_k):
        raise RuntimeError("database is down")

    monkeypatch.setattr(world.store, "replace_cv", broken)
    with pytest.raises(IngestError):
        upload(world, "new.pdf", uid(2), title="Controller")
    assert _snapshot(world, uid(1)) == before


def test_when_the_new_file_cannot_be_stored_nothing_changes(world):
    upload(world, "old.pdf", uid(1))
    before = _snapshot(world, uid(1))
    world.storage.fail_upload = True
    with pytest.raises(IngestError):
        upload(world, "new.pdf", uid(2), title="Controller")
    world.storage.fail_upload = False
    assert _snapshot(world, uid(1)) == before


def test_a_failed_replacement_with_another_file_type_leaves_no_new_file(world, monkeypatch):
    upload(world, "old.pdf", uid(1))
    monkeypatch.setattr(world.store, "replace_cv", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("db down")))
    with pytest.raises(IngestError):
        upload(world, "new.docx", uid(2), title="Controller")
    assert list(world.storage.cv(uid(1))) == [".pdf"]


# --------------------------------------------------------------------------------------------------------------- at the same moment
def test_two_new_cvs_of_the_same_person_at_the_same_moment_make_one_candidate(world):
    upload(world, "old.pdf", uid(1))
    slow = world.llm.standardize_cv.side_effect

    def llm(text, name=None):
        time.sleep(0.2)                                                                   # both are being read at the same time
        return slow(text, name)

    world.llm.standardize_cv.side_effect = llm
    results, errors = [], []

    def run(n, title):
        try:
            results.append(upload(world, f"new{n}.pdf", uid(n), title=title))
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(n, t)) for n, t in ((2, "Controller"), (3, "Director"))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors and len(results) == 2 and all(r.replaced for r in results)
    assert candidates(world) == [uid(1)]
    assert row(world, uid(1))["job_title"] in ("Controller", "Director")
    assert len(world.storage.cv(uid(1))) == 1                                              # one file, the one the row describes
    assert row(world, uid(1))["job_title"].encode() in world.storage.cv(uid(1))[".pdf"]


def test_two_first_cvs_of_a_new_person_at_the_same_moment_make_one_candidate(world):
    slow = world.llm.standardize_cv.side_effect

    def llm(text, name=None):
        time.sleep(0.2)
        return slow(text, name)

    world.llm.standardize_cv.side_effect = llm
    threads = [threading.Thread(target=upload, args=(world, f"cv{n}.pdf", uid(n)), kwargs={"title": t}) for n, t in ((1, "Accountant"), (2, "Auditor"))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(candidates(world)) == 1


# --------------------------------------------------------------------------------------------------------------- the lists show both dates
def test_the_list_row_has_the_cv_date_and_the_first_seen_date(world):
    upload(world, "old.pdf", uid(1))
    time.sleep(0.01)
    upload(world, "new.pdf", uid(2), title="Controller")
    item = world.store.candidate_rows([uid(1)])[0]
    assert item["first_added_at"] < item["upload_date"]


# --------------------------------------------------------------------------------------------------------------- the duplicates made before
def _old_duplicates(world, monkeypatch):
    """Three candidates of one person (made before the rule), each with something of its own, plus a different person."""
    monkeypatch.setattr(settings, "CV_REPLACE_SAME_PERSON", False)
    job_a, job_b = world.job(1), world.job(2)
    apply(world, job_a, "a.pdf", uid(1), form={"nationality": "India"}, title="Accountant")
    time.sleep(0.01)
    apply(world, job_b, "b.pdf", uid(2), title="Auditor")
    time.sleep(0.01)
    upload(world, "c.pdf", uid(3), title="Controller", email="JANE@X.COM", phone="0501234567")
    world.store.link_application(job_b, uid(3), {"source": "website"})                 # on Job B too (an old duplicate could be)
    upload(world, "other.pdf", uid(9), email="sam@x.com", phone="+971 55 000 1111")
    world.store.upsert_note(uid(1), "rita", "Met in March")
    world.store.upsert_note(uid(3), "rita", "Called again")
    world.store.upsert_note(uid(2), "omar", "Good fit")
    monkeypatch.setattr(settings, "CV_REPLACE_SAME_PERSON", True)
    return job_a, job_b


def test_the_report_groups_the_same_person_and_keeps_the_newest_cv(world, monkeypatch):
    _old_duplicates(world, monkeypatch)
    groups = find_groups(world.store)
    assert len(groups) == 1
    g = groups[0]
    assert g.keep.id == uid(3) and {m.id for m in g.others} == {uid(1), uid(2)}
    assert len(candidates(world)) == 4                                                    # the report changed nothing


def test_merging_joins_everything_into_the_newest_cv_and_removes_the_rest(world, monkeypatch):
    job_a, job_b = _old_duplicates(world, monkeypatch)
    g = find_groups(world.store)[0]
    result = merge_group(world.store, g.keep.id, [m.id for m in g.others], storage=world.storage)
    assert result["kept"] == uid(3) and set(result["removed"]) == {uid(1), uid(2)}
    assert set(candidates(world)) == {uid(3), uid(9)}
    r = row(world, uid(3))
    assert r["job_title"] == "Controller"                                                # the newest CV
    assert sorted(a["job_id"] for a in r["applications"]) == sorted([job_a, job_b])      # both jobs, Job B once
    notes = {n["hr_user"]: n["note"] for n in r["notes"]}
    assert notes["omar"] == "Good fit" and "Met in March" in notes["rita"] and "Called again" in notes["rita"]
    assert r["nationality"] == "India"                                                   # a detail only the older one had
    assert world.storage.cv(uid(1)) == {} and world.storage.cv(uid(2)) == {}             # their files are gone
    assert world.store.retrieve_embeddings(uid(1), "cv") is None
    assert r["first_added_at"] == row_first_added(world, uid(3)) and find_groups(world.store) == []
    # the older files, sent again, now join the person instead of coming back as candidates
    assert upload(world, "a.pdf", uid(20), title="Accountant").cv_id == uid(3)
    assert set(candidates(world)) == {uid(3), uid(9)}


def row_first_added(world, cid):
    return world.store.candidate_rows([cid])[0]["first_added_at"]


def test_merging_is_all_or_nothing(world, monkeypatch):
    _old_duplicates(world, monkeypatch)
    with pytest.raises(LookupError):
        merge_group(world.store, uid(77), [uid(1), uid(2)], storage=world.storage)       # a kept candidate that does not exist
    assert len(candidates(world)) == 4


def test_people_without_both_an_email_and_a_phone_are_never_grouped(world, monkeypatch):
    monkeypatch.setattr(settings, "CV_REPLACE_SAME_PERSON", False)
    upload(world, "a.pdf", uid(1), phone=None)
    upload(world, "b.pdf", uid(2), phone=None)
    upload(world, "c.pdf", uid(3), email=None)
    upload(world, "d.pdf", uid(4), email=None)
    assert find_groups(world.store) == []
