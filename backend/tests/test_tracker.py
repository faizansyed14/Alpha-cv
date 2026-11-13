"""The requirements tracker: who can see and change what, location scoping, history, the posted-job link and the Excel export.
Runs on a throwaway SQLite database with a fake JD library; no model, network or real data is involved."""
import io
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel

from app.api.deps import require_core_app
from app.api.routers import tracker as T
from app.api.routers import tracker_closures as TC
from app.api.routers import tracker_selections as TS
from app.db.database import get_session
from app.models.requirement import Requirement, RequirementEvent, RequirementRecruiter
from app.models.selection import Selection, SelectionRecruiter
from app.models.user import User
from app.schemas.auth import UserCreate, UserUpdate
from app.security.auth import hash_password


class FakeStore:
    def __init__(self):
        self.jds = {"jd-1": {"filename": "Network Engineer.pdf"}, "jd-2": {"filename": "Second.docx"}}
        self.jobs = {"job-1": {"posted_by_user": "rita"}, "job-x": {"posted_by_user": "someone_else"}}
        self.deleted_jds, self.deleted_jobs, self.updated_jobs = [], [], []

    def jd_document(self, jid):
        return self.jds.get(jid)

    def get_job_posting_by_id(self, jid):
        return self.jobs.get(jid)

    # nothing may be deleted when a description is replaced or removed: these record a call, so a test can prove there was none
    def delete_job_description(self, jid):
        self.deleted_jds.append(jid)

    def purge_job_posting(self, jid):
        self.deleted_jobs.append(jid)

    def update_job_posting(self, jid, fields):
        self.updated_jobs.append((jid, dict(fields)))
        return True


@pytest.fixture
def world(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__, Requirement.__table__, RequirementEvent.__table__, RequirementRecruiter.__table__,
                                                  Selection.__table__, SelectionRecruiter.__table__])
    session = Session(engine)

    def add(username, role, location=None, active=True):
        user = User(username=username, password_hash=hash_password("pw-" + username), role=role, is_active=active, location=location,
                    email=f"{username}@example.com")
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    w = SimpleNamespace(
        session=session,
        sales=add("sam", "account_manager", "Dubai"), sales_ad=add("sara", "account_manager", "Abu Dhabi"),
        mgr=add("mona", "manager", "Dubai"), mgr_ad=add("max", "manager", "Abu Dhabi"),
        rita=add("rita", "user", "Dubai"), rob=add("rob", "user", "Dubai"), ravi=add("ravi", "user", "Abu Dhabi"),
        gone=add("gone", "user", "Dubai", active=False),
        evp=add("eve", "evp"), admin=add("root", "admin"), nowhere=add("nowhere", "user"),
        store=FakeStore(),
    )
    caller = {"user": w.sales}
    monkeypatch.setattr(T, "get_store", lambda: w.store)
    app = FastAPI()
    app.include_router(T.router)
    app.include_router(TC.router)
    app.include_router(TS.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[require_core_app] = lambda: caller["user"]
    w.client, w.caller = TestClient(app), caller
    w.as_ = lambda user: caller.update(user=user)
    yield w
    session.close()


def body(**kw):
    base = {"requirement_date": "2026-11-02", "position": "Network Engineer", "client": "Acme"}
    base.update(kw)
    return base


def make(w, who=None, **kw):
    """Create a requirement (as the sales manager, or as ``who``) and give the calling person back."""
    before = w.caller["user"]
    if who is not None:
        w.as_(who)
    r = w.client.post("/api/tracker/requirements", json=body(**kw))
    w.as_(before)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------------------------------------------- the login's location

def test_location_is_required_for_recruiters_and_managers_only():
    good = dict(username="newbie", password="Str0ng!Passw0rd#x", email="n@example.com")
    for role in ("user", "manager", "account_manager"):
        with pytest.raises(ValidationError):
            UserCreate(**good, role=role)
        assert UserCreate(**good, role=role, location="Abu Dhabi").location == "Abu Dhabi"
    assert UserCreate(**good, role="evp").location is None
    assert UserCreate(**good, role="evp", location="Dubai").location is None        # the EVP sees every location: nothing is kept
    with pytest.raises(ValidationError):
        UserCreate(**good, role="user", location="Sharjah")
    assert UserUpdate(location="Dubai").location == "Dubai"
    with pytest.raises(ValidationError):
        UserUpdate(location="Atlantis")


# ---------------------------------------------------------------------------------------------------------------- create and scope

def test_sales_manager_creates_in_their_own_location(world):
    r = make(world, jd_id="jd-1", recruiter_id=world.rita.id, sales_comments="urgent", cv_submission_date="2026-11-09")
    assert r["sales_comments"] == "urgent"
    assert r["location"] == "Dubai" and r["status"] == "open" and r["created_by"] == "sam"
    assert r["jd_filename"] == "Network Engineer.pdf" and r["recruiter"]["username"] == "rita"
    # nobody types the location: one sent anyway is ignored, it is always the person's own
    assert make(world, location="Abu Dhabi")["location"] == "Dubai"


def test_the_location_of_what_evp_and_admin_add_follows_the_recruiter(world):
    """They have no location of their own, and the form has no location field: it is the assigned recruiter's, empty until there is one."""
    world.as_(world.evp)
    bare = make(world)
    assert bare["location"] is None and world.client.get("/api/tracker/requirements").json()["total"] == 1     # they see it ...
    world.as_(world.sales)
    assert world.client.get("/api/tracker/requirements").json()["total"] == 0                                   # ... a Dubai person does not
    assert world.client.get(f"/api/tracker/requirements/{bare['id']}").status_code == 404

    world.as_(world.evp)
    assert make(world, recruiter_id=world.ravi.id, status="hold", rm_comments="x")["location"] == "Abu Dhabi"
    world.as_(world.admin)
    assert make(world, recruiter_id=world.rita.id)["location"] == "Dubai"
    assert world.client.get("/api/tracker/requirements").json()["total"] == 3                                   # the admin sees every location

    # assigning the first recruiter puts the requirement in that recruiter's location, and its people then see it
    assert world.client.patch(f"/api/tracker/requirements/{bare['id']}", json={"recruiter_id": world.rob.id}).json()["location"] == "Dubai"
    world.as_(world.sales)
    assert world.client.get(f"/api/tracker/requirements/{bare['id']}").status_code == 200


def test_a_recruiter_cannot_create_or_delete(world):
    r = make(world, recruiter_id=world.rita.id)
    world.as_(world.rita)
    assert world.client.post("/api/tracker/requirements", json=body()).status_code == 403
    assert world.client.delete(f"/api/tracker/requirements/{r['id']}").status_code == 403


def test_only_an_active_recruiter_of_the_same_location_can_be_assigned(world):
    for who in (world.ravi, world.gone, world.mgr):
        assert world.client.post("/api/tracker/requirements", json=body(recruiter_id=who.id)).status_code == 422
    assert world.client.post("/api/tracker/requirements", json=body(recruiter_id="no-such-id")).status_code == 422


def test_optional_fields_and_validation(world):
    assert world.client.post("/api/tracker/requirements", json={"requirement_date": "2026-11-02"}).status_code == 422
    assert world.client.post("/api/tracker/requirements", json=body(position="   ")).status_code == 422
    assert world.client.post("/api/tracker/requirements", json=body(cv_submission_date="2026-10-01")).status_code == 422
    assert world.client.post("/api/tracker/requirements", json=body(jd_id="missing")).status_code == 422
    assert world.client.post("/api/tracker/requirements", json=body(sales_comments="x" * 4001)).status_code == 422
    ok = make(world, position="Dev\u0000Ops", rm_comments="  ")
    assert ok["position"] == "DevOps" and ok["rm_comments"] is None and ok["jd_id"] is None


def test_a_person_sees_only_their_location(world):
    mine = make(world)
    world.as_(world.sales_ad)
    theirs = make(world)
    assert theirs["location"] == "Abu Dhabi"
    listing = world.client.get("/api/tracker/requirements").json()
    assert [i["id"] for i in listing["items"]] == [theirs["id"]]
    assert world.client.get(f"/api/tracker/requirements/{mine['id']}").status_code == 404
    assert world.client.patch(f"/api/tracker/requirements/{mine['id']}", json={"status": "closed"}).status_code == 404
    assert world.client.delete(f"/api/tracker/requirements/{mine['id']}").status_code == 404
    # asking for the other location in the address does not widen it
    assert world.client.get("/api/tracker/requirements", params={"location": "Dubai"}).json()["total"] == 1


def test_evp_sees_both_locations(world):
    make(world)
    world.as_(world.sales_ad)
    make(world)
    world.as_(world.evp)
    assert world.client.get("/api/tracker/requirements").json()["total"] == 2
    options = world.client.get("/api/tracker/options").json()
    assert options["all_locations"] is True and options["locations"] == ["Dubai", "Abu Dhabi"] and "my_location" not in options   # they get a Location dropdown
    assert {r["username"] for r in options["recruiters"]} == {"rita", "rob", "ravi"}                            # every recruiter can be assigned


def test_an_account_with_no_location_sees_nothing(world):
    world.as_(world.nowhere)
    assert world.client.get("/api/tracker/requirements").status_code == 403


def test_options_list_the_recruiters_of_the_location(world):
    names = [r["username"] for r in world.client.get("/api/tracker/options").json()["recruiters"]]
    assert names == ["rita", "rob"]                      # not ravi (Abu Dhabi), not the deactivated one
    world.as_(world.rita)
    assert world.client.get("/api/tracker/options").json()["recruiters"] == []


# ---------------------------------------------------------------------------------------------------------------- the recruiter

def test_a_recruiter_sees_only_their_requirements_without_the_sales_comments(world):
    a = make(world, who=world.admin, recruiter_id=world.rita.id, sales_comments="margin is tight", rm_comments="prioritise")
    make(world, recruiter_id=world.rob.id)
    make(world)
    world.as_(world.rita)
    listing = world.client.get("/api/tracker/requirements").json()
    assert [i["id"] for i in listing["items"]] == [a["id"]] and listing["stats"]["total"] == 1
    item = listing["items"][0]
    assert item["sales_comments"] is None and item["rm_comments"] == "prioritise"
    assert world.client.get("/api/tracker/requirements", params={"q": "margin"}).json()["total"] == 0     # not searchable either
    other = world.session.query(Requirement).filter(Requirement.recruiter_id == world.rob.id).one()
    assert world.client.get(f"/api/tracker/requirements/{other.id}").status_code == 404
    assert world.client.patch(f"/api/tracker/requirements/{other.id}", json={"status": "closed"}).status_code == 404


def test_a_recruiter_changes_only_the_status_and_their_own_comments(world):
    r = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
    world.as_(world.rita)
    url = f"/api/tracker/requirements/{r['id']}"
    ok = world.client.patch(url, json={"status": "submitted", "recruiter_comments": "3 CVs sent"})
    assert ok.status_code == 200 and ok.json()["status"] == "submitted" and ok.json()["recruiter_comments"] == "3 CVs sent"
    for forbidden in ({"position": "Other"}, {"client": "Other"}, {"rm_comments": "x"}, {"sales_comments": "x"},
                      {"recruiter_id": world.rob.id}, {"cv_submission_date": "2026-12-01"}, {"job_location": "Sharjah"}, {"salary": "1"},
                      {"jd_id": "jd-2"}, {"jd_id": None}):                  # a recruiter cannot upload, replace or remove the job description
        assert world.client.patch(url, json=forbidden).status_code == 403, forbidden
    assert world.client.patch(url, json={"status": "finished"}).status_code == 422
    assert world.client.patch(url, json={"status": None}).status_code == 422
    assert world.client.patch(url, json={"status": "submitted", "recruiter_comments": "again"}).status_code == 200


def nothing_deleted(world):
    return world.store.deleted_jds == [] and world.store.deleted_jobs == []


def test_replacing_the_description_deactivates_its_job_and_deletes_nothing(world):
    for replacer in (world.sales, world.mgr):
        world.store.updated_jobs.clear()
        r = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
        url = f"/api/tracker/requirements/{r['id']}"
        world.as_(world.rita)                                                       # the recruiter posts the job from the description
        posted = world.client.post(url + "/posted", json={"job_id": "job-1"})
        assert posted.status_code == 200 and posted.json()["job_id"] == "job-1"
        world.as_(replacer)
        assert world.client.patch(url, json={"jd_id": "missing"}).status_code == 422
        assert world.store.updated_jobs == []                                         # a refused upload changes nothing
        new = world.client.patch(url, json={"jd_id": "jd-2"}).json()
        assert new["jd_filename"] == "Second.docx" and new["job_id"] is None          # the requirement can post the new one
        assert world.store.updated_jobs == [("job-1", {"is_active": False})]          # the old job is switched off ...
        assert nothing_deleted(world) and "jd-1" in world.store.jds                    # ... and nothing is deleted: the job, its applicants, the description
        history = {(h["field"], h["old"], h["new"]) for h in world.client.get(url).json()["history"]}
        assert ("job_posted", "job-1", None) in history
        world.as_(world.sales)


def test_removing_the_description_deactivates_its_job_and_deletes_nothing(world):
    r = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
    world.as_(world.rita)
    world.client.post(f"/api/tracker/requirements/{r['id']}/posted", json={"job_id": "job-1"})
    world.as_(world.evp)
    out = world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"jd_id": None}).json()
    assert out["jd_id"] is None and out["jd_filename"] is None and out["job_id"] is None
    assert world.store.updated_jobs == [("job-1", {"is_active": False})]
    assert nothing_deleted(world) and "jd-1" in world.store.jds


def test_without_a_posted_job_replacing_the_description_touches_nothing(world):
    r = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
    world.as_(world.mgr)
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"jd_id": "jd-2"})
    assert world.store.updated_jobs == [] and nothing_deleted(world)
    # the first upload on a requirement that had none changes nothing either
    empty = make(world, who=world.sales, recruiter_id=world.rita.id)
    world.as_(world.sales)
    world.client.patch(f"/api/tracker/requirements/{empty['id']}", json={"jd_id": "jd-2"})
    assert world.store.updated_jobs == [] and nothing_deleted(world)


def test_a_description_used_by_another_requirement_is_untouched(world):
    a = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
    b = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
    world.as_(world.sales)
    world.client.patch(f"/api/tracker/requirements/{a['id']}", json={"jd_id": "jd-2"})
    assert nothing_deleted(world) and world.client.get(f"/api/tracker/requirements/{b['id']}").json()["jd_id"] == "jd-1"


def test_a_recruiter_can_still_post_the_job_from_the_description(world):
    r = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
    world.as_(world.rita)
    assert world.client.post(f"/api/tracker/requirements/{r['id']}/posted", json={"job_id": "job-1"}).status_code == 200


# ---------------------------------------------------------------------------------------------------------------- who changes which field

def test_each_comment_belongs_to_one_role_and_the_status_to_recruiters_and_recruitment_managers(world):
    r = make(world, recruiter_id=world.rita.id)
    url = f"/api/tracker/requirements/{r['id']}"
    comment = lambda user, field: (world.as_(user), world.client.patch(url, json={field: "text"}).status_code)[1]
    # the sales manager: only the sales manager comments, and not the status
    assert comment(world.sales, "sales_comments") == 200
    assert comment(world.sales, "rm_comments") == 403
    assert comment(world.sales, "recruiter_comments") == 403
    world.as_(world.sales)
    assert world.client.patch(url, json={"status": "hold"}).status_code == 403
    # the recruitment manager: only the recruitment manager comments, and the status
    assert comment(world.mgr, "rm_comments") == 200
    assert comment(world.mgr, "sales_comments") == 403
    assert comment(world.mgr, "recruiter_comments") == 403
    world.as_(world.mgr)
    assert world.client.patch(url, json={"status": "hold"}).status_code == 200
    # the recruiter: their own comments and the status
    assert comment(world.rita, "recruiter_comments") == 200
    assert comment(world.rita, "rm_comments") == 403
    world.as_(world.rita)
    assert world.client.patch(url, json={"status": "submitted"}).status_code == 200
    # the EVP oversees everything
    world.as_(world.evp)
    assert world.client.patch(url, json={"sales_comments": "a", "rm_comments": "b", "recruiter_comments": "c", "status": "closed"}).status_code == 200


def test_creating_follows_the_same_rules(world):
    for bad in ({"rm_comments": "x"}, {"recruiter_comments": "x"}, {"status": "hold"}):
        assert world.client.post("/api/tracker/requirements", json=body(**bad)).status_code == 403, bad
    world.as_(world.mgr)
    assert world.client.post("/api/tracker/requirements", json=body(sales_comments="x")).status_code == 403
    assert world.client.post("/api/tracker/requirements", json=body(rm_comments="x", status="hold")).status_code == 201


def test_the_options_say_which_fields_a_person_can_change(world):
    editable = lambda user: (world.as_(user), world.client.get("/api/tracker/options").json()["editable"])[1]
    sales = editable(world.sales)
    assert sales["sales_comments"] and not sales["rm_comments"] and not sales["recruiter_comments"] and not sales["status"] and sales["recruiter"]
    assert sales["job_location"] and sales["salary"] and "location" not in sales
    mgr = editable(world.mgr)
    assert mgr["rm_comments"] and mgr["status"] and not mgr["sales_comments"] and mgr["recruiter"] and mgr["job_location"] and mgr["salary"]
    rec = editable(world.rita)
    assert rec["recruiter_comments"] and rec["status"] and not rec["jd"] and not rec["rm_comments"] and not rec["recruiter"] and not rec["position"]
    assert not rec["job_location"] and not rec["salary"]
    assert all(editable(world.evp).values())                                                  # the EVP may change every field


def test_marking_a_job_posted_checks_the_job_and_who_posted_it(world):
    r = make(world, recruiter_id=world.rita.id, jd_id="jd-1")
    world.as_(world.rita)
    url = f"/api/tracker/requirements/{r['id']}/posted"
    assert world.client.post(url, json={"job_id": "nope"}).status_code == 404
    assert world.client.post(url, json={"job_id": "job-x"}).status_code == 403
    assert world.client.post(url, json={"job_id": "job-1"}).status_code == 200


# ---------------------------------------------------------------------------------------------------------------- managers, history

def test_managers_change_every_field_and_the_history_records_it(world):
    r = make(world, recruiter_id=world.rita.id, sales_comments="first")
    world.as_(world.mgr)
    url = f"/api/tracker/requirements/{r['id']}"
    out = world.client.patch(url, json={"recruiter_id": world.rob.id, "status": "hold", "rm_comments": "wait for the client",
                                        "position": "Senior Network Engineer", "cv_submission_date": "2026-11-20"})
    assert out.status_code == 200, out.text
    assert out.json()["recruiter"]["username"] == "rob"
    world.as_(world.sales)                                                       # only the sales manager writes the sales comments
    assert world.client.patch(url, json={"sales_comments": None}).status_code == 200
    world.as_(world.mgr)
    world.as_(world.mgr_ad)
    assert world.client.get(url).status_code == 404
    world.as_(world.mgr)
    history = world.client.get(url).json()["history"]
    by_field = {h["field"]: h for h in history if h["action"] == "changed"}
    assert by_field["recruiter"]["old"] == "rita" and by_field["recruiter"]["new"] == "rob"
    assert by_field["status"]["old"] == "open" and by_field["status"]["new"] == "hold"
    assert by_field["sales_comments"]["old"] == "first" and by_field["sales_comments"]["new"] is None
    assert history[-1]["action"] == "created" and history[-1]["actor"] == "sam"
    # nothing changed: no new history
    n = len(history)
    world.client.patch(url, json={"status": "hold"})
    assert len(world.client.get(url).json()["history"]) == n
    # the recruiter's own view of the history leaves out the sales manager's comments
    world.as_(world.rob)
    assert "sales_comments" not in {h["field"] for h in world.client.get(url).json()["history"]}


def test_only_the_evp_and_the_admin_can_hand_a_requirement_to_the_other_location(world):
    r = make(world, recruiter_id=world.rita.id)
    url = f"/api/tracker/requirements/{r['id']}"
    assert world.client.patch(url, json={"recruiter_id": world.ravi.id}).status_code == 422       # a Dubai sales manager cannot pick an Abu Dhabi recruiter
    assert world.client.patch(url, json={"location": "Abu Dhabi"}).json()["location"] == "Dubai"  # and there is no location to change
    world.as_(world.evp)
    moved = world.client.patch(url, json={"recruiter_id": world.ravi.id})
    assert moved.status_code == 200 and moved.json()["location"] == "Abu Dhabi"                   # it follows the recruiter
    assert ("location", "Dubai", "Abu Dhabi") in {(h["field"], h["old"], h["new"]) for h in world.client.get(url).json()["history"]}
    world.as_(world.sales)
    assert world.client.get(url).status_code == 404                                               # no longer Dubai's
    world.as_(world.sales_ad)
    assert world.client.get(url).status_code == 200
    world.as_(world.evp)
    cleared = world.client.patch(url, json={"recruiter_id": None}).json()
    assert cleared["recruiter"] is None and cleared["location"] == "Abu Dhabi"                    # taking the recruiter off does not lose the location


def test_delete_removes_the_requirement_and_its_history(world):
    r = make(world)
    assert world.client.delete(f"/api/tracker/requirements/{r['id']}").status_code == 204
    assert world.client.get(f"/api/tracker/requirements/{r['id']}").status_code == 404
    assert world.session.query(RequirementEvent).count() == 0


# ---------------------------------------------------------------------------------------------------------------- list, filters, widgets

def test_stats_filters_and_search(world):
    admin = dict(who=world.admin)
    make(world, position="Cloud Architect", client="Globex", requirement_date="2026-10-01", status="open")
    make(world, **admin, position="Accountant", client="50% Foods", requirement_date="2026-11-01", status="submitted", recruiter_id=world.rita.id)
    make(world, **admin, position="Driver", client="Acme_Ltd", requirement_date="2026-11-05", status="hold")
    make(world, **admin, position="Chef", client="Globex", requirement_date="2026-11-10", status="closed")
    world.as_(world.admin)                  # the admin's own two have no recruiter, so no location yet: only the EVP and the admin see them all
    get = lambda **p: world.client.get("/api/tracker/requirements", params=p).json()
    everything = get()
    assert everything["stats"] == {"open": 1, "submitted": 1, "hold": 1, "closed": 1, "canceled": 0, "total": 4, "cvs_submitted": 0}
    assert [i["position"] for i in everything["items"]] == ["Driver", "Accountant", "Cloud Architect"]      # newest first; the closed one is on the Closures page
    assert everything["total"] == 3
    # the tiles do not shrink to the chosen status, so they can be used to switch between statuses
    only_hold = get(status="hold")
    assert only_hold["total"] == 1 and only_hold["stats"]["total"] == 4
    assert get(q="globex")["total"] == 1                       # the other Globex requirement is closed
    assert get(q="rita")["total"] == 1                         # by recruiter
    assert get(q="50%")["total"] == 1 and get(q="%")["total"] == 1                       # % and _ are plain characters
    assert get(q="acme_")["total"] == 1 and get(q="acme.")["total"] == 0
    assert get(date_from="2026-11-01", date_to="2026-11-05")["total"] == 2
    assert get(recruiter_id=world.rita.id)["total"] == 1 and get(recruiter_id="none")["total"] == 2
    page = get(limit=2, offset=1)
    assert [i["position"] for i in page["items"]] == ["Accountant", "Cloud Architect"] and page["total"] == 3


# ---------------------------------------------------------------------------------------------------------------- Excel

def sheet(response):
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "attachment" in response.headers["content-disposition"]
    return load_workbook(io.BytesIO(response.content)).active


def test_excel_export(world):
    make(world, who=world.admin, position="=HYPERLINK(\"http://x\")", client="Acme", status="submitted", job_location="Dubai, UAE", salary="12,000 AED",
         recruiter_id=world.rita.id, sales_comments="secret", rm_comments="rm note", cv_submission_date="2026-11-09")
    make(world, position="Chef")
    ws = sheet(world.client.get("/api/tracker/requirements/export", params={"status": "submitted"}))
    header = [c.value for c in ws[1]]
    assert header == ["S.No", "Position", "Client", "Recruiter", "Recruitment manager", "Sales manager", "Requirement date", "Submission deadline",
                      "CVs submitted on", "No. of CVs submitted", "Status", "Sales manager comments", "Recruitment manager comments", "Recruiter comments",
                      "Job location", "Salary", "Job duration", "Posted in Careers"]          # the page's columns, in the page's order
    assert "Location" not in header                                         # the page has no location column, nor does the file
    assert ws.max_row == 2                                                  # the filter applies
    row = {h: c.value for h, c in zip(header, ws[2])}
    assert row["Position"].startswith("=") and ws["B2"].data_type == "s"    # kept as text, never run as a formula
    assert row["Job location"] == "Dubai, UAE" and row["Salary"] == "12,000 AED"
    assert row["Recruiter"] == "rita" and row["Status"] == "Submitted" and row["Sales manager comments"] == "secret"
    assert row["Submission deadline"].date().isoformat() == "2026-11-09"
    # a recruiter's export has no sales manager comments
    world.as_(world.rita)
    ws = sheet(world.client.get("/api/tracker/requirements/export"))
    header = [c.value for c in ws[1]]
    assert "Sales manager comments" not in header and ws.max_row == 2
    # and an export is scoped like the list
    world.as_(world.sales_ad)
    assert sheet(world.client.get("/api/tracker/requirements/export")).max_row == 2 - 1      # only the header


# ---------------------------------------------------------------------------------------------------------------- closures

def close(world, r, by=None):
    """Close a requirement as its recruiter (or ``by``) and give the calling person back."""
    before = world.caller["user"]
    world.as_(by or world.rita)
    out = world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "closed"})
    world.as_(before)
    assert out.status_code == 200, out.text
    return out.json()


def test_a_closed_requirement_leaves_the_lists_and_appears_in_closures_for_its_recruiter(world):
    r = make(world, recruiter_id=world.rita.id, requirement_date="2026-11-02")
    other = make(world, recruiter_id=world.rob.id)
    closed = close(world, r)
    assert closed["status"] == "closed" and closed["closed_by"] == "rita" and closed["closed_at"] and closed["days_to_close"] >= 0
    # gone from every requirements list, but counted by the widgets
    listing = world.client.get("/api/tracker/requirements").json()
    assert [i["id"] for i in listing["items"]] == [other["id"]] and listing["stats"]["closed"] == 1 and listing["stats"]["total"] == 2
    world.as_(world.rita)
    assert world.client.get("/api/tracker/requirements").json()["total"] == 0
    # and shown in her closures, credited to her
    mine = world.client.get("/api/tracker/closures").json()
    assert [i["id"] for i in mine["items"]] == [r["id"]] and mine["items"][0]["recruiter"]["username"] == "rita"
    assert mine["summary"]["closed"] == 1 and mine["summary"]["closed_this_month"] == 1
    # another recruiter does not see her closure
    world.as_(world.rob)
    assert world.client.get("/api/tracker/closures").json()["total"] == 0


def test_managers_see_every_recruiters_closures_in_their_location(world):
    a = make(world, recruiter_id=world.rita.id)
    b = make(world, recruiter_id=world.rob.id)
    close(world, a)
    close(world, b, by=world.rob)
    world.as_(world.sales_ad)
    far = make(world, recruiter_id=world.ravi.id)
    close(world, far, by=world.ravi)
    world.as_(world.mgr)
    got = world.client.get("/api/tracker/closures").json()
    assert {i["recruiter"]["username"] for i in got["items"]} == {"rita", "rob"}
    assert {i["recruiter"]["username"] for i in world.client.get("/api/tracker/closures", params={"recruiter_id": world.rob.id}).json()["items"]} == {"rob"}
    assert world.client.get("/api/tracker/closures", params={"q": "rita"}).json()["total"] == 1
    world.as_(world.evp)
    assert world.client.get("/api/tracker/closures").json()["total"] == 3
    world.as_(world.mgr_ad)
    assert [i["recruiter"]["username"] for i in world.client.get("/api/tracker/closures").json()["items"]] == ["ravi"]


def test_a_manager_closing_it_still_credits_the_assigned_recruiter(world):
    r = make(world, recruiter_id=world.rita.id)
    out = close(world, r, by=world.mgr)
    assert out["closed_by"] == "mona" and out["recruiter"]["username"] == "rita"
    world.as_(world.rita)
    assert world.client.get("/api/tracker/closures").json()["items"][0]["closed_by"] == "mona"


def test_reopening_returns_it_to_the_list_and_clears_the_closure(world):
    r = make(world, recruiter_id=world.rita.id)
    close(world, r)
    world.as_(world.rita)
    reopened = world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "open"}).json()
    assert reopened["closed_at"] is None and reopened["closed_by"] is None and reopened["days_to_close"] is None
    assert world.client.get("/api/tracker/closures").json()["total"] == 0
    assert world.client.get("/api/tracker/requirements").json()["total"] == 1


def test_a_closed_requirement_keeps_its_recruiter_until_reopened(world):
    r = make(world, recruiter_id=world.rita.id)
    close(world, r)
    world.as_(world.mgr)
    url = f"/api/tracker/requirements/{r['id']}"
    assert world.client.patch(url, json={"recruiter_id": world.rob.id}).status_code == 422
    assert world.client.patch(url, json={"status": "open", "recruiter_id": world.rob.id}).status_code == 200      # reopen and reassign together


def test_closing_and_reassigning_in_one_change_is_refused(world):
    r = make(world, recruiter_id=world.rita.id)
    world.as_(world.mgr)
    assert world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "closed", "recruiter_id": world.rob.id}).status_code == 422


def test_closures_export(world):
    r = make(world, recruiter_id=world.rita.id, sales_comments="margin")
    close(world, r)
    make(world)
    ws = sheet(world.client.get("/api/tracker/closures/export"))
    header = [c.value for c in ws[1]]
    assert ws.max_row == 2 and "Days to close" in header and "Closed on" in header and "Sales manager comments" in header
    row = {h: c.value for h, c in zip(header, ws[2])}
    assert row["Recruiter"] == "rita" and row["Closed by"] == "rita"
    world.as_(world.rita)
    assert "Sales manager comments" not in [c.value for c in sheet(world.client.get("/api/tracker/closures/export"))[1]]
    world.as_(world.rob)
    assert sheet(world.client.get("/api/tracker/closures/export")).max_row == 1


def test_analytics_by_month_and_by_year_for_a_recruiter_and_for_the_team(world):
    from datetime import date, datetime
    cases = [(world.rita, "2026-03-10", 4), (world.rita, "2026-02-15", 10), (world.rob, "2026-03-20", 6), (world.rita, "2025-12-30", 3)]
    for who, closed_on, days_open in cases:
        r = make(world, recruiter_id=who.id)
        close(world, r, by=who)
        row = world.session.get(Requirement, r["id"])                               # put the closure where the test wants it
        row.closed_at = datetime.fromisoformat(closed_on + "T10:00:00")
        row.requirement_date = date.fromordinal(row.closed_at.date().toordinal() - days_open)
        world.session.add(row)
    make(world, recruiter_id=world.rita.id)                                         # still open
    world.session.commit()
    get = lambda **p: world.client.get("/api/tracker/analytics", params=p).json()

    world.as_(world.mgr)
    march = get(view="monthly", year=2026, month=3)
    assert march["view"] == "monthly" and march["label"] == "March 2026" and march["scope"] == "team"
    assert march["summary"]["closed"] == 2 and march["summary"]["previous_closed"] == 1 and march["summary"]["previous_label"] == "February 2026"
    assert march["summary"]["avg_days"] == 5.0 and march["summary"]["active_total"] == 1
    assert len(march["series"]) == 31 and march["series"][9]["closed"] == 1 and march["series"][19]["closed"] == 1 and sum(d["closed"] for d in march["series"]) == 2
    people = {p["username"]: p for p in march["recruiters"]}
    assert people["rita"]["closed"] == 1 and people["rob"]["closed"] == 1 and people["rita"]["open"] == 1
    assert march["clients"][0] == {"client": "Acme", "closed": 2, "avg_days": 5.0}
    assert len(get(view="monthly", year=2026, month=2)["series"]) == 28
    january = get(view="monthly", year=2026, month=1)                              # compared with December of the year before
    assert january["summary"]["closed"] == 0 and january["summary"]["previous_label"] == "December 2025" and january["summary"]["previous_closed"] == 1

    year = get(view="yearly", year=2026)
    assert year["label"] == "2026" and year["month"] is None and year["summary"]["closed"] == 3
    assert year["summary"]["previous_closed"] == 1 and year["summary"]["previous_label"] == "2025"
    assert [m["label"] for m in year["series"]] == ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    assert [m["closed"] for m in year["series"]][:4] == [0, 1, 2, 0]
    assert {2026, 2025} <= set(year["years"]) and year["years"] == sorted(year["years"], reverse=True)
    default = get()                                                                 # no year or month: the current month
    assert default["view"] == "monthly" and default["year"] == date.today().year and default["month"] == date.today().month

    world.as_(world.rita)
    mine = get(view="yearly", year=2026)
    assert mine["scope"] == "own" and [p["username"] for p in mine["recruiters"]] == ["rita"] and mine["summary"]["closed"] == 2

    world.as_(world.mgr_ad)                                                         # the other location sees none of it
    other = get(view="yearly", year=2026)
    assert other["summary"]["closed"] == 0 and {p["username"] for p in other["recruiters"]} == {"ravi"}
    world.as_(world.evp)
    both = get(view="yearly", year=2026)
    assert both["summary"]["closed"] == 3 and {p["username"] for p in both["recruiters"]} == {"rita", "rob", "ravi"}
    for bad in ({"view": "weekly"}, {"month": 13}, {"month": 0}, {"year": 1999}):
        assert world.client.get("/api/tracker/analytics", params=bad).status_code == 422, bad


def test_closures_list_says_which_years_have_closures(world):
    from datetime import datetime
    for closed_on in ("2026-03-10", "2025-12-30", "2026-04-01"):
        r = make(world, recruiter_id=world.rita.id)
        close(world, r)
        row = world.session.get(Requirement, r["id"])
        row.closed_at = datetime.fromisoformat(closed_on + "T10:00:00")
        world.session.add(row)
    world.session.commit()
    got = world.client.get("/api/tracker/closures", params={"date_from": "2026-03-01", "date_to": "2026-03-31"}).json()
    assert got["total"] == 1 and got["years"] == [2026, 2025]                      # the years are those of every closure, not only the filtered ones


def test_analytics_counts_canceled_apart_from_the_active_work(world):
    a = make(world, recruiter_id=world.rita.id)
    make(world, recruiter_id=world.rita.id)
    world.as_(world.rita)
    world.client.patch(f"/api/tracker/requirements/{a['id']}", json={"status": "canceled"})
    world.as_(world.mgr)
    data = world.client.get("/api/tracker/analytics").json()
    assert data["summary"]["canceled"] == 1 and data["summary"]["active_total"] == 1       # a canceled requirement is not active work
    person = {p["username"]: p for p in data["recruiters"]}["rita"]
    assert person["canceled"] == 1 and person["open"] == 1 and person["closed"] == 0


# ---------------------------------------------------------------------------------------------------------------- job location, salary, canceled

def test_job_location_and_salary_are_kept_trimmed_and_limited(world):
    r = make(world, job_location="  Dubai, UAE ", salary="12,000 - 15,000 AED")
    assert r["job_location"] == "Dubai, UAE" and r["salary"] == "12,000 - 15,000 AED"
    plain = make(world)
    assert plain["job_location"] is None and plain["salary"] is None                        # both are optional
    blank = make(world, job_location="   ", salary="")
    assert blank["job_location"] is None and blank["salary"] is None
    assert make(world, job_location="a\u0000b")["job_location"] == "ab"
    assert world.client.post("/api/tracker/requirements", json=body(job_location="x" * 161)).status_code == 422
    assert world.client.post("/api/tracker/requirements", json=body(salary="x" * 65)).status_code == 422


def test_the_managers_change_job_location_and_salary_and_the_history_records_it(world):
    r = make(world, recruiter_id=world.rita.id, job_location="Dubai", salary="10,000")
    url = f"/api/tracker/requirements/{r['id']}"
    world.as_(world.mgr)
    out = world.client.patch(url, json={"job_location": "Abu Dhabi", "salary": "11,000"}).json()
    assert out["job_location"] == "Abu Dhabi" and out["salary"] == "11,000"
    history = {(h["field"], h["old"], h["new"]) for h in world.client.get(url).json()["history"]}
    assert ("job_location", "Dubai", "Abu Dhabi") in history and ("salary", "10,000", "11,000") in history
    assert world.client.patch(url, json={"salary": None}).json()["salary"] is None
    world.as_(world.rita)                                                               # the recruiter sees them, and can search by them
    assert world.client.get("/api/tracker/requirements").json()["items"][0]["job_location"] == "Abu Dhabi"
    assert world.client.get("/api/tracker/requirements", params={"q": "abu dhabi"}).json()["total"] == 1
    assert world.client.get("/api/tracker/requirements", params={"q": "sharjah"}).json()["total"] == 0


def test_a_canceled_requirement_stays_on_the_list_and_is_not_a_closure(world):
    r = make(world, recruiter_id=world.rita.id)
    other = make(world, recruiter_id=world.rita.id)
    url = f"/api/tracker/requirements/{r['id']}"
    world.as_(world.rita)
    out = world.client.patch(url, json={"status": "canceled"})
    assert out.status_code == 200 and out.json()["status"] == "canceled" and out.json()["closed_at"] is None
    listing = world.client.get("/api/tracker/requirements").json()
    assert {i["id"] for i in listing["items"]} == {r["id"], other["id"]}                  # still listed, unlike a closed one
    assert listing["stats"]["canceled"] == 1 and listing["stats"]["total"] == 2
    assert [i["id"] for i in world.client.get("/api/tracker/requirements", params={"status": "canceled"}).json()["items"]] == [r["id"]]
    assert world.client.get("/api/tracker/closures").json()["total"] == 0                 # nobody is credited with it
    assert world.client.patch(url, json={"status": "open"}).json()["status"] == "open"    # it can be taken up again
    world.as_(world.sales)                                                                # only those who change a status can cancel
    assert world.client.patch(url, json={"status": "canceled"}).status_code == 403
    world.as_(world.mgr)
    assert world.client.patch(url, json={"status": "cancelled"}).status_code == 422       # the status is spelled 'canceled'
    assert make(world, who=world.mgr, status="canceled")["status"] == "canceled"


# ---------------------------------------------------------------------------------------------------------------- job duration

def test_job_duration_is_nothing_full_time_or_a_fixed_period_that_may_be_extended(world):
    fields = lambda r: (r["duration_type"], r["duration_value"], r["duration_unit"], r["duration_extendable"])
    assert fields(make(world)) == (None, None, None, None)
    assert fields(make(world, duration_type="full_time", duration_value=6, duration_unit="months", duration_extendable=True)) == ("full_time", None, None, None)
    assert fields(make(world, duration_type="fixed", duration_value=6, duration_unit="months", duration_extendable=True)) == ("fixed", 6, "months", True)
    assert fields(make(world, duration_type="fixed", duration_value=15, duration_unit="days")) == ("fixed", 15, "days", False)     # not extendable unless said
    post = lambda **kw: world.client.post("/api/tracker/requirements", json=body(**kw)).status_code
    assert post(duration_type="fixed") == 422                                                          # a fixed period needs a number and a unit
    assert post(duration_type="fixed", duration_value=6) == 422
    assert post(duration_type="fixed", duration_value=0, duration_unit="days") == 422
    assert post(duration_type="fixed", duration_value=32, duration_unit="days") == 422
    assert post(duration_type="fixed", duration_value=3, duration_unit="weeks") == 422
    assert post(duration_type="forever") == 422


def test_changing_the_duration_keeps_it_consistent_is_recorded_and_is_for_managers_only(world):
    r = make(world, recruiter_id=world.rita.id)
    url = f"/api/tracker/requirements/{r['id']}"
    patch = lambda **kw: world.client.patch(url, json=kw)
    world.as_(world.mgr)
    out = patch(duration_type="fixed", duration_value=3, duration_unit="months", duration_extendable=True).json()
    assert (out["duration_value"], out["duration_unit"], out["duration_extendable"]) == (3, "months", True)
    out = patch(duration_extendable=False).json()                                                       # what is not sent keeps its value
    assert (out["duration_type"], out["duration_value"], out["duration_unit"], out["duration_extendable"]) == ("fixed", 3, "months", False)
    assert patch(duration_value=40).status_code == 422
    out = patch(duration_type="full_time").json()                                                       # full time drops the number, the unit and the extension
    assert (out["duration_type"], out["duration_value"], out["duration_unit"], out["duration_extendable"]) == ("full_time", None, None, None)
    assert patch(duration_type="fixed").status_code == 422                                              # and a fixed period needs them again
    history = {(h["field"], h["old"], h["new"]) for h in world.client.get(url).json()["history"]}
    assert ("duration", None, "3 months, extendable") in history
    assert ("duration", "3 months, extendable", "3 months, not extendable") in history
    assert ("duration", "3 months, not extendable", "Full time") in history
    world.as_(world.rita)
    assert patch(duration_type="full_time").status_code == 403
    world.as_(world.sales)
    assert "Job duration" in [c.value for c in sheet(world.client.get("/api/tracker/requirements/export"))[1]]


# ---------------------------------------------------------------------------------------------------------------- several recruiters, and their CVs submitted

def names_of(r):
    return [x["username"] for x in r["recruiters"]]


def test_a_requirement_can_have_several_recruiters_who_each_see_it(world):
    both = make(world, recruiter_ids=[world.rita.id, world.rob.id])
    alone = make(world, recruiter_ids=[world.rita.id])
    assert names_of(both) == ["rita", "rob"] and both["recruiter"]["username"] == "rita"             # the first is the lead
    world.as_(world.rob)
    assert [i["id"] for i in world.client.get("/api/tracker/requirements").json()["items"]] == [both["id"]]      # not the one that is only rita's
    assert world.client.get(f"/api/tracker/requirements/{both['id']}").status_code == 200
    assert world.client.get(f"/api/tracker/requirements/{alone['id']}").status_code == 404
    world.as_(world.rita)
    assert {i["id"] for i in world.client.get("/api/tracker/requirements").json()["items"]} == {both["id"], alone["id"]}
    world.as_(world.mgr)
    get = lambda **p: world.client.get("/api/tracker/requirements", params=p).json()["total"]
    assert get(recruiter_id=world.rob.id) == 1 and get(recruiter_id=world.rita.id) == 2 and get(q="rob") == 1 and get(recruiter_id="none") == 0


def test_the_recruiters_can_be_changed_and_the_history_says_who(world):
    r = make(world, recruiter_ids=[world.rita.id])
    url = f"/api/tracker/requirements/{r['id']}"
    patch = lambda **kw: world.client.patch(url, json=kw)
    world.as_(world.mgr)
    assert names_of(patch(recruiter_ids=[world.rita.id, world.rob.id]).json()) == ["rita", "rob"]
    out = patch(recruiter_ids=[world.rob.id]).json()                                                  # rita is taken off, rob becomes the lead
    assert names_of(out) == ["rob"] and out["recruiter"]["username"] == "rob"
    world.as_(world.rita)
    assert world.client.get(url).status_code == 404 and world.client.get("/api/tracker/requirements").json()["total"] == 0
    world.as_(world.mgr)
    assert names_of(patch(recruiter_id=world.rita.id).json()) == ["rita"]                             # one recruiter, the old way, still works
    out = patch(recruiter_ids=[]).json()
    assert out["recruiters"] == [] and out["recruiter"] is None
    assert names_of(patch(recruiter_ids=[world.rob.id, world.rob.id, " "]).json()) == ["rob"]          # repeats and blanks are dropped
    history = {(h["field"], h["old"], h["new"]) for h in world.client.get(url).json()["history"]}
    assert ("recruiter", "rita", "rita, rob") in history and ("recruiter", "rita, rob", "rob") in history
    # who may be added
    assert patch(recruiter_ids=[world.ravi.id]).status_code == 422                                    # the other location
    assert patch(recruiter_ids=[world.rob.id, world.gone.id]).status_code == 422                      # deactivated
    assert patch(recruiter_ids=["no-such-id"]).status_code == 422
    assert patch(recruiter_ids=[world.rob.id] * 11 + [str(i) for i in range(11)]).status_code == 422  # more than ten
    world.as_(world.rob)
    assert patch(recruiter_ids=[world.rita.id]).status_code == 403                                    # a recruiter does not assign
    world.as_(world.evp)
    assert patch(recruiter_ids=[world.rob.id, world.ravi.id]).status_code == 422                      # one requirement, one team
    assert patch(recruiter_ids=[world.ravi.id]).json()["location"] == "Abu Dhabi"                     # but the EVP can hand it to the other team


def test_a_recruiter_already_on_a_requirement_stays_even_if_deactivated(world):
    r = make(world, recruiter_ids=[world.rita.id, world.rob.id])
    world.rob.is_active = False
    world.session.add(world.rob)
    world.session.commit()
    world.as_(world.mgr)
    out = world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"recruiter_ids": [world.rita.id, world.rob.id], "position": "Other"})
    assert out.status_code == 200 and names_of(out.json()) == ["rita", "rob"]                         # nothing wrong with leaving him where he was


def test_closing_credits_the_recruiter_who_closed_it_and_keeps_all_of_them(world):
    a = make(world, recruiter_ids=[world.rita.id, world.rob.id])
    b = make(world, recruiter_ids=[world.rita.id, world.rob.id])
    by_rob = close(world, a, by=world.rob)
    assert by_rob["recruiter"]["username"] == "rob" and names_of(by_rob) == ["rob", "rita"]          # the one who closed it is credited, the other stays on it
    by_manager = close(world, b, by=world.mgr)
    assert by_manager["recruiter"]["username"] == "rita" and by_manager["closed_by"] == "mona"        # a manager closing credits the lead
    world.as_(world.mgr)
    assert world.client.patch(f"/api/tracker/requirements/{a['id']}", json={"recruiter_ids": [world.rob.id]}).status_code == 422   # not while closed
    world.as_(world.rita)
    assert world.client.get("/api/tracker/closures").json()["total"] == 2                              # both closures are hers to see ...
    mine = world.client.get("/api/tracker/analytics").json()
    assert mine["summary"]["closed"] == 1 and mine["recruiters"][0]["closed"] == 1                     # ... but only the one credited to her counts
    world.as_(world.mgr)
    people = {p["username"]: p for p in world.client.get("/api/tracker/analytics").json()["recruiters"]}
    assert people["rita"]["closed"] == 1 and people["rob"]["closed"] == 1


def test_open_work_counts_for_every_recruiter_on_it_but_once_in_the_totals(world):
    make(world, recruiter_ids=[world.rita.id, world.rob.id])
    world.as_(world.mgr)
    data = world.client.get("/api/tracker/analytics").json()
    assert data["summary"]["active_total"] == 1                                                         # one requirement
    people = {p["username"]: p for p in data["recruiters"]}
    assert people["rita"]["open"] == 1 and people["rob"]["open"] == 1                                   # on both recruiters' plates


def test_each_recruiter_has_their_own_cvs_submitted(world):
    r = make(world, recruiter_ids=[world.rita.id, world.rob.id])
    url = f"/api/tracker/requirements/{r['id']}"
    patch = lambda who, **item: world.client.patch(url, json={"cvs_submissions": [{"recruiter_id": who.id, **item}]})
    stats = lambda: world.client.get("/api/tracker/requirements").json()["stats"]["cvs_submitted"]
    assert stats() == 0

    world.as_(world.rita)
    resp = patch(world.rita, date="2026-11-09", count=3)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["cvs_submitted_count"] == 3 and out["cvs_submitted_date"] == "2026-11-09"                # hers
    assert patch(world.rob, count=9).status_code == 403                                                  # not his to change
    assert stats() == 3
    world.as_(world.rob)
    out = patch(world.rob, date="2026-11-10", count=2).json()
    assert out["cvs_submitted_count"] == 2 and stats() == 2                                              # his own, not hers added
    seen = {x["username"]: x for x in out["recruiters"]}
    assert seen["rita"]["cvs_submitted_count"] is None and seen["rob"]["cvs_submitted_count"] == 2      # he does not see her numbers

    world.as_(world.mgr)                                                                                 # a manager sees the total, and every recruiter's
    item = world.client.get("/api/tracker/requirements").json()["items"][0]
    assert item["cvs_submitted_count"] == 5 and item["cvs_submitted_date"] == "2026-11-10" and stats() == 5
    assert {x["username"]: x["cvs_submitted_count"] for x in item["recruiters"]} == {"rita": 3, "rob": 2}
    assert patch(world.rob, count=4).status_code == 200 and stats() == 7                                 # and may correct one
    assert patch(world.ravi, count=1).status_code == 422                                                 # only a recruiter on this requirement
    history = {(h["field"], h["old"], h["new"]) for h in world.client.get(url).json()["history"]}
    assert ("cvs_submitted_count", None, "rita: 3") in history and ("cvs_submitted_count", "rob: 2", "rob: 4") in history

    world.as_(world.rita)                                                                                # a closed requirement still counts
    world.client.patch(url, json={"status": "closed"})
    assert stats() == 3
    world.as_(world.sales_ad)
    assert stats() == 0                                                                                  # another location's CVs are not in it


def test_cvs_submitted_rules(world):
    r = make(world, recruiter_ids=[world.rita.id], requirement_date="2026-11-02")
    url = f"/api/tracker/requirements/{r['id']}"
    patch = lambda **item: world.client.patch(url, json={"cvs_submissions": [{"recruiter_id": world.rita.id, **item}]})
    world.as_(world.sales)                                                                               # the sales manager does not write these
    assert patch(count=1).status_code == 403
    world.as_(world.rita)
    for bad in ({"count": -1}, {"count": 100001}, {"count": "many"}, {"date": "2026-10-01"}):
        assert patch(**bad).status_code == 422, bad                                                      # and not before the requirement date
    assert patch(count=0).json()["cvs_submitted_count"] == 0                                             # zero is a real answer
    assert patch(count=None).json()["cvs_submitted_count"] is None
    assert patch(date="2026-11-05").json()["cvs_submitted_date"] == "2026-11-05"
    assert patch(count=2).json()["cvs_submitted_date"] == "2026-11-05"                                   # what is not sent is not changed
    world.as_(world.mgr)
    ws = sheet(world.client.get("/api/tracker/requirements/export"))
    header = [c.value for c in ws[1]]
    row = {h: c.value for h, c in zip(header, ws[2])}
    assert row["No. of CVs submitted"] == 2 and row["Recruiter"] == "rita"


def test_the_excel_file_lists_every_recruiter_and_the_total_submitted(world):
    r = make(world, recruiter_ids=[world.rita.id, world.rob.id])
    for who, n in ((world.rita, 3), (world.rob, 2)):
        world.as_(who)
        world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"cvs_submissions": [{"recruiter_id": who.id, "count": n}]})
    world.as_(world.mgr)
    ws = sheet(world.client.get("/api/tracker/requirements/export"))
    header = [c.value for c in ws[1]]
    row = {h: c.value for h, c in zip(header, ws[2])}
    assert row["Recruiter"] == "rita, rob" and row["No. of CVs submitted"] == 5
    world.as_(world.rob)
    ws = sheet(world.client.get("/api/tracker/requirements/export"))
    assert {h: c.value for h, c in zip([c.value for c in ws[1]], ws[2])}["No. of CVs submitted"] == 2           # a recruiter's file has his own


# ---------------------------------------------------------------------------------------------------------------- the EVP's and the admin's location dropdown

def test_the_evp_and_admin_can_look_at_one_location_and_nobody_else_can_widen_theirs(world):
    from datetime import date
    dubai = make(world, recruiter_ids=[world.rita.id])
    world.as_(world.sales_ad)
    abu = make(world, recruiter_ids=[world.ravi.id])
    close(world, dubai, by=world.rita)
    close(world, abu, by=world.ravi)
    get = lambda path, **p: world.client.get(path, params=p).json()
    this_year = date.today().year

    for who in (world.evp, world.admin):
        world.as_(who)
        options = get("/api/tracker/options")
        assert options["all_locations"] is True and options["locations"] == ["Dubai", "Abu Dhabi"]
        assert get("/api/tracker/closures")["total"] == 2 and get("/api/tracker/requirements")["total"] == 0
        assert [i["recruiter"]["username"] for i in get("/api/tracker/closures", location="Dubai")["items"]] == ["rita"]
        assert [i["recruiter"]["username"] for i in get("/api/tracker/closures", location="Abu Dhabi")["items"]] == ["ravi"]
        assert get("/api/tracker/closures", location="Sharjah")["total"] == 2                   # not a location: ignored
        assert sheet(world.client.get("/api/tracker/closures/export", params={"location": "Abu Dhabi"})).max_row == 2
        both = get("/api/tracker/analytics", view="yearly", year=this_year)
        assert both["summary"]["closed"] == 2 and both["location"] is None
        assert {p["location"]: p["closed"] for p in both["locations"]} == {"Dubai": 1, "Abu Dhabi": 1}      # the two side by side
        assert {p["username"] for p in both["recruiters"]} == {"rita", "rob", "ravi"} and {p["location"] for p in both["recruiters"]} == {"Dubai", "Abu Dhabi"}
        one = get("/api/tracker/analytics", view="yearly", year=this_year, location="Abu Dhabi")
        assert one["summary"]["closed"] == 1 and one["location"] == "Abu Dhabi" and one["locations"] == []
        assert {p["username"] for p in one["recruiters"]} == {"ravi"}

    # everyone else stays in their own location, whatever they ask for
    for who, own, other in ((world.mgr, "Dubai", "Abu Dhabi"), (world.sales_ad, "Abu Dhabi", "Dubai"), (world.rita, "Dubai", "Abu Dhabi")):
        world.as_(who)
        assert get("/api/tracker/options")["all_locations"] is False
        mine = get("/api/tracker/closures")
        asked = get("/api/tracker/closures", location=other)
        assert asked["total"] == mine["total"] == 1 and {i["location"] for i in asked["items"]} == {own}
        data = get("/api/tracker/analytics", view="yearly", year=this_year, location=other)
        assert data["summary"]["closed"] == 1 and data["locations"] == [] and data["location"] is None            # the request for the other location changed nothing
        assert get("/api/tracker/requirements", location=other)["total"] == get("/api/tracker/requirements")["total"]


# ---------------------------------------------------------------------------------------------------------------- the analytics numbers

def test_analytics_count_what_came_in_cvs_submitted_overdue_and_the_latest_closures(world):
    from datetime import datetime
    open_one = make(world, recruiter_ids=[world.rita.id, world.rob.id], requirement_date="2026-03-05", cv_submission_date="2026-03-12")
    done = make(world, recruiter_ids=[world.rita.id], requirement_date="2026-03-06")
    close(world, done, by=world.rita)
    row = world.session.get(Requirement, done["id"])
    row.closed_at = datetime.fromisoformat("2026-03-20T10:00:00")
    world.session.add(row)
    world.session.commit()
    world.as_(world.mgr)
    submit = lambda who, day, n: world.client.patch(f"/api/tracker/requirements/{open_one['id']}",
                                                    json={"cvs_submissions": [{"recruiter_id": who.id, "date": day, "count": n}]})
    assert submit(world.rita, "2026-03-15", 4).status_code == 200
    assert submit(world.rob, "2026-04-02", 7).status_code == 200
    get = lambda **p: world.client.get("/api/tracker/analytics", params=p).json()

    march = get(view="monthly", year=2026, month=3)
    s = march["summary"]
    assert s["received"] == 2 and s["closed"] == 1 and s["cvs_submitted"] == 4 and s["overdue"] == 1 and s["median_days"] == 14.0 and s["avg_days"] == 14.0
    assert march["series"][4]["received"] == 1 and march["series"][5]["received"] == 1 and march["series"][19]["closed"] == 1     # 5th, 6th and 20th
    people = {p["username"]: p for p in march["recruiters"]}
    assert people["rita"]["cvs_submitted"] == 4 and people["rob"]["cvs_submitted"] == 0 and people["rita"]["closed"] == 1
    assert march["closures"] == [{"position": "Network Engineer", "client": "Acme", "recruiter": "rita", "location": "Dubai",
                                  "closed_at": "2026-03-20T10:00:00Z", "days": 14}]
    assert march["clients"] == [{"client": "Acme", "closed": 1, "avg_days": 14.0}]
    april = get(view="monthly", year=2026, month=4)
    assert april["summary"]["cvs_submitted"] == 7 and april["summary"]["received"] == 0 and april["summary"]["previous_received"] == 2
    assert get(view="yearly", year=2026)["summary"]["cvs_submitted"] == 11
    world.as_(world.rob)                                                                    # a recruiter's CVs are his own
    assert get(view="yearly", year=2026)["summary"]["cvs_submitted"] == 7
    world.as_(world.rita)
    mine = get(view="monthly", year=2026, month=3)
    assert mine["summary"]["cvs_submitted"] == 4 and mine["summary"]["closed"] == 1 and [c["recruiter"] for c in mine["closures"]] == ["rita"]


# ---------------------------------------------------------------------------------------------------------------- the recruitment manager and the sales manager
def test_the_recruitment_manager_and_the_sales_manager_are_chosen_from_dropdowns(world):
    sol = User(username="sol", password_hash=hash_password("pw-sol"), role="account_manager", is_active=True, location="Dubai", email="sol@example.com")
    world.session.add(sol)
    world.session.commit()
    world.session.refresh(sol)
    r = make(world, recruiter_ids=[world.rita.id])
    assert r["sales_manager"]["username"] == "sam" and r["manager"] is None            # the sales manager who adds it owns it

    def patch(who, **fields):
        world.as_(who)
        return world.client.patch(f"/api/tracker/requirements/{r['id']}", json=fields)

    for who in (world.sales, world.mgr, world.evp, world.admin):
        out = patch(who, manager_id=world.mgr.id, sales_manager_id=sol.id)
        assert out.status_code == 200, out.text
        assert out.json()["manager"]["username"] == "mona" and out.json()["sales_manager"]["username"] == "sol"
        assert patch(who, manager_id=None, sales_manager_id=world.sales.id).json()["manager"] is None
    assert patch(world.rita, manager_id=world.mgr.id).status_code == 403                  # a recruiter changes neither
    assert patch(world.rita, sales_manager_id=sol.id).status_code == 403
    # only an active person of the right role, of the right location
    assert patch(world.sales, manager_id=world.mgr_ad.id).status_code == 422             # Abu Dhabi
    assert patch(world.sales, manager_id=world.rita.id).status_code == 422               # a recruiter, not a manager
    assert patch(world.sales, sales_manager_id=world.mgr.id).status_code == 422          # a manager, not a sales manager
    assert patch(world.sales, sales_manager_id=world.sales_ad.id).status_code == 422
    assert patch(world.evp, manager_id=world.mgr_ad.id).status_code == 422               # the requirement is Dubai's
    world.as_(world.sales)
    assert world.client.get(f"/api/tracker/requirements/{r['id']}").json()["sales_manager"]["username"] == "sam"
    events = {(e["field"], e["new"]) for e in patch(world.mgr, manager_id=world.mgr.id) and
              world.client.get(f"/api/tracker/requirements/{r['id']}").json()["history"]}
    assert ("recruitment_manager", "mona") in events and ("sales_manager", "sol") in events


def test_the_evp_and_admin_pick_both_managers_when_adding_and_the_team_follows(world):
    for who in (world.evp, world.admin):
        world.as_(who)
        made = world.client.post("/api/tracker/requirements", json=body(manager_id=world.mgr_ad.id, sales_manager_id=world.sales_ad.id))
        assert made.status_code == 201, made.text
        assert made.json()["manager"]["username"] == "max" and made.json()["sales_manager"]["username"] == "sara" and made.json()["location"] == "Abu Dhabi"
        clash = world.client.post("/api/tracker/requirements", json=body(manager_id=world.mgr.id, sales_manager_id=world.sales_ad.id))
        assert clash.status_code == 422                                                   # one team: Dubai's manager, Abu Dhabi's sales manager
        none = world.client.post("/api/tracker/requirements", json=body()).json()
        assert none["manager"] is None and none["sales_manager"] is None                  # nobody chosen is allowed
        assert world.client.patch(f"/api/tracker/requirements/{none['id']}", json={"manager_id": world.mgr.id}).json()["location"] == "Dubai"
    world.as_(world.sales)                                                                # a sales manager cannot name the other location's people
    assert world.client.post("/api/tracker/requirements", json=body(manager_id=world.mgr_ad.id)).status_code == 422


def test_the_managers_can_be_filtered_listed_and_are_in_the_excel_in_the_pages_order(world):
    a = make(world, recruiter_ids=[world.rita.id], manager_id=world.mgr.id)
    make(world)
    world.as_(world.sales_ad)
    make(world, manager_id=world.mgr_ad.id)
    for who in (world.evp, world.admin):
        world.as_(who)
        options = world.client.get("/api/tracker/options").json()
        assert [m["username"] for m in options["managers"]] == ["max", "mona"] and {m["username"] for m in options["sales_managers"]} == {"sam", "sara"}
    world.as_(world.sales)
    options = world.client.get("/api/tracker/options").json()
    assert [m["username"] for m in options["managers"]] == ["mona"] and [m["username"] for m in options["sales_managers"]] == ["sam"]
    assert world.client.get("/api/tracker/options").json()["editable"]["recruitment_manager"] and world.client.get("/api/tracker/options").json()["editable"]["sales_manager"]
    get = lambda path, **p: world.client.get(path, params=p).json()
    assert [i["id"] for i in get("/api/tracker/requirements", manager_id=world.mgr.id)["items"]] == [a["id"]]
    assert get("/api/tracker/requirements", manager_id="none")["total"] == 1
    assert get("/api/tracker/requirements", sales_manager_id=world.sales.id)["total"] == 2
    assert get("/api/tracker/requirements", sales_manager_id=world.sales_ad.id)["total"] == 0        # the other location's are not there to find
    ws = sheet(world.client.get("/api/tracker/requirements/export", params={"manager_id": world.mgr.id}))
    row = {h: c.value for h, c in zip([c.value for c in ws[1]], ws[2])}
    assert row["Recruitment manager"] == "mona" and row["Sales manager"] == "sam" and ws.max_row == 2
    # a recruiter's file has no Recruiter column and no sales manager comments, like their page
    world.as_(world.rita)
    header = [c.value for c in sheet(world.client.get("/api/tracker/requirements/export"))[1]]
    assert "Recruiter" not in header and "Sales manager comments" not in header and header[3:5] == ["Recruitment manager", "Sales manager"]
    # and on the closures
    close(world, a, by=world.rita)
    world.as_(world.mgr)
    done = get("/api/tracker/closures", manager_id=world.mgr.id)
    assert [i["manager"]["username"] for i in done["items"]] == ["mona"] and done["items"][0]["sales_manager"]["username"] == "sam"
    ws = sheet(world.client.get("/api/tracker/closures/export"))
    header = [c.value for c in ws[1]]
    assert header[:11] == ["S.No", "Position", "Client", "Recruiter", "Recruitment manager", "Sales manager", "Requirement date", "Submission deadline",
                           "CVs submitted on", "No. of CVs submitted", "Status"]
    row = {h: c.value for h, c in zip(header, ws[2])}
    assert row["Recruitment manager"] == "mona" and row["Sales manager"] == "sam" and row["Status"] == "Closed" and row["Recruiter"] == "rita"


# ---------------------------------------------------------------------------------------------------------------- selections and joining
def selections(world, **params):
    return world.client.get("/api/tracker/selections", params=params).json()


def test_closing_a_requirement_makes_its_selection_row_and_reopening_does_not_duplicate_it(world):
    r = make(world, recruiter_ids=[world.rita.id, world.rob.id], manager_id=world.mgr.id, position="Cloud Engineer", client="Globex")
    world.as_(world.sales)
    assert selections(world)["total"] == 0                                              # nothing until it is closed
    close(world, r, by=world.rita)
    world.as_(world.sales)
    page = selections(world)
    assert page["total"] == 1 and page["stats"] == {"offer_pending": 1, "offer_released": 0, "joined": 0, "backed_out": 0, "total": 1}
    row = page["items"][0]
    assert row["position"] == "Cloud Engineer" and row["client"] == "Globex" and row["status"] == "offer_pending" and row["candidate_name"] is None
    assert [p["username"] for p in row["recruiters"]] == ["rita", "rob"]
    assert row["sales_manager"]["username"] == "sam" and row["manager"]["username"] == "mona" and row["requirement_id"] == r["id"]
    world.client.patch(f"/api/tracker/selections/{row['id']}", json={"candidate_name": "Aisha Khan", "status": "offer_released", "comments": "CTC agreed"})
    world.as_(world.mgr)                                                                # the recruitment manager reopens it and closes it again
    assert world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "open"}).status_code == 200
    assert world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "closed"}).status_code == 200
    page = selections(world)
    assert page["total"] == 1 and page["items"][0]["candidate_name"] == "Aisha Khan" and page["items"][0]["status"] == "offer_released"     # kept, not doubled
    # a requirement added already closed gets its row too
    done = make(world, who=world.admin, status="closed", position="Chef")
    world.as_(world.evp)
    assert any(i["requirement_id"] == done["id"] for i in selections(world)["items"])


def test_recruiters_cannot_see_or_use_the_selections_page(world):
    r = make(world, recruiter_ids=[world.rita.id])
    close(world, r, by=world.rita)
    world.as_(world.sales)
    sid = selections(world)["items"][0]["id"]
    for who in (world.rita, world.rob, world.ravi, world.gone):
        world.as_(who)
        assert world.client.get("/api/tracker/selections").status_code == 403
        assert world.client.get("/api/tracker/selections/options").status_code == 403
        assert world.client.patch(f"/api/tracker/selections/{sid}", json={"status": "joined"}).status_code == 403
        assert world.client.delete(f"/api/tracker/selections/{sid}").status_code == 403
    world.as_(world.sales)
    assert selections(world)["items"][0]["status"] == "offer_pending"                    # nothing changed


def test_selection_visibility_follows_the_location(world):
    a = make(world, recruiter_ids=[world.rita.id])
    world.as_(world.sales_ad)
    b = make(world, recruiter_ids=[world.ravi.id])
    c = make(world, who=world.sales, recruiter_ids=[world.rob.id])
    close(world, a, by=world.rita)
    close(world, b, by=world.ravi)
    close(world, c, by=world.rob)
    for who, expected in ((world.sales, 2), (world.mgr, 2), (world.sales_ad, 1), (world.mgr_ad, 1), (world.evp, 3), (world.admin, 3)):
        world.as_(who)
        assert selections(world)["total"] == expected, who.username
    world.as_(world.evp)
    assert selections(world, location="Abu Dhabi")["total"] == 1 and selections(world, location="Dubai")["total"] == 2
    assert [i["recruiters"][0]["username"] for i in selections(world, recruiter_id=world.rita.id)["items"]] == ["rita"]
    other = selections(world, location="Abu Dhabi")["items"][0]["id"]
    options = world.client.get("/api/tracker/selections/options").json()
    assert options["all_locations"] is True and options["statuses"] == ["offer_pending", "offer_released", "joined", "backed_out"]
    assert {r["username"] for r in options["recruiters"]} == {"rita", "rob", "ravi"} and all(options["editable"].values())
    world.as_(world.sales)                                                              # nobody widens their own location
    assert selections(world, location="Abu Dhabi")["total"] == 2
    options = world.client.get("/api/tracker/selections/options").json()
    assert options["all_locations"] is False and {r["username"] for r in options["recruiters"]} == {"rita", "rob"}
    assert world.client.patch(f"/api/tracker/selections/{other}", json={"status": "joined"}).status_code == 404     # not theirs: reported as missing
    assert world.client.delete(f"/api/tracker/selections/{other}").status_code == 404


def test_selection_fields_cards_filters_and_delete(world):
    ids = []
    last = None
    for i, status in enumerate(("offer_pending", "offer_released", "joined", "joined", "backed_out")):
        last = make(world, recruiter_ids=[world.rita.id], position=f"Role {i}", client="Acme" if i % 2 else "Globex")
        close(world, last, by=world.rita)
        world.as_(world.sales)
        row = next(x for x in selections(world)["items"] if x["requirement_id"] == last["id"])
        assert world.client.patch(f"/api/tracker/selections/{row['id']}", json={"status": status, "candidate_name": f"Cand {i}"}).status_code == 200
        ids.append(row["id"])
    page = selections(world)
    assert page["stats"] == {"offer_pending": 1, "offer_released": 1, "joined": 2, "backed_out": 1, "total": 5}
    only = selections(world, status="joined")
    assert only["total"] == 2 and only["stats"]["total"] == 5                             # the cards ignore the status filter
    assert selections(world, q="cand 3")["total"] == 1 and selections(world, q="globex")["total"] == 3
    url = f"/api/tracker/selections/{ids[0]}"
    assert world.client.patch(url, json={"status": "hired"}).status_code == 422 and world.client.patch(url, json={"status": None}).status_code == 422
    assert world.client.patch(url, json={"selection_date": None}).status_code == 422
    assert world.client.patch(url, json={"comments": "x" * 4001}).status_code == 422
    for who in (world.sales, world.mgr, world.evp, world.admin):                          # each of them writes every field
        world.as_(who)
        out = world.client.patch(url, json={"comments": f"by {who.username}", "selection_date": "2026-11-01"})
        assert out.status_code == 200 and out.json()["comments"] == f"by {who.username}" and out.json()["date"] == "2026-11-01"
    assert world.client.patch(url, json={"candidate_name": None}).json()["candidate_name"] is None
    assert selections(world, date_from="2026-11-02")["total"] == 4
    assert world.client.delete(url).status_code == 204 and selections(world)["total"] == 4
    assert world.session.get(Requirement, last["id"]) is not None                          # the requirement is not touched


def test_a_second_close_of_the_same_requirement_makes_no_second_row_and_no_error(world):
    """The database decides (INSERT ... ON CONFLICT DO NOTHING): a closer that loses the race gets nothing back instead of an error."""
    from sqlalchemy import func, select

    from app.services.selections import create_for_closed

    r = make(world, recruiter_ids=[world.rita.id, world.rob.id])
    close(world, r, by=world.rita)
    row = world.session.get(Requirement, r["id"])
    assert create_for_closed(world.session, row, [world.rita.id]) is None          # the other worker's insert already happened
    world.session.commit()
    assert world.session.execute(select(func.count()).select_from(Selection)).scalar_one() == 1
    assert world.session.execute(select(func.count()).select_from(SelectionRecruiter)).scalar_one() == 2     # and its recruiters were not written twice
    close(world, r, by=world.rita)                                                    # closing an already closed requirement changes nothing either
    assert world.session.execute(select(func.count()).select_from(Selection)).scalar_one() == 1


def test_one_selection_can_be_read_by_id_under_the_same_rules_as_the_list(world):
    r = make(world, recruiter_ids=[world.rita.id])
    close(world, r, by=world.rita)
    world.as_(world.sales)
    sid = selections(world)["items"][0]["id"]
    one = world.client.get(f"/api/tracker/selections/{sid}")
    assert one.status_code == 200 and one.json()["id"] == sid and one.json()["position"] == "Network Engineer"
    world.as_(world.evp)
    assert world.client.get(f"/api/tracker/selections/{sid}").status_code == 200
    for who, expected in ((world.sales_ad, 404), (world.mgr_ad, 404), (world.rita, 403)):                # the other location: missing; a recruiter: not their page
        world.as_(who)
        assert world.client.get(f"/api/tracker/selections/{sid}").status_code == expected, who.username
    world.as_(world.sales)
    assert world.client.get("/api/tracker/selections/no-such-id").status_code == 404
