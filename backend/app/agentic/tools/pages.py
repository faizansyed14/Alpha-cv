"""How lists are read: one page at a time, the same way for the chat tools and for the "Show more" button.

This is what keeps Agentic mode independent of how big the data gets (1,000 job descriptions, a million CVs):

* the application's own API does the searching and paging (indexed, server side); nothing here ever loads "everything"
* a page on screen is PAGE rows; the MODEL sees at most MODEL_ROWS of them, as a compact summary plus the total, so the tokens
  spent on a list do not grow with the list
* "Show more" fetches the next page straight from the API through ``fetch`` with NO model call, so paging costs no tokens
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from app.agentic.tools.base import ToolError, number, text

PAGE = 10            # rows drawn on screen per page
MODEL_ROWS = 5       # rows the model is shown (the person sees the whole page)


@dataclass
class Page:
    rows: List[Dict[str, Any]]
    total: int
    next_offset: Optional[int] = None      # offset based lists
    stats: Optional[Dict[str, Any]] = None  # counts that belong to the whole list (the tracker's cards), not to this page
    cursor: Optional[str] = None           # cursor based lists (the Boolean search)

    @property
    def has_more(self) -> bool:
        return self.cursor is not None or (self.next_offset is not None and self.next_offset < self.total)


# ------------------------------------------------------------------------------------------------------------- row shapes
def cv_row(cv: Dict[str, Any]) -> Dict[str, Any]:
    keywords = cv.get("skill_keywords") or cv.get("skills") or []
    return {
        "id": cv.get("id"), "name": text(cv.get("full_name"), 80), "title": text(cv.get("job_title"), 80), "years": cv.get("years_of_experience"),
        "location": text(cv.get("location"), 60), "category": text(cv.get("category"), 40), "notice_period": text(cv.get("notice_period"), 40),
        "skills": [text(k, 30) for k in keywords[:6]], "applied_for": text(cv.get("applied_job_title"), 80) or None,
    }


def job_row(j: Dict[str, Any]) -> Dict[str, Any]:
    return {"job_id": j.get("job_id"), "title": text(j.get("job_title"), 90), "location": text(j.get("job_location"), 60), "active": bool(j.get("is_active")),
            "applications": int(j.get("application_count") or 0), "posted_by": text(j.get("posted_by_user"), 40),
            "subject": text(j.get("email_subject_template"), 120), "posted": text(j.get("upload_date"), 10)}


def jd_row(j: Dict[str, Any]) -> Dict[str, Any]:
    return {"jd_id": j.get("id"), "title": text(j.get("job_title"), 90), "file": text(j.get("filename"), 60), "category": text(j.get("category"), 40)}


def _person(value: Any) -> Optional[str]:
    return text((value or {}).get("username"), 40) or None if isinstance(value, dict) else None


def requirement_row(v: Dict[str, Any]) -> Dict[str, Any]:
    """A requirement (open or closed) as one compact row. The id is for the assistant's next call; the screen never shows it."""
    recruiters = ", ".join(text(r.get("username"), 40) for r in (v.get("recruiters") or []) if isinstance(r, dict))
    return {"id": v.get("id"), "position": text(v.get("position"), 90), "client": text(v.get("client"), 60), "date": text(v.get("requirement_date"), 10),
            "deadline": text(v.get("cv_submission_date"), 10) or None, "status": v.get("status"), "recruiters": recruiters or None,
            "manager": _person(v.get("manager")), "sales_manager": _person(v.get("sales_manager")), "cvs": v.get("cvs_submitted_count"),
            "job_location": text(v.get("job_location"), 60) or None, "closed": text(v.get("closed_at"), 10) or None, "days": v.get("days_to_close")}


def selection_row(v: Dict[str, Any]) -> Dict[str, Any]:
    recruiters = ", ".join(text(r.get("username"), 40) for r in (v.get("recruiters") or []) if isinstance(r, dict))
    return {"id": v.get("id"), "date": text(v.get("date"), 10), "candidate": text(v.get("candidate_name"), 80) or None, "position": text(v.get("position"), 90),
            "client": text(v.get("client"), 60), "status": v.get("status"), "recruiters": recruiters or None, "account_manager": _person(v.get("sales_manager")),
            "recruitment_manager": _person(v.get("manager")), "comments": text(v.get("comments"), 160) or None}


# ----------------------------------------------------------------------------------------------------------------- pages
def candidates_page(gateway: Any, *, query: str = "", category: str = "", offset: int = 0, limit: int = PAGE) -> Page:
    body = gateway.get("/api/cv/cvs", q=text(query, 80), category=text(category, 60), limit=limit, offset=offset)
    rows = [cv_row(c) for c in (body.get("cvs") or [])[:limit]]
    total = int(body.get("total") or len(rows))
    return Page(rows, total, next_offset=offset + len(rows))


def boolean_page(gateway: Any, *, query: str, cursor: Optional[str] = None, limit: int = PAGE, experience_min: Any = None,
                 locations: Optional[List[str]] = None, total_hint: int = 0) -> Page:
    request: Dict[str, Any] = {"boolean_query": str(query)[:4000], "limit": limit}
    if cursor:
        request["cursor"] = cursor
    if experience_min not in (None, ""):
        request["experience_min"] = max(0.0, float(experience_min))
    places = [text(x, 60) for x in (locations or []) if text(x, 60)]
    if places:
        request["locations"] = places[:10]
    body = gateway.post("/api/cv/search/advanced", json=request)
    rows = [cv_row(c) for c in (body.get("results") or [])[:limit]]
    return Page(rows, int(body.get("total") or total_hint or len(rows)), cursor=body.get("next_cursor") or None)


def jobs_page(gateway: Any, *, query: str = "", include_inactive: bool = False, offset: int = 0, limit: int = PAGE) -> Page:
    needle = text(query, 80).lower()
    if not needle:
        body = gateway.get("/api/careers/admin/jobs", limit=limit, offset=offset, include_inactive=bool(include_inactive))
        jobs = (body.get("jobs") if isinstance(body, dict) else body) or []
        total = int(body.get("total") or len(jobs)) if isinstance(body, dict) else len(jobs)
        return Page([job_row(j) for j in jobs[:limit]], total, next_offset=offset + len(jobs[:limit]))
    # a keyword search: look through the most recent postings (the list endpoint has no text search) and page within the matches
    body = gateway.get("/api/careers/admin/jobs", limit=200, offset=0, include_inactive=bool(include_inactive))
    jobs = (body.get("jobs") if isinstance(body, dict) else body) or []
    hits = [j for j in jobs if needle in (str(j.get("job_title") or "") + " " + str(j.get("job_location") or "")).lower()]
    page = hits[offset:offset + limit]
    return Page([job_row(j) for j in page], len(hits), next_offset=offset + len(page))


def descriptions_page(gateway: Any, *, query: str = "", offset: int = 0, limit: int = PAGE) -> Page:
    body = gateway.get("/api/jd/jds", q=text(query, 80), limit=limit, offset=offset)
    rows = [jd_row(j) for j in (body.get("jds") or [])[:limit]]
    return Page(rows, int(body.get("total") or len(rows)), next_offset=offset + len(rows))


def requirements_page(gateway: Any, *, query: str = "", status: str = "", location: str = "", recruiter_id: str = "", manager_id: str = "",
                      sales_manager_id: str = "", offset: int = 0, limit: int = PAGE) -> Page:
    body = gateway.get("/api/tracker/requirements", q=text(query, 80), status=status, location=location, recruiter_id=recruiter_id, manager_id=manager_id,
                       sales_manager_id=sales_manager_id, limit=limit, offset=offset)
    rows = [requirement_row(v) for v in (body.get("items") or [])[:limit]]
    return Page(rows, int(body.get("total") or len(rows)), next_offset=offset + len(rows), stats=body.get("stats") or None)


def closures_page(gateway: Any, *, query: str = "", location: str = "", recruiter_id: str = "", manager_id: str = "", sales_manager_id: str = "",
                  year: int = 0, month: int = 0, offset: int = 0, limit: int = PAGE) -> Page:
    from calendar import monthrange

    date_from = date_to = ""
    if year:
        date_from, date_to = (f"{year}-{month:02d}-01", f"{year}-{month:02d}-{monthrange(year, month)[1]:02d}") if month else (f"{year}-01-01", f"{year}-12-31")
    body = gateway.get("/api/tracker/closures", q=text(query, 80), location=location, recruiter_id=recruiter_id, manager_id=manager_id,
                       sales_manager_id=sales_manager_id, date_from=date_from, date_to=date_to, limit=limit, offset=offset)
    rows = [requirement_row(v) for v in (body.get("items") or [])[:limit]]
    return Page(rows, int(body.get("total") or len(rows)), next_offset=offset + len(rows), stats=body.get("summary") or None)


def selections_page(gateway: Any, *, query: str = "", status: str = "", location: str = "", recruiter_id: str = "", date_from: str = "", date_to: str = "",
                    offset: int = 0, limit: int = PAGE) -> Page:
    body = gateway.get("/api/tracker/selections", q=text(query, 80), status=status, location=location, recruiter_id=recruiter_id, date_from=date_from,
                       date_to=date_to, limit=limit, offset=offset)
    rows = [selection_row(v) for v in (body.get("items") or [])[:limit]]
    return Page(rows, int(body.get("total") or len(rows)), next_offset=offset + len(rows), stats=body.get("stats") or None)


# ------------------------------------------------------------------------------------------- what "Show more" may call
def _candidates(gateway: Any, a: Dict[str, Any], offset: int, cursor: Optional[str]) -> Page:
    return candidates_page(gateway, query=a.get("query", ""), category=a.get("category", ""), offset=offset)


def _boolean(gateway: Any, a: Dict[str, Any], offset: int, cursor: Optional[str]) -> Page:
    if not cursor:
        raise ToolError("There is nothing more to load.")
    return boolean_page(gateway, query=a.get("boolean_query", ""), cursor=cursor, experience_min=a.get("experience_min"), locations=a.get("locations"),
                        total_hint=number(a.get("total"), 0, 0, 10**9))


def _jobs(gateway: Any, a: Dict[str, Any], offset: int, cursor: Optional[str]) -> Page:
    return jobs_page(gateway, query=a.get("query", ""), include_inactive=bool(a.get("include_inactive")), offset=offset)


def _descriptions(gateway: Any, a: Dict[str, Any], offset: int, cursor: Optional[str]) -> Page:
    return descriptions_page(gateway, query=a.get("query", ""), offset=offset)


_TRACKER_KEYS = ("query", "status", "location", "recruiter_id", "manager_id", "sales_manager_id")


def _only(a: Dict[str, Any], *keys: str) -> Dict[str, Any]:
    return {k: text(a.get(k), 80) for k in keys if a.get(k) not in (None, "")}


def _requirements(gateway: Any, a: Dict[str, Any], offset: int, cursor: Optional[str]) -> Page:
    return requirements_page(gateway, offset=offset, **_only(a, *_TRACKER_KEYS))


def _closures(gateway: Any, a: Dict[str, Any], offset: int, cursor: Optional[str]) -> Page:
    return closures_page(gateway, offset=offset, year=number(a.get("year"), 0, 0, 2100), month=number(a.get("month"), 0, 0, 12),
                         **_only(a, "query", "location", "recruiter_id", "manager_id", "sales_manager_id"))


def _selections(gateway: Any, a: Dict[str, Any], offset: int, cursor: Optional[str]) -> Page:
    return selections_page(gateway, offset=offset, **_only(a, "query", "status", "location", "recruiter_id", "date_from", "date_to"))


PAGEABLE: Dict[str, Callable[[Any, Dict[str, Any], int, Optional[str]], Page]] = {
    "search_candidates": _candidates, "boolean_search": _boolean, "list_jobs": _jobs, "list_job_descriptions": _descriptions,
    "list_requirements": _requirements, "list_closures": _closures, "list_selections": _selections,
}


def fetch(gateway: Any, tool: str, args: Dict[str, Any], offset: int = 0, cursor: Optional[str] = None) -> Page:
    """The next page of a list that is already on screen. Read only, no model, and only for the list tools above."""
    reader = PAGEABLE.get(tool)
    if reader is None:
        raise ToolError("That cannot be paged.")
    return reader(gateway, dict(args or {}), number(offset, 0, 0, 10**9), (cursor or None))


def descriptor(tool: str, args: Dict[str, Any], page: Page) -> Optional[Dict[str, Any]]:
    """What the card keeps so its "Show more" button can ask for the next page. None when everything is already on screen."""
    if not page.has_more:
        return None
    return {"tool": tool, "args": args, "offset": page.next_offset or 0, "cursor": page.cursor}


# ---------------------------------------------------------------------------------------- what the model is allowed to see
def for_model(rows: List[Dict[str, Any]], keys: List[str], total: int, on_screen: bool) -> Dict[str, Any]:
    """A short summary of a list: a few rows with only the fields needed to pick one, and the real total."""
    top = [{k: r.get(k) for k in keys if r.get(k) not in (None, "")} for r in rows[:MODEL_ROWS]]
    out: Dict[str, Any] = {"total": total, "top": top, "on_screen": len(rows) if on_screen else 0}
    if total > len(top):
        out["note"] = ("There are more than shown. Do not ask for the rest: if the person needs a particular one, search again with a narrower query. "
                       + ("The person can page through them on screen." if on_screen else ""))
    return out
