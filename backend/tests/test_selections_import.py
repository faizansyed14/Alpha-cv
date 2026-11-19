"""Importing Selections & joining from Excel: the columns must match the template, the preview changes nothing, a closed requirement's
empty row gets its candidate, and a row that is already there is skipped (never duplicated, never changed)."""
import io

from openpyxl import Workbook
from sqlmodel import select

from app.models.selection import Selection, SelectionRecruiter
from tests.test_tracker import close, make, world  # noqa: F401  (world is the fixture)

HEADER = ["Date", "Candidate Name", "Position", "Client", "Status", "Recruiter", "Account Manager", "Recruitment Manager", "Comment"]


def sheet(rows, header=HEADER):
    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def post(world, data, apply=False):
    return world.client.post("/api/tracker/selections/import", params={"apply": str(apply).lower()},
                             files={"file": ("candidates.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})


def rows(world):
    return world.session.exec(select(Selection)).all()


ROW_A = ["2026-11-03", "Saleh Alzaabi", "Multimedia", "PGC", "Offer Pending", "rita", "sam", "mona", "Offer pending"]
ROW_B = ["2026-11-03", "Hamdan AlBahar", "Multimedia", "PGC", "Joined", "rita", "sam", "mona", "Joined on 10th Nov"]
ROW_C = ["2026-10-30", "Omer Ali", "Power BI Developer", "NMDC", "Backed Out", "rob", "sam", "mona", "Declined the offer"]


def test_the_preview_changes_nothing_and_new_rows_are_added_on_import(world):
    got = post(world, sheet([ROW_A, ROW_C])).json()
    assert got["summary"]["new"] == 2 and got["summary"]["error"] == 0 and rows(world) == []
    done = post(world, sheet([ROW_A, ROW_C]), apply=True).json()
    assert done["created"] == 2
    saved = {r.candidate_name: r for r in rows(world)}
    a = saved["Saleh Alzaabi"]
    assert (a.position, a.client, a.status, a.comments, str(a.selection_date), a.location) == ("Multimedia", "PGC", "offer_pending", "Offer pending", "2026-11-03", "Dubai")
    assert a.sales_manager_id == world.sales.id and a.manager_id == world.mgr.id and a.requirement_id is None
    assert [l.recruiter_id for l in world.session.exec(select(SelectionRecruiter).where(SelectionRecruiter.selection_id == a.id))] == [world.rita.id]
    assert saved["Omer Ali"].status == "backed_out"


def test_a_closed_requirements_empty_row_gets_the_candidate_and_a_second_candidate_gets_a_new_row(world):
    r = make(world, recruiter_ids=[world.rita.id], position="Multimedia", client="PGC")
    close(world, r)
    [empty] = rows(world)
    assert empty.candidate_name is None and empty.requirement_id == r["id"]
    got = post(world, sheet([ROW_A, ROW_B]), apply=True).json()
    assert got["summary"]["fill"] == 1 and got["summary"]["new"] == 1
    by_name = {s.candidate_name: s for s in rows(world)}
    assert by_name["Saleh Alzaabi"].id == empty.id and by_name["Saleh Alzaabi"].requirement_id == r["id"]   # filled, still linked
    assert by_name["Hamdan AlBahar"].requirement_id is None and len(rows(world)) == 2


def test_a_duplicate_is_skipped_and_the_existing_row_is_never_changed(world):
    post(world, sheet([ROW_A, ROW_C]), apply=True)
    again = post(world, sheet([ROW_A, ROW_C]), apply=True).json()
    assert again["summary"]["exists"] == 2 and again["created"] == 0 and len(rows(world)) == 2
    joined = ROW_A[:4] + ["Joined"] + ROW_A[5:8] + ["Joined on 20th Nov"]                 # the same candidate with another status
    skipped = post(world, sheet([joined]), apply=True).json()
    assert skipped["summary"]["exists"] == 1 and skipped["created"] == 0
    a = next(s for s in rows(world) if s.candidate_name == "Saleh Alzaabi")
    assert a.status == "offer_pending" and a.comments == "Offer pending"                   # untouched
    twice = post(world, sheet([ROW_B, ROW_B]), apply=True).json()                         # the same new candidate twice in one sheet: once
    assert [x["outcome"] for x in twice["rows"]] == ["new", "exists"] and twice["created"] == 1
    assert sum(1 for s in rows(world) if s.candidate_name == "Hamdan AlBahar") == 1


def test_problem_rows_are_left_out_with_the_reason(world):
    bad = [
        ["2026-11-03", "X", "Multimedia", "PGC", "Offer Pending", "Patricia", "sam", "mona", ""],   # no such login
        ["2026-11-03", "Y", "Multimedia", "PGC", "Hired", "rita", "sam", "mona", ""],              # unknown status
        ["2026-11-03", "", "Multimedia", "PGC", "Joined", "rita", "sam", "mona", ""],              # no candidate
        ["2026-11-03", "Z", "Multimedia", "PGC", "Joined", "ravi", "sam", "mona", ""],             # Abu Dhabi recruiter, Dubai importer
    ]
    got = post(world, sheet([ROW_A] + bad), apply=True).json()
    assert got["created"] == 1 and got["summary"]["error"] == 4
    reasons = {r["row"]: " ".join(r["problems"]) for r in got["rows"] if r["outcome"] == "error"}
    assert "no active login called 'Patricia'" in reasons[3] and "status 'Hired'" in reasons[4]
    assert "no candidate name" in reasons[5] and "works in Abu Dhabi" in reasons[6]
    assert got["missing_logins"] == [{"name": "Patricia", "role": "Recruiter", "rows": 1}]


def test_the_columns_must_match_and_recruiters_cannot_import(world):
    wrong = post(world, sheet([ROW_A], header=HEADER[:8] + ["Comments"]))
    assert wrong.status_code == 400 and "missing: Comment" in wrong.json()["detail"] and "not expected: Comments" in wrong.json()["detail"]
    cols = world.client.get("/api/tracker/selections/import/columns").json()
    assert cols["columns"] == HEADER
    assert post(world, world.client.get("/api/tracker/selections/import/template").content).status_code == 200
    world.as_(world.rita)
    assert post(world, sheet([ROW_A])).status_code == 403
    assert rows(world) == []
