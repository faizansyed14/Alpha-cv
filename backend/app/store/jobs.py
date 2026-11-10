"""Job descriptions, public job postings and the applications to them: everything read from and written to PostgreSQL."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import Text, and_, cast, delete, func, not_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.ingestion.categories import normalize_category
from app.models.talent import Candidate, EmailSubjectCounter, JobApplication, JobDescription, JobPosting, JobRequirement
from app.store.candidates import chunks, clean_list, cut, fnum, iso, years

logger = logging.getLogger(__name__)

AUTO_CLOSE_AT = 250       # a posting stops taking applications once it has this many

# Where a posting is: the words in its location text that put it in a region (the careers page's location tabs).
REMOTE_WORDS = ("remote", "work from home", "wfh", "anywhere")
KSA_WORDS = ("ksa", "saudi", "riyadh", "jeddah", "dammam", "khobar", "al khobar")
UAE_WORDS = ("uae", "dubai", "abu dhabi", "abudhabi", "sharjah", "ajman", "ras al khaimah", "rak", "fujairah", "al ain")


def bullets(lines: Sequence[str]) -> str:
    return "\n".join(f"• {t}" for t in lines)


def lines_of(text: Optional[str]) -> List[str]:
    """A bullet-point text back into its lines."""
    return [l.strip().lstrip("•").strip() for l in (text or "").split("\n") if l.strip()]


class JobStore:
    engine: Any

    # ================================================================== job descriptions
    def save_job_description(self, d: Dict[str, Any]) -> str:
        """Create or replace a job description. ``d``: id, filename, file_format, mime_type, file_path, raw_text, uploaded_at, llm_model and
        ``standardized`` (what the LLM returned: job_title, years_of_experience, category, boolean_search_string, skills_sentences,
        responsibility_sentences, required_languages, required_certifications)."""
        jid = str(d["id"])
        std = d.get("standardized") or {}
        with Session(self.engine) as s:
            row = s.get(JobDescription, jid) or JobDescription(id=jid)
            if d.get("filename"):
                row.original_filename = cut(d["filename"], 512)
            for key, size in (("file_format", 16), ("mime_type", 128)):
                if d.get(key):
                    setattr(row, key, cut(d[key], size))
            if d.get("file_path"):
                row.file_path = str(d["file_path"])
            if d.get("raw_text") is not None:
                row.raw_text = d["raw_text"]
            if std.get("job_title") is not None:
                row.job_title = cut(std["job_title"], 256)
            if "years_of_experience" in std:
                row.years_required = years(std["years_of_experience"])
            if std.get("category"):
                row.category = normalize_category(std["category"])
            if std.get("boolean_search_string") is not None:
                row.boolean_search_string = std["boolean_search_string"] or None
            if d.get("uploaded_at"):
                row.uploaded_at = d["uploaded_at"]
            if d.get("llm_model"):
                row.llm_model = cut(d["llm_model"], 128)
            skills = std.get("skills_sentences", std.get("skills"))
            resps = std.get("responsibility_sentences", std.get("responsibilities"))
            if skills is not None:
                row.skills = clean_list(skills, 2000, unique_ci=False)[:20]
            if resps is not None:
                row.responsibilities = clean_list(resps, 2000, unique_ci=False)[:10]
            s.add(row)
            s.flush()
            if "required_languages" in std or "required_certifications" in std:
                s.execute(delete(JobRequirement).where(JobRequirement.job_description_id == jid))
                for kind, key in (("language", "required_languages"), ("certification", "required_certifications")):
                    seen = set()
                    for item in std.get(key) or []:
                        name = cut(item.get("name") if isinstance(item, dict) else item, 256)
                        if name and name.lower() not in seen:
                            seen.add(name.lower())
                            mandatory = item.get("mandatory", True) if isinstance(item, dict) else True
                            s.add(JobRequirement(job_description_id=jid, kind=kind, name=name, mandatory=bool(mandatory)))
            s.commit()
        return jid

    def _jd_lists(self, s: Session, ids: List[str]) -> Dict[str, Dict[str, Any]]:
        out = {i: {"skills": [], "responsibilities": [], "required_languages": [], "required_certifications": []} for i in ids}
        for part in chunks(ids):
            for jd in s.execute(select(JobDescription).where(JobDescription.id.in_(part))).scalars():
                out[jd.id]["skills"], out[jd.id]["responsibilities"] = list(jd.skills or []), list(jd.responsibilities or [])
            for r in s.execute(select(JobRequirement).where(JobRequirement.job_description_id.in_(part)).order_by(JobRequirement.name)).scalars():
                out[r.job_description_id]["required_languages" if r.kind == "language" else "required_certifications"].append(
                    {"name": r.name, "mandatory": r.mandatory})
        return out

    def get_structured_jd(self, jid: str) -> Optional[Dict[str, Any]]:
        """The job description as matching reads it."""
        with Session(self.engine) as s:
            jd = s.get(JobDescription, jid)
            if jd is None:
                return None
            lst = self._jd_lists(s, [jid])[jid]
            info = {"job_title": jd.job_title, "years_of_experience": fnum(jd.years_required), "category": jd.category,
                    "boolean_search_string": jd.boolean_search_string or "", **lst}
            return {
                "id": jid, "job_title": jd.job_title or "", "years_of_experience": fnum(jd.years_required) or 0, "category": jd.category,
                "skills_sentences": lst["skills"][:20], "responsibility_sentences": lst["responsibilities"][:10],
                "required_languages": lst["required_languages"], "required_certifications": lst["required_certifications"],
                "structured_info": info,
            }

    def jd_documents(self, ids: List[str]) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        with Session(self.engine) as s:
            for part in chunks([str(i) for i in ids]):
                for jd in s.execute(select(JobDescription).where(JobDescription.id.in_(part))).scalars():
                    out[jd.id] = {"raw_text": jd.raw_text, "filename": jd.original_filename, "file_path": jd.file_path,
                                  "mime_type": jd.mime_type, "upload_date": iso(jd.uploaded_at), "file_format": jd.file_format}
        return out

    def jd_document(self, jid: str) -> Optional[Dict[str, Any]]:
        return self.jd_documents([jid]).get(str(jid))

    def list_job_description_ids(self) -> List[str]:
        """The ids of every job description that is not deleted, newest first."""
        with Session(self.engine) as s:
            return list(s.execute(select(JobDescription.id).where(JobDescription.deleted_at.is_(None)).order_by(JobDescription.uploaded_at.desc())).scalars())

    def list_job_descriptions(self, *, q: Optional[str] = None, category: Optional[str] = None, offset: int = 0,
                              limit: int = 200) -> Tuple[List[Dict[str, Any]], int]:
        """One page of job descriptions, newest first, and how many match the filters."""
        from app.ingestion.skill_keywords import extract_skill_keywords

        conds = [JobDescription.deleted_at.is_(None)]
        if category:
            conds.append(JobDescription.category == category)
        if q and q.strip():
            needle = f"%{q.strip().lower()}%"
            conds.append(or_(func.lower(func.coalesce(JobDescription.job_title, "")).like(needle),
                             func.lower(func.coalesce(JobDescription.original_filename, "")).like(needle),
                             func.lower(JobDescription.id).like(needle)))
        with Session(self.engine) as s:
            total = int(s.execute(select(func.count()).select_from(JobDescription).where(*conds)).scalar() or 0)
            rows = list(s.execute(select(JobDescription).where(*conds).order_by(JobDescription.uploaded_at.desc(), JobDescription.id.desc())
                                  .offset(offset).limit(limit)).scalars())
            lists = self._jd_lists(s, [r.id for r in rows])
            out = []
            for r in rows:
                lst = lists[r.id]
                out.append({
                    "id": r.id, "filename": os.path.basename(r.original_filename or "") or "Unknown", "upload_date": iso(r.uploaded_at),
                    "job_title": r.job_title or "Not specified",
                    "years_of_experience": fnum(r.years_required) if r.years_required is not None else "Not specified",
                    "skill_keywords": extract_skill_keywords(lst["skills"], limit=20), "skills_count": len(lst["skills"]),
                    "responsibilities_count": len(lst["responsibilities"]), "has_structured_data": True, "category": r.category,
                })
            return out, total

    def jd_detail(self, jid: str) -> Optional[Dict[str, Any]]:
        with Session(self.engine) as s:
            jd = s.get(JobDescription, jid)
            if jd is None:
                return None
            lst = self._jd_lists(s, [jid])[jid]
            return {
                "id": jd.id, "filename": jd.original_filename, "upload_date": iso(jd.uploaded_at), "job_title": jd.job_title,
                "years_of_experience": fnum(jd.years_required), "category": jd.category, "skills": lst["skills"],
                "responsibilities": lst["responsibilities"], "boolean_search_string": jd.boolean_search_string or "",
                "required_languages": lst["required_languages"], "required_certifications": lst["required_certifications"],
                "llm_model": jd.llm_model, "embedding_model": jd.embedding_model,
            }

    def delete_job_description(self, jid: str) -> Optional[str]:
        """Remove a description and its vectors; the postings made from it stay (they keep their own text). Returns its filename, or None."""
        with Session(self.engine) as s:
            jd = s.get(JobDescription, jid)
            if jd is None:
                return None
            name = jd.original_filename or jid
            s.delete(jd)
            s.commit()
        try:
            self.vectors.delete("job_description", [jid])
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Deleted job description {jid} but could not remove its vectors: {exc}")
        return name

    # ================================================================== job postings
    def create_job_posting(self, d: Dict[str, Any]) -> str:
        pid = str(d.get("id") or uuid.uuid4())
        with Session(self.engine) as s:
            row = s.get(JobPosting, pid) or JobPosting(id=pid, public_token=d["public_token"])
            row.public_token = d["public_token"]
            row.job_description_id = d.get("job_description_id") or row.job_description_id
            for key, size in (("posted_by_user", 128), ("posted_by_role", 32), ("email_subject_id", 64),
                              ("email_subject_template", 512)):
                if d.get(key) is not None:
                    setattr(row, key, cut(d[key], size))
            s.add(row)
            s.commit()
        self._invalidate_posting_cache()
        return pid

    @staticmethod
    def _invalidate_posting_cache() -> None:
        try:
            from app.providers.cache.memory import get_cache_service

            get_cache_service().delete("job_titles", namespace="cv_data")
        except Exception:  # noqa: BLE001
            pass

    def update_job_posting(self, pid: str, fields: Dict[str, Any]) -> bool:
        """Change a posting. ``fields`` may hold is_active, public_token, job_title / job_location /
        job_summary / key_responsibilities / qualifications (the text candidates read), boolean_search_string."""
        text_cols = {"job_title": "display_title", "job_location": "job_location", "job_summary": "job_summary",
                     "key_responsibilities": "key_responsibilities", "qualifications": "qualifications"}
        with Session(self.engine) as s:
            row = s.get(JobPosting, pid)
            if row is None or row.deleted_at is not None:
                return False
            if "is_active" in fields:
                row.is_active = bool(fields["is_active"])
            if fields.get("public_token"):
                row.public_token = fields["public_token"]
            for key, column in text_cols.items():
                if key in fields:
                    setattr(row, column, fields[key])
            if "boolean_search_string" in fields:
                row.boolean_search_string = fields["boolean_search_string"] or None
            row.updated_at = datetime.utcnow()
            s.add(row)
            s.commit()
        self._invalidate_posting_cache()
        return True

    def _posting_views(self, s: Session, postings: List[JobPosting], with_counts: bool = False) -> List[Dict[str, Any]]:
        jd_ids = [p.job_description_id for p in postings if p.job_description_id]
        jds = {j.id: j for part in chunks(jd_ids) for j in s.execute(select(JobDescription).where(JobDescription.id.in_(part))).scalars()}
        lists = self._jd_lists(s, list(jds))
        counts: Dict[str, int] = {}
        if with_counts:
            for part in chunks([p.id for p in postings]):
                counts.update({pid: int(n) for pid, n in s.execute(
                    select(JobApplication.job_posting_id, func.count()).where(JobApplication.job_posting_id.in_(part))
                    .group_by(JobApplication.job_posting_id))})
        views = []
        for p in postings:
            jd = jds.get(p.job_description_id)
            lst = lists.get(p.job_description_id, {"skills": [], "responsibilities": [], "required_languages": [], "required_certifications": []})
            quals = p.qualifications if p.qualifications else bullets(lst["skills"])
            resp = p.key_responsibilities if p.key_responsibilities else bullets(lst["responsibilities"])
            views.append({
                "id": p.id, "jd_id": p.job_description_id, "public_token": p.public_token, "is_active": p.is_active,
                "posted_by_user": p.posted_by_user, "posted_by_role": p.posted_by_role,
                "email_subject_id": p.email_subject_id, "email_subject_template": p.email_subject_template,
                "boolean_search_string": p.boolean_search_string or (jd.boolean_search_string if jd else "") or "",
                "created_date": iso(p.created_at), "upload_date": iso(p.created_at),
                "filename": (jd.original_filename if jd and jd.original_filename else f"job_posting_{p.id}.txt"),
                "job_title": p.display_title or (jd.job_title if jd else None) or "Position Available",
                "job_location": p.job_location or "", "job_summary": p.job_summary or "",
                "key_responsibilities": resp, "qualifications": quals,
                "responsibilities": lines_of(resp), "skills": lines_of(quals),
                "has_posting_text": bool(p.display_title or p.job_summary or p.key_responsibilities or p.qualifications),
                "years_of_experience": fnum(jd.years_required) if jd and jd.years_required is not None else None,
                "category": jd.category if jd else None, "has_description": jd is not None,
                "application_count": counts.get(p.id, 0),
            })
        return views

    def get_job_posting_by_id(self, pid: str) -> Optional[Dict[str, Any]]:
        with Session(self.engine) as s:
            p = s.get(JobPosting, pid)
            if p is None or p.deleted_at is not None:
                return None
            return self._posting_views(s, [p])[0]

    def get_job_posting_by_token(self, token: str, include_inactive: bool = False) -> Optional[Dict[str, Any]]:
        """The public job: the description's content with whatever was edited on the posting on top. None if unknown, deleted, or (unless
        ``include_inactive``) closed, or when it has neither a description nor its own text."""
        with Session(self.engine) as s:
            q = select(JobPosting).where(JobPosting.public_token == token, JobPosting.deleted_at.is_(None))
            if not include_inactive:
                q = q.where(JobPosting.is_active.is_(True))
            p = s.execute(q).scalars().first()
            if p is None:
                return None
            view = self._posting_views(s, [p])[0]
            if not view["has_description"] and not view["has_posting_text"]:
                return None
            return view

    @staticmethod
    def _posting_conditions(q: Optional[str], posted_by: Optional[str], not_posted_by: Optional[str]) -> list:
        """The conditions that choose postings by who posted them and by the words typed (not by open / closed)."""
        conds = [JobPosting.deleted_at.is_(None)]
        if posted_by:
            conds.append(JobPosting.posted_by_user == posted_by)
        if not_posted_by:
            conds.append(or_(JobPosting.posted_by_user.is_(None), JobPosting.posted_by_user != not_posted_by))
        if q and q.strip():
            needle = f"%{q.strip().lower()}%"
            conds.append(or_(func.lower(func.coalesce(JobPosting.display_title, "")).like(needle),
                             func.lower(func.coalesce(JobDescription.job_title, "")).like(needle),
                             func.lower(func.coalesce(JobPosting.posted_by_user, "")).like(needle),
                             func.lower(func.coalesce(JobPosting.email_subject_template, "")).like(needle),
                             func.lower(JobPosting.id).like(needle)))
        return conds

    def list_job_postings(self, *, include_inactive: bool = False, offset: int = 0, limit: Optional[int] = None, q: Optional[str] = None,
                          posted_by: Optional[str] = None, not_posted_by: Optional[str] = None,
                          status: Optional[str] = None) -> Tuple[List[Dict[str, Any]], int]:
        """Postings (not deleted), newest first, with their application counts, and how many match in total. The database filters:
        ``q`` (title, poster, e-mail subject or id), ``posted_by`` / ``not_posted_by`` (a username), ``status`` active | inactive | all."""
        conds = self._posting_conditions(q, posted_by, not_posted_by)
        if status == "active" or (status in (None, "") and not include_inactive):
            conds.append(JobPosting.is_active.is_(True))
        elif status == "inactive":
            conds.append(JobPosting.is_active.is_(False))
        joined = select(JobPosting).outerjoin(JobDescription, JobDescription.id == JobPosting.job_description_id)
        with Session(self.engine) as s:
            total = int(s.execute(select(func.count()).select_from(JobPosting).outerjoin(
                JobDescription, JobDescription.id == JobPosting.job_description_id).where(*conds)).scalar() or 0)
            page = joined.where(*conds).order_by(JobPosting.created_at.desc(), JobPosting.id.desc()).offset(max(0, offset))
            if limit:
                page = page.limit(limit)
            return self._posting_views(s, list(s.execute(page).scalars()), with_counts=True), total

    def list_public_postings(self, *, q: Optional[str] = None, skills: Optional[Sequence[str]] = None, region: Optional[str] = None,
                             areas: Optional[Sequence[str]] = None, offset: int = 0, limit: int = 12) -> Tuple[List[Dict[str, Any]], int]:
        """The open postings a visitor of the public careers page can see, newest first, one page and the total. The database does the
        searching: ``q`` in the title or location, every one of ``skills`` somewhere in the posting or its description, ``region``
        (UAE | KSA | Remote | Not specified, decided from the location text) and ``areas`` (any of these words in the location)."""
        location = func.lower(func.coalesce(JobPosting.job_location, ""))
        has = lambda words: or_(*[location.like(f"%{w}%") for w in words])
        conds = [JobPosting.deleted_at.is_(None), JobPosting.is_active.is_(True)]
        if q and q.strip():
            needle = f"%{q.strip().lower()}%"
            conds.append(or_(func.lower(func.coalesce(JobPosting.display_title, "")).like(needle),
                             func.lower(func.coalesce(JobDescription.job_title, "")).like(needle), location.like(needle)))
        for skill in [t.strip().lower()[:64] for t in (skills or []) if t and t.strip()][:10]:
            needle = f"%{skill}%"
            conds.append(or_(*[func.lower(func.coalesce(col, "")).like(needle) for col in (
                JobPosting.display_title, JobPosting.job_summary, JobPosting.qualifications, JobPosting.key_responsibilities, JobPosting.job_location,
                JobDescription.job_title, JobDescription.raw_text, cast(JobDescription.skills, Text), cast(JobDescription.responsibilities, Text))]))
        remote, ksa, uae = has(REMOTE_WORDS), has(KSA_WORDS), has(UAE_WORDS)
        if region == "Remote":
            conds.append(remote)
        elif region == "KSA":
            conds.append(and_(not_(remote), ksa))
        elif region == "UAE":
            conds.append(and_(not_(remote), not_(ksa), uae))
        elif region == "Not specified":
            conds.append(and_(not_(remote), not_(ksa), not_(uae)))
        wanted = [a.strip().lower() for a in (areas or []) if a and a.strip()][:30]
        if wanted:
            conds.append(or_(*[location.like(f"%{a}%") for a in wanted]))
        joined = select(JobPosting).outerjoin(JobDescription, JobDescription.id == JobPosting.job_description_id)
        with Session(self.engine) as s:
            total = int(s.execute(select(func.count()).select_from(JobPosting).outerjoin(
                JobDescription, JobDescription.id == JobPosting.job_description_id).where(*conds)).scalar() or 0)
            page = joined.where(*conds).order_by(JobPosting.created_at.desc(), JobPosting.id.desc()).offset(max(0, offset)).limit(max(1, limit))
            return self._posting_views(s, list(s.execute(page).scalars())), total

    def posting_status_counts(self, *, q: Optional[str] = None, posted_by: Optional[str] = None, not_posted_by: Optional[str] = None) -> Dict[str, int]:
        """{all, active, inactive}: how many postings match the search and the owner filter, whether open or closed (the tabs' numbers)."""
        conds = self._posting_conditions(q, posted_by, not_posted_by)
        with Session(self.engine) as s:
            rows = s.execute(select(JobPosting.is_active, func.count()).select_from(JobPosting).outerjoin(
                JobDescription, JobDescription.id == JobPosting.job_description_id).where(*conds).group_by(JobPosting.is_active))
            counts = {bool(active): int(n) for active, n in rows}
        return {"all": sum(counts.values()), "active": counts.get(True, 0), "inactive": counts.get(False, 0)}

    def postings_between(self, start: datetime, end: datetime) -> List[Dict[str, Any]]:
        """The postings created from ``start`` up to (not including) ``end`` with their poster, title and application count: one query,
        no description or candidate data (the weekly report)."""
        with Session(self.engine) as s:
            count = select(func.count()).select_from(JobApplication).where(JobApplication.job_posting_id == JobPosting.id).scalar_subquery()
            q = (select(JobPosting.id, JobPosting.posted_by_user, JobPosting.display_title, JobDescription.job_title, count)
                 .outerjoin(JobDescription, JobDescription.id == JobPosting.job_description_id)
                 .where(JobPosting.deleted_at.is_(None), JobPosting.created_at >= start, JobPosting.created_at < end)
                 .order_by(JobPosting.created_at))
            return [{"id": pid, "posted_by_user": user, "job_title": title or jd_title or "Position Available", "application_count": int(n)}
                    for pid, user, title, jd_title, n in s.execute(q)]

    def soft_delete_job_posting(self, pid: str, deleted_by: str) -> Dict[str, Any]:
        """Close the posting for good: it disappears from every list, its description is hidden from the library, and its applications are
        archived (kept, with a status that says why)."""
        with Session(self.engine) as s:
            p = s.get(JobPosting, pid)
            if p is None or p.deleted_at is not None:
                return {"success": False, "error": f"Job posting {pid} not found or already deleted"}
            now = datetime.utcnow()
            p.deleted_at, p.deleted_by, p.is_active = now, cut(deleted_by, 128), False
            jd_hidden = 0
            if p.job_description_id:
                jd = s.get(JobDescription, p.job_description_id)
                if jd is not None and jd.deleted_at is None:
                    jd.deleted_at, jd.deleted_by = now, cut(deleted_by, 128)
                    jd_hidden = 1
            archived = s.execute(update(JobApplication).where(JobApplication.job_posting_id == pid).values(status="archived_job_deleted")).rowcount
            s.commit()
        self._invalidate_posting_cache()
        return {"success": True, "job_posting_deleted": True, "jd_hidden": jd_hidden, "applications_archived": int(archived or 0)}

    def next_email_subject_counter(self, abbreviation: str, year: int) -> int:
        """The next running number for ``ABBR-YEAR-nnn`` subject ids (atomic: two postings made at once never get the same one)."""
        abbreviation = (abbreviation or "JOB")[:16]
        for attempt in range(5):
            try:
                with Session(self.engine) as s:
                    row = s.execute(select(EmailSubjectCounter).where(
                        EmailSubjectCounter.abbreviation == abbreviation, EmailSubjectCounter.year == year).with_for_update()).scalars().first()
                    if row is None:
                        row = EmailSubjectCounter(abbreviation=abbreviation, year=year, counter=0)
                        s.add(row)
                    row.counter += 1
                    value = row.counter
                    s.commit()
                    return int(value)
            except IntegrityError:        # another request created the row first: take the next number from it
                continue
        raise RuntimeError("could not allocate an e-mail subject number")

    # ================================================================== applications
    def link_application(self, posting_id: str, candidate_id: str, data: Dict[str, Any]) -> bool:
        """Record that a candidate applied to a posting (one application per pair; applying again updates it)."""
        with Session(self.engine) as s:
            if s.get(JobPosting, posting_id) is None or s.get(Candidate, candidate_id) is None:
                return False
            row = s.get(JobApplication, (posting_id, candidate_id)) or JobApplication(job_posting_id=posting_id, candidate_id=candidate_id)
            if data.get("source"):
                row.source = data["source"]
            if data.get("applied_at"):
                row.applied_at = data["applied_at"]
            s.add(row)
            s.commit()
            count = int(s.execute(select(func.count()).select_from(JobApplication).where(JobApplication.job_posting_id == posting_id)).scalar() or 0)
        if count >= AUTO_CLOSE_AT:
            self.update_job_posting(posting_id, {"is_active": False})
            logger.info(f"Job {posting_id} closed (applications reached {count})")
        self._invalidate_posting_cache()
        return True

    def check_existing_application(self, email: str, posting_id: str) -> Optional[Dict[str, Any]]:
        """The earlier application of this e-mail address (case-insensitive) to this posting, if any."""
        email = (email or "").strip().lower()
        if not email:
            return None
        with Session(self.engine) as s:
            q = (select(JobApplication, Candidate.original_filename).join(Candidate, Candidate.id == JobApplication.candidate_id)
                 .where(JobApplication.job_posting_id == posting_id, func.lower(Candidate.email) == email).limit(1))
            hit = s.execute(q).first()
            if hit is None:
                return None
            app, filename = hit
            return {"id": app.candidate_id, "applicant_email": email, "job_posting_id": posting_id, "application_date": iso(app.applied_at),
                    "cv_filename": filename, "status": app.status}

    def application_count(self, posting_id: str) -> int:
        with Session(self.engine) as s:
            return int(s.execute(select(func.count()).select_from(JobApplication).where(JobApplication.job_posting_id == posting_id)).scalar() or 0)

    def applications_for_job(self, posting_id: str, limit: int = 1000, offset: int = 0) -> List[Dict[str, Any]]:
        """The applications to a posting (newest first, at most ``limit`` from ``offset``) with the candidate's details and notes; those with
        notes come first on the page, latest note first."""
        with Session(self.engine) as s:
            rows = list(s.execute(select(JobApplication, Candidate).join(Candidate, Candidate.id == JobApplication.candidate_id)
                                  .where(JobApplication.job_posting_id == posting_id)
                                  .order_by(JobApplication.applied_at.desc(), JobApplication.candidate_id).offset(max(0, offset)).limit(max(1, limit))))
            notes = self._notes_of(s, [c.id for _a, c in rows])
            out = []
            for app, c in rows:
                n = notes.get(c.id, [])
                latest = max(n, key=lambda x: x.get("updated_at") or x.get("created_at") or "") if n else None
                out.append({
                    "id": c.id, "applicant_name": c.full_name, "applicant_email": c.email, "applicant_phone": c.phone,
                    "linkedin_url": c.linkedin_url, "github_url": c.github_url, "application_date": iso(app.applied_at),
                    "cv_filename": c.original_filename, "expected_salary": fnum(c.expected_salary),
                    "years_of_experience": fnum(c.years_of_experience), "location": c.location, "notice_period": c.notice_period,
                    "nationality": c.nationality, "status": app.status, "source": app.source,
                    "notes": n, "notes_count": len(n), "has_notes": bool(n), "latest_note": latest,
                    "latest_note_text": latest["note"] if latest else "", "latest_note_author": latest["hr_user"] if latest else "",
                    "latest_note_date": (latest.get("updated_at") or latest.get("created_at") or "") if latest else "",
                })
        out.sort(key=lambda x: (not x["has_notes"], x["latest_note_date"] if x["has_notes"] else (x["application_date"] or "")), reverse=True)
        return out

    def careers_overview(self, *, days: int = 14, months: int = 6, top: int = 5, recent: int = 6) -> Dict[str, Any]:
        """The numbers behind the dashboard, all counted by the database over every posting (not a page of them):
        postings live / closed, applications in total and per day for the last ``days`` days, postings per month for the last
        ``months`` months, the ``top`` postings by applicants and the ``recent`` newest postings. Counts and titles only."""
        today = datetime.utcnow().date()
        day_labels = [today - timedelta(days=days - 1 - i) for i in range(days)]
        start = today.year * 12 + today.month - 1 - (months - 1)       # whole months, counted back from this one
        month_labels: List[Tuple[int, int]] = [(n // 12, n % 12 + 1) for n in range(start, start + months)]
        live = JobPosting.deleted_at.is_(None)
        with Session(self.engine) as s:
            by_state = {bool(active): int(n) for active, n in s.execute(
                select(JobPosting.is_active, func.count()).where(live).group_by(JobPosting.is_active))}
            applications = select(func.count()).select_from(JobApplication).join(JobPosting, JobPosting.id == JobApplication.job_posting_id).where(live)
            total_applications = int(s.execute(applications).scalar() or 0)
            day = func.date(JobApplication.applied_at)
            per_day = {str(d): int(n) for d, n in s.execute(
                select(day, func.count()).select_from(JobApplication).join(JobPosting, JobPosting.id == JobApplication.job_posting_id)
                .where(live, JobApplication.applied_at >= datetime.combine(day_labels[0], datetime.min.time())).group_by(day))}
            year, month = func.extract("year", JobPosting.created_at), func.extract("month", JobPosting.created_at)
            per_month = {(int(a), int(b)): int(n) for a, b, n in s.execute(
                select(year, month, func.count()).where(live, JobPosting.created_at >= datetime.combine(
                    datetime(month_labels[0][0], month_labels[0][1], 1), datetime.min.time())).group_by(year, month))}
            applicants = func.count(JobApplication.candidate_id)
            top_rows = s.execute(
                select(JobPosting.id, JobPosting.display_title, JobDescription.job_title, JobPosting.posted_by_user, JobPosting.is_active,
                       JobPosting.created_at, applicants)
                .select_from(JobPosting).outerjoin(JobDescription, JobDescription.id == JobPosting.job_description_id)
                .outerjoin(JobApplication, JobApplication.job_posting_id == JobPosting.id).where(live)
                .group_by(JobPosting.id, JobDescription.id).order_by(applicants.desc(), JobPosting.created_at.desc()).limit(top)).all()
            newest, _total = self.list_job_postings(include_inactive=True, offset=0, limit=recent)
        series = [per_day.get(d.isoformat(), 0) for d in day_labels]
        return {
            "postings": {"total": sum(by_state.values()), "live": by_state.get(True, 0), "closed": by_state.get(False, 0)},
            "applications": {
                "total": total_applications, "days": [d.isoformat() for d in day_labels], "series": series,
                "last_7_days": sum(series[-7:]), "previous_7_days": sum(series[-14:-7]) if days >= 14 else 0,
            },
            "months": [{"key": f"{y}-{m:02d}", "label": datetime(y, m, 1).strftime("%b"), "count": per_month.get((y, m), 0)} for y, m in month_labels],
            "top_jobs": [{"job_id": pid, "job_title": title or jd_title or "Position Available", "posted_by_user": user, "is_active": bool(active),
                          "upload_date": iso(created), "application_count": int(n)} for pid, title, jd_title, user, active, created, n in top_rows],
            "recent_jobs": [{"job_id": v["id"], "job_title": v["job_title"], "job_location": v["job_location"], "posted_by_user": v["posted_by_user"],
                             "is_active": v["is_active"], "upload_date": v["upload_date"], "application_count": v["application_count"]} for v in newest],
        }

    def application_counts_by_day(self, since: datetime) -> List[Tuple[str, str, int]]:
        """(posting id, 'YYYY-MM-DD', applications) for applications received since ``since``."""
        with Session(self.engine) as s:
            day = func.date(JobApplication.applied_at)
            q = select(JobApplication.job_posting_id, day, func.count()).where(JobApplication.applied_at >= since).group_by(
                JobApplication.job_posting_id, day)
            return [(pid, str(d), int(n)) for pid, d, n in s.execute(q)]
