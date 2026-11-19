"""Importing requirements from an Excel sheet: the preview changes nothing, the import takes the rows that are fine, and the same sheet
imported again adds nothing. The sheet has the same columns as the tracker the team kept in Excel."""
import io

from openpyxl import Workbook
from sqlmodel import select

from app.models.requirement import Requirement, RequirementEvent, RequirementRecruiter
from app.models.selection import Selection
from app.models.user import User
from app.security.auth import hash_password
from tests.test_tracker import world  # noqa: F401  (the fixture)

HEADER = ["S.no", "Role", "Client", "Recruiter", "Recruiter Manager", "Account Manager", "Requirement Date", "Submission Date",
          "No of CVs Submitted", "Status", "Comments"]


def sheet(rows, header=HEADER):
    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


ROWS = [
    [1, "IT Support Engineer", "Response Plus", "rita", "mona", "sam", "2026-10-05", "2026-10-05", 7, "Submitted", "7 Profiles submitted on 5th Oct"],
    [2, "Outdoor Sales Engineer", "Universal", "rob", "mona", "sam", "2026-10-06", None, None, "Open", None],
    [3, "Windows Administrator", "ADNOC", "Rita", "Mona", "Sam", None, "2026-09-20", 3, "Closed", "Selected"],         # no requirement date
    [4, "Data Scientist", "Saal", "mona", "mona", "sam", "2026-10-06", "2026-10-07", 2, "Hold", None],                 # the manager recruits
    [5, "Powerapps Developer", "Fertiglobe", "rob", "mona", "sam", "2026-04-21", "2026-04-19", 4, "Submitted", None],   # CVs before the date
]


def post(world, data, apply=False, name="job_openings.xlsx"):
    return world.client.post("/api/tracker/requirements/import", params={"apply": str(apply).lower()},
                             files={"file": (name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})


def stored(world):
    return world.session.exec(select(Requirement)).all()


def test_the_preview_reads_every_row_and_changes_nothing(world):
    got = post(world, sheet(ROWS)).json()
    assert got["applied"] is False and got["created"] == 0 and stored(world) == []
    assert got["summary"] == {"rows": 5, "import": 5, "exists": 0, "error": 0, "with_notes": 2}
    by_row = {r["row"]: r for r in got["rows"]}
    assert by_row[2]["recruiters"] == ["rita"] and by_row[2]["manager"] == "mona" and by_row[2]["sales_manager"] == "sam"
    assert by_row[2]["status"] == "submitted" and by_row[2]["cvs_submitted_count"] == 7
    assert by_row[4]["requirement_date"] == "2026-09-20" and "submission date is used" in by_row[4]["notes"][0]
    assert by_row[5]["recruiters"] == ["mona"]                                            # a recruitment manager as the recruiter
    assert by_row[6]["requirement_date"] == "2026-04-19" and "before the requirement date" in by_row[6]["notes"][0]


def test_a_sheet_of_5000_rows_is_imported_in_seconds_and_more_than_10000_is_refused(world):
    import time
    big = [[i, f"Role {i}", f"Client {i % 40}", "rita", "mona", "sam", "2026-10-05", "2026-10-06", 2, "Submitted", None] for i in range(1, 5001)]
    started = time.monotonic()
    got = post(world, sheet(big), apply=True).json()
    took = time.monotonic() - started
    assert got["summary"]["rows"] == 5000 and got["created"] == 5000 and len(stored(world)) == 5000
    assert took < 60, f"5,000 rows took {took:.1f}s"
    print(f"\n5,000-row import took {took:.1f}s")
    too_big = post(world, sheet([[i, "R", "C", "rita", "mona", "sam", "2026-10-05", None, None, "Open", None] for i in range(10_001)]))
    assert too_big.status_code == 400 and "more than 10000 rows" in too_big.json()["detail"]


def test_importing_creates_the_requirements_as_the_tracker_keeps_them(world):
    got = post(world, sheet(ROWS), apply=True).json()
    assert got["applied"] is True and got["created"] == 5 and len(stored(world)) == 5
    s = world.session
    first = s.exec(select(Requirement).where(Requirement.position == "IT Support Engineer")).one()
    assert first.location == "Dubai" and first.status == "submitted" and first.recruiter_comments == "7 Profiles submitted on 5th Oct"
    link = s.get(RequirementRecruiter, (first.id, world.rita.id))
    assert link.cvs_submitted_count == 7 and str(link.cvs_submitted_date) == "2026-10-05"
    assert s.exec(select(RequirementEvent).where(RequirementEvent.requirement_id == first.id)).first().action == "created"
    closed = s.exec(select(Requirement).where(Requirement.position == "Windows Administrator")).one()
    assert closed.status == "closed" and str(closed.closed_at.date()) == "2026-09-20" and closed.recruiter_id == world.rita.id
    assert s.exec(select(Selection).where(Selection.requirement_id == closed.id)).one()    # on Selections & joining, like any close
    world.as_(world.rita)                                                                 # and on rita's Closures
    assert [i["position"] for i in world.client.get("/api/tracker/closures").json()["items"]] == ["Windows Administrator"]
    world.as_(world.mgr)                                                                  # the manager sees the one they recruit on
    mine = world.client.get("/api/tracker/requirements", params={"recruiter_id": world.mgr.id}).json()["items"]
    assert [i["position"] for i in mine] == ["Data Scientist"]


def test_the_same_sheet_imported_again_adds_nothing(world):
    post(world, sheet(ROWS), apply=True)
    again = post(world, sheet(ROWS), apply=True).json()
    assert again["created"] == 0 and again["summary"]["exists"] == 5 and len(stored(world)) == 5
    twice = post(world, sheet([ROWS[0], ROWS[0]])).json()                                 # the same row twice in one sheet: once
    assert [r["outcome"] for r in twice["rows"]] == ["exists", "exists"]


def test_a_row_with_a_problem_is_left_out_and_the_others_are_imported(world):
    rows = ROWS[:2] + [
        [9, "Security Analyst", "ADMO", "Nobody", "mona", "sam", "2026-10-01", None, None, "Submitted", None],    # unknown recruiter
        [10, "AV Engineer", "ADMO", "rita", "mona", "sam", "2026-10-01", None, None, "Pending", None],           # unknown status
        [11, "Auditor", "ADMO", "ravi", "mona", "sam", "2026-10-01", None, None, "Open", None],                  # Abu Dhabi recruiter
        [12, "", "ADMO", "rita", "mona", "sam", "2026-10-01", None, None, "Open", None],                         # no role
        [13, "Planner", "ADMO", "rita", "mona", "sam", "31/02/2026", None, None, "Open", None],                  # not a date
    ]
    got = post(world, sheet(rows), apply=True).json()
    assert got["created"] == 2 and got["summary"]["error"] == 5
    problems = {r["row"]: " ".join(r["problems"]) for r in got["rows"] if r["outcome"] == "error"}
    assert "no active login called 'Nobody'" in problems[4] and "status 'Pending'" in problems[5]
    assert "works in Abu Dhabi" in problems[6] and "position" in problems[7] and "not a date" in problems[8]


def test_names_are_matched_by_username_first_word_or_email(world):
    s = world.session
    for username, email in (("Abdul Baqi", "abdul.baqi@example.com"), ("shalini.k", "shalini.k@example.com"), ("mary.a", "mary.a@example.com"),
                            ("mary.b", "mary.b@example.com")):
        s.add(User(username=username, password_hash=hash_password("x"), role="user", location="Dubai", is_active=True, email=email))
    s.commit()
    rows = [[1, "A", "C", "Abdul Baqi", "mona", "sam", "2026-10-01", None, None, "Open", None],
            [2, "B", "C", "Shalini", "mona", "sam", "2026-10-01", None, None, "Open", None],
            [3, "D", "C", "Mary", "mona", "sam", "2026-10-01", None, None, "Open", None],
            [4, "E", "C", "rita, rob", "mona", "sam", "2026-10-01", None, None, "Open", None]]
    got = {r["row"]: r for r in post(world, sheet(rows)).json()["rows"]}
    assert got[2]["recruiters"] == ["Abdul Baqi"] and got[3]["recruiters"] == ["shalini.k"]
    assert got[4]["outcome"] == "error" and "matches several logins" in got[4]["problems"][0]
    assert got[5]["recruiters"] == ["rita", "rob"]                                        # several in one cell


def test_only_the_people_who_add_requirements_can_import_and_only_an_xlsx(world):
    world.as_(world.rita)
    assert post(world, sheet(ROWS)).status_code == 403
    world.as_(world.sales)
    assert post(world, b"not a sheet", name="a.csv").status_code == 400
    assert post(world, b"not a sheet").status_code == 400
    assert post(world, sheet(ROWS, header=["Name", "Age"])).status_code == 400            # no Role / Client columns
    assert stored(world) == []


# ---------------------------------------------------------------------------------------------------------------- the columns must match the template
def test_a_sheet_whose_columns_do_not_match_the_template_is_refused_and_says_why(world):
    wrong = HEADER[:4] + ["Recruitment Manager"] + HEADER[5:]                              # one misspelt column
    got = post(world, sheet(ROWS, header=wrong))
    assert got.status_code == 400
    assert "missing: Recruiter Manager" in got.json()["detail"] and "not expected: Recruitment Manager" in got.json()["detail"]
    extra = post(world, sheet([r + ["x"] for r in ROWS], header=HEADER + ["Notes"]))       # an extra column
    assert extra.status_code == 400 and "not expected: Notes" in extra.json()["detail"]
    fewer = post(world, sheet([r[:10] for r in ROWS], header=HEADER[:10]))                 # Comments left out
    assert fewer.status_code == 400 and "missing: Comments" in fewer.json()["detail"]
    twice = post(world, sheet([r + [r[1]] for r in ROWS], header=HEADER + ["Role"]))
    assert twice.status_code == 400 and "twice: Role" in twice.json()["detail"]
    assert stored(world) == []                                                              # nothing at all was imported


def test_capitals_spaces_order_and_the_serial_number_column_do_not_matter(world):
    header = [h.upper() for h in HEADER[1:]][::-1]                                          # no S.no, capitals, reversed order
    rows = [list(reversed(r[1:])) for r in ROWS]
    header[0] = "  comments  "
    got = post(world, sheet(rows, header=header))
    assert got.status_code == 200 and got.json()["summary"]["import"] == 5


def test_the_template_has_the_exact_columns_and_imports_as_it_is(world):
    from openpyxl import load_workbook

    columns = world.client.get("/api/tracker/requirements/import/columns").json()
    template = world.client.get("/api/tracker/requirements/import/template")
    assert template.status_code == 200
    ws = load_workbook(io.BytesIO(template.content)).active
    assert [c.value for c in ws[1]] == columns["optional"] + columns["columns"] == HEADER
    assert post(world, template.content).status_code == 200                                 # the template itself is accepted
    world.as_(world.rita)
    assert world.client.get("/api/tracker/requirements/import/template").status_code == 403
