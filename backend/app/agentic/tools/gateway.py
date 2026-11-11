"""The only door between a tool and the application.

Tools never touch the database or the vector store on their own. They call the application's own API, in-process, carrying the
signed-in person's token. That gives Agentic mode, for free and without a second copy of any rule:

* the same authentication, role checks (the same access rules as the person's own session) and row scoping
* the same validation, rate limits and audit as the normal screens

On top of that the gateway itself is a whitelist, in two tiers:

* tools (the model's hands) can only GET, and POST the few paths listed in POST_PATHS (searches, a match run, creating a job posting);
* changes (a note, a job's status, a notice, an upload, a token decision) go through ``act``, which only the
  confirmed-action executor calls, after the person pressed Confirm on a card that was saved in their conversation. It may use
  POST, PATCH and PUT on the paths in ACTION_PATHS and nothing else.

DELETE does not exist here in any tier, no path with "delete" or "remove" in it is reachable, and nothing outside the lists can
be called, so a confused or manipulated model has no way to delete anything and no way to change anything unconfirmed.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

from app.agentic.tools.base import ToolError

logger = logging.getLogger(__name__)

_ID = r"[\w-]{8,64}"
GET_PATHS = tuple(re.compile(p) for p in (
    r"^/api/cv/cvs$",
    r"^/api/cv/categories$",
    r"^/api/cv/[0-9a-fA-F-]{32,40}$",
    r"^/api/jd/jds$",
    r"^/api/careers/admin/jobs$",
    rf"^/api/careers/admin/jobs/{_ID}/(?:applications|edit-data)$",
    rf"^/api/match/jobs/{_ID}$",
    r"^/api/agents/admin/usage$",
    r"^/api/agents/admin/reset-requests$",
    # read-only extras
    r"^/api/cv/[0-9a-fA-F-]{32,40}/note$",
    r"^/api/careers/admin/(?:jobs-trends|reports/weekly)$",
    r"^/api/(?:health|system-stats|database/status|notice)$",
    r"^/api/admin/users$",
))
POST_PATHS = tuple(re.compile(p) for p in (
    r"^/api/match$",
    r"^/api/cv/search/advanced$",                      # a search (reads only), sent as POST because the query is long
    r"^/api/careers/admin/jobs/post$",                  # the Careers form's manual entry (no file)
    r"^/api/jd/upload-jd$",                             # the Careers page form: 1. upload the JD file
    rf"^/api/careers/admin/jobs/{_ID}/extract-ui-data$",  # 2. read it into the form fields
    r"^/api/careers/admin/jobs/unified-update$",        # 3. create the posting from them (CREATE only: see the guard in request())
))
# Changes, reachable only through ApiGateway.act (the confirmed-action executor). (method, path pattern)
ACTION_PATHS = tuple((m, re.compile(p)) for m, p in (
    ("POST", r"^/api/cv/[0-9a-fA-F-]{32,40}/note$"),                      # a note on a candidate
    ("POST", r"^/api/cv/upload-cv$"),                                       # add a CV to the library (the Upload page's call)
    ("POST", r"^/api/jd/upload-jd$"),                                       # add a job description to the library
    ("PATCH", rf"^/api/careers/admin/jobs/{_ID}/status$"),                  # open or close a job posting
    ("POST", r"^/api/careers/admin/jobs/unified-update$"),                  # edit a job posting (job_id given)
    ("PUT", r"^/api/admin/notice$"),                                        # the notice every user sees
    ("POST", rf"^/api/agents/admin/reset-requests/{_ID}/(?:approve|reject)$"),
))
_FORBIDDEN_WORDS = ("delete", "remove", "purge", "erase")
_STATUS_TEXT = {
    401: "Your session has expired. Please sign in again.",
    403: "Your role is not allowed to do that.",
    404: "That was not found.",
    409: "That conflicts with something that already exists.",
    422: "Some of the details were not valid.",
    429: "That is being asked too often. Please wait a moment.",
}


class ApiGateway:
    def __init__(self, token: str, client_ip: Optional[str] = None) -> None:
        self._token = token
        self._ip = client_ip
        self._client_obj: Any = None

    # ------------------------------------------------------------------------------------------------ the whitelist
    @staticmethod
    def check(method: str, path: str, confirmed: bool = False) -> None:
        m = (method or "").upper()
        if m == "DELETE" or m not in ("GET", "POST", "PATCH", "PUT"):
            raise ToolError("That kind of request is not allowed.")
        clean = (path or "").split("?")[0]
        lowered = clean.lower()
        if any(w in lowered for w in _FORBIDDEN_WORDS):
            raise ToolError("That is not allowed.")
        if confirmed:
            if m == "GET":
                allowed = GET_PATHS
            else:
                allowed = tuple(p for mm, p in ACTION_PATHS if mm == m)
        else:
            if m not in ("GET", "POST"):
                raise ToolError("That kind of request is not allowed.")
            allowed = GET_PATHS if m == "GET" else POST_PATHS
        if not any(p.match(clean) for p in allowed):
            raise ToolError("That is not available in Agentic mode.")

    # --------------------------------------------------------------------------------------------------- the call
    def _client(self) -> Any:
        if self._client_obj is None:
            from starlette.testclient import TestClient   # runs the real app in-process (no network hop)

            from app.main import app

            headers = {"Authorization": f"Bearer {self._token}", "User-Agent": "alpha-agentic"}
            if self._ip:
                headers["X-Forwarded-For"] = self._ip
            self._client_obj = TestClient(app, base_url="http://agentic.internal", headers=headers, raise_server_exceptions=False)
        return self._client_obj

    def request(self, method: str, path: str, *, params: Optional[Dict[str, Any]] = None, json: Any = None,
                data: Optional[Dict[str, Any]] = None, files: Optional[Dict[str, Any]] = None, confirmed: bool = False) -> Any:
        self.check(method, path, confirmed)
        if path.endswith("/unified-update") and (data or {}).get("job_id") and not confirmed:
            raise ToolError("Changing a job that already exists needs the person's confirmation first.")      # that route also edits; the model may only create
        clean_params = {k: v for k, v in (params or {}).items() if v not in (None, "")}
        try:
            response = self._client().request(method.upper(), path, params=clean_params or None, json=json, data=data, files=files)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Agentic gateway failure on {method} {path}: {str(exc)[:200]}")
            raise ToolError("The application could not be reached.")
        if response.status_code >= 400:
            logger.info(f"Agentic gateway {method} {path} -> {response.status_code}")
            reason = ""
            if response.status_code in (400, 422):                 # the application's own explanation is safe to pass on
                try:
                    detail = response.json().get("detail")
                    reason = detail if isinstance(detail, str) else ""
                except Exception:  # noqa: BLE001
                    reason = ""
            default = _STATUS_TEXT.get(response.status_code, "The application hit an error while doing that. Please try again in a moment.")
            raise ToolError(reason[:200] or default)
        try:
            return response.json()
        except ValueError:
            raise ToolError("The application's answer could not be read.")

    def get(self, path: str, **params: Any) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, *, json: Any = None, data: Optional[Dict[str, Any]] = None, files: Optional[Dict[str, Any]] = None) -> Any:
        return self.request("POST", path, json=json, data=data, files=files)

    def act(self, method: str, path: str, *, params: Optional[Dict[str, Any]] = None, json: Any = None, data: Optional[Dict[str, Any]] = None,
            files: Optional[Dict[str, Any]] = None) -> Any:
        """A change the person confirmed. Only the action executor calls this (never a tool the model can choose)."""
        return self.request(method, path, params=params, json=json, data=data, files=files, confirmed=True)
