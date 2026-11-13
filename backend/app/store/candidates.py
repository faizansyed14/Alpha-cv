"""Candidates (CVs): everything read from and written to PostgreSQL. Vectors are the vector store's business (app/store/vectors.py)."""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import and_, exists, func, literal, literal_column, not_, or_, select, update
from sqlmodel import Session

from app.ingestion import boolean_query as bq
from app.ingestion.categories import normalize_category
from app.ingestion.profile_links import normalize_github, normalize_linkedin
from app.ingestion.search_index import FTS_CONFIG, build_search_documents, experience_years, matched_terms, normalize
from app.models.talent import Candidate, CandidateNote, CandidateSearch, JobApplication, JobDescription, JobPosting
from app.store import arrays

logger = logging.getLogger(__name__)

CHUNK = 400   # ids per IN (...) query, below SQLite's limit of 999 variables
COUNT_CAP = 100_000   # a search counts its matches only up to this many ("100,000+"): counting millions of matches would cost more than the search

FACT_COLUMNS = {"full_name": 256, "email": 320, "phone": 64, "linkedin_url": 512, "github_url": 512, "gender": 16, "location": 256,
                "nationality": 128, "notice_period": 64, "job_title": 256}
FACET_COLUMNS = {"location": Candidate.location, "nationality": Candidate.nationality, "notice_period": Candidate.notice_period}
FACET_FIELDS = ("location", "nationality", "notice_period", "keywords", "languages")


def cut(value: Any, size: int) -> Optional[str]:
    text = " ".join(str(value).split()) if value is not None else ""
    return text[:size] if text else None


def number(value: Any, maximum: float = 1e9) -> Optional[Decimal]:
    try:
        if value is None or isinstance(value, bool) or str(value).strip() == "":
            return None
        n = float(re.sub(r"[^\d.\-]", "", str(value))) if not isinstance(value, (int, float)) else float(value)
        return Decimal(str(round(n, 2))) if 0 <= n <= maximum else None
    except (ValueError, TypeError, ArithmeticError):
        return None


def years(value: Any) -> Optional[Decimal]:
    y = experience_years(value)
    return Decimal(str(round(y, 1))) if y is not None else None


def fnum(value: Any) -> Optional[float]:
    return float(value) if value is not None else None


def iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def chunks(items: Sequence[Any], size: int = CHUNK):
    for i in range(0, len(items), size):
        yield list(items[i:i + size])


def clean_list(values: Iterable[Any], size: int, unique_ci: bool = True) -> List[str]:
    out: List[str] = []
    seen = set()
    for v in values or []:
        text = cut(v, size)
        if not text:
            continue
        key = text.lower()
        if unique_ci and key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


COUNTS_KEY, COUNTS_NS = "category_counts", "cv_data"
COUNTS_TTL_SECONDS = 60   # only a safety net: every save and delete forgets the counts at once


def forget_cached_counts() -> None:
    """The exact number of candidates per category is kept in Redis, shared by every process (API workers, the background worker); a
    saved or deleted candidate makes it stale at once, for all of them."""
    try:
        from app.providers.cache.redis import get_redis_cache

        get_redis_cache().delete(COUNTS_KEY, namespace=COUNTS_NS)
    except Exception:  # noqa: BLE001 - a cache is never a reason to fail a save
        pass


class BadCursor(ValueError):
    """The ``cursor`` of a list call is not one this API handed out."""


def page_cursor(uploaded_at: datetime, cid: str) -> str:
    """Where a page ended: the upload time and id of its last row. The next page starts right after it."""
    return f"{uploaded_at.isoformat()}|{cid}"


def parse_page_cursor(cursor: Optional[str]) -> Optional[Tuple[datetime, str]]:
    if not cursor:
        return None
    ts, sep, last_id = str(cursor).partition("|")
    try:
        when = datetime.fromisoformat(ts)
    except ValueError as exc:
        raise BadCursor("unreadable cursor") from exc
    if not sep or not last_id or len(last_id) > 64:
        raise BadCursor("unreadable cursor")
    return when, last_id


def older_than(after: Tuple[datetime, str]):
    """Rows that come after ``after`` in the newest-first order. The first test repeats what the second implies on purpose: it is the part
    PostgreSQL can use to START the index scan at that row, so page 5,000 costs the same as page 1 (an OFFSET walks past every skipped row)."""
    when, last_id = after
    return and_(Candidate.uploaded_at <= when,
                or_(Candidate.uploaded_at < when, and_(Candidate.uploaded_at == when, Candidate.id < last_id)))


class CandidateStore:
    engine: Any

    # ------------------------------------------------------------------ writing
    def save_candidate(self, d: Dict[str, Any]) -> str:
        """Create or replace one candidate and all its lists. ``d``: id, content_sha256, filename, file_format, mime_type, file_path, source,
        raw_text, facts {full_name, email, phone, ..., job_title, years_of_experience, category, expected_salary}, skills, responsibilities,
        keywords, languages, certifications, llm_model, extraction_ms, uploaded_at (optional). A fact that is empty never overwrites one."""
        cid = str(d["id"])
        facts = d.get("facts") or {}
        with Session(self.engine) as s:
            row = s.get(Candidate, cid)
            if row is None:
                row = Candidate(id=cid, content_sha256=d["content_sha256"], original_filename=cut(d.get("filename"), 512) or cid)
            row.content_sha256 = d.get("content_sha256") or row.content_sha256
            row.original_filename = cut(d.get("filename"), 512) or row.original_filename
            for key, size in (("file_format", 16), ("mime_type", 128)):
                if d.get(key):
                    setattr(row, key, cut(d[key], size))
            if d.get("file_path"):
                row.file_path = str(d["file_path"])
            row.source = d.get("source") or row.source or "upload"
            if d.get("raw_text") is not None:
                row.raw_text = d["raw_text"]
            for column, size in FACT_COLUMNS.items():
                if facts.get(column) not in (None, ""):
                    setattr(row, column, cut(facts[column], size))
            if row.email:
                row.email = row.email.lower()
            # a profile link is shown as a clickable link: only a clean https link to the person's own profile is kept
            for link, clean in (("linkedin_url", normalize_linkedin), ("github_url", normalize_github)):
                if facts.get(link) not in (None, ""):
                    setattr(row, link, clean(facts[link]))
            if facts.get("category"):
                row.category = normalize_category(facts["category"])
            elif not row.category:
                row.category = "Other"
            if facts.get("expected_salary") not in (None, ""):
                row.expected_salary = number(facts["expected_salary"], 1e10)
            if facts.get("years_of_experience") not in (None, ""):
                row.years_of_experience = years(facts["years_of_experience"])
            if d.get("uploaded_at"):
                row.uploaded_at = d["uploaded_at"]
            for key in ("llm_model", "extraction_ms"):
                if d.get(key) is not None:
                    setattr(row, key, cut(d[key], 128) if key == "llm_model" else int(d[key]))
            self._set_lists(row, d)
            s.add(row)
            s.flush()
            self._rebuild_search(s, cid)
            s.commit()
        forget_cached_counts()
        return cid

    @staticmethod
    def _set_lists(row: Candidate, d: Dict[str, Any]) -> None:
        """Replace the array columns that ``d`` names (a list that is absent from ``d`` is left as it is)."""
        for key, size, limit, unique in (("skills", 2000, 20, False), ("responsibilities", 2000, 10, False),
                                         ("keywords", 128, 20, True), ("languages", 64, 20, True), ("certifications", 256, 20, True)):
            if key in d:
                setattr(row, key, clean_list(d[key], size, unique_ci=unique)[:limit])

    def _rebuild_search(self, s: Session, cid: str) -> None:
        """Rewrite the candidate's search text from what is stored now (the derived table, see models/talent.py)."""
        c = s.get(Candidate, cid)
        if c is None:
            return

        person = {
            "full_name": c.full_name, "job_title": c.job_title, "category": c.category, "email": c.email, "phone": c.phone,
            "location": c.location, "nationality": c.nationality, "notice_period": c.notice_period,
            "keywords": c.keywords, "languages": c.languages, "certifications": c.certifications, "skills": c.skills,
            "responsibilities": c.responsibilities,
        }
        docs = build_search_documents(person, c.raw_text)
        row = s.get(CandidateSearch, cid) or CandidateSearch(candidate_id=cid)
        if self._fts:
            # PostgreSQL keeps only the tsvectors (below); the plain copies of the text are what SQLite searches
            row.text = row.literal = ""
        else:
            row.text, row.literal = docs["text"], docs["literal"]
        row.location, row.nationality = docs["location"], docs["nationality"]
        s.add(row)
        if self._fts:
            s.flush()
            simple = literal_column("'simple'::regconfig")                 # names and places: exactly as written
            words = literal_column(f"'{FTS_CONFIG}'::regconfig")           # the CV's words: their other forms count too
            s.execute(update(CandidateSearch).where(CandidateSearch.candidate_id == cid).values(
                literal_tsv=func.to_tsvector(words, docs["literal"]), extra_tsv=func.to_tsvector(words, docs["extra"]),
                location_tsv=func.to_tsvector(simple, docs["location"]), nationality_tsv=func.to_tsvector(simple, docs["nationality"])))

    def merge_candidate_facts(self, cid: str, facts: Dict[str, Any]) -> bool:
        """Join new details into an existing candidate (empty values never overwrite)."""
        with Session(self.engine) as s:
            if s.get(Candidate, cid) is None:
                return False
        self.save_candidate({"id": cid, "facts": facts})
        return True

    def mark_embedded(self, kind_id: str, model: str, kind: str = "candidate") -> None:
        model_cls = Candidate if kind == "candidate" else JobDescription
        with Session(self.engine) as s:
            row = s.get(model_cls, kind_id)
            if row is not None:
                row.embedding_model, row.embedded_at = cut(model, 128), datetime.utcnow()
                s.commit()

    def delete_candidate(self, cid: str) -> Optional[Dict[str, Any]]:
        """Remove the candidate (its lists, notes, search text and applications go with it) and its vectors. Returns what the caller
        needs to remove the stored file, or None if there was no such candidate."""
        with Session(self.engine) as s:
            row = s.get(Candidate, cid)
            if row is None:
                return None
            info = {"filename": row.original_filename, "file_path": row.file_path, "file_format": row.file_format}
            s.delete(row)
            s.commit()
        forget_cached_counts()
        try:
            self.vectors.delete("candidate", [cid])
        except Exception as exc:  # noqa: BLE001 - the row is gone; a stray vector point is harmless and is reported
            logger.warning(f"Deleted candidate {cid} but could not remove its vectors: {exc}")
        return info

    # ------------------------------------------------------------------ reading one / a batch
    def find_candidate_by_hash(self, sha: str) -> Optional[Dict[str, Any]]:
        with Session(self.engine) as s:
            row = s.execute(select(Candidate.id, Candidate.source).where(Candidate.content_sha256 == sha)).first()
            if row is None:
                return None
            jobs = list(s.execute(select(JobApplication.job_posting_id).where(JobApplication.candidate_id == row.id)).scalars())
            return {"id": row.id, "source": row.source, "job_posting_ids": jobs}

    def candidate_exists(self, cid: str) -> bool:
        with Session(self.engine) as s:
            return s.get(Candidate, cid) is not None

    LIST_KEYS = ("skills", "responsibilities", "keywords", "languages", "certifications")

    def _lists(self, s: Session, ids: List[str]) -> Dict[str, Dict[str, List[str]]]:
        """The array columns of each candidate (rows already loaded in this session are not read again)."""
        out: Dict[str, Dict[str, List[str]]] = {}
        for part in chunks(ids):
            for c in s.execute(select(Candidate).where(Candidate.id.in_(part))).scalars():
                out[c.id] = {k: list(getattr(c, k) or []) for k in self.LIST_KEYS}
        return {i: out.get(i, {k: [] for k in self.LIST_KEYS}) for i in ids}

    def get_structured_cvs_batch(self, ids: List[str]) -> List[Dict[str, Any]]:
        """The CV as matching reads it, for many ids at once (in the order asked; missing ids are skipped)."""
        ids = [str(i) for i in ids]
        if not ids:
            return []
        with Session(self.engine) as s:
            rows = {}
            for part in chunks(ids):
                for c in s.execute(select(Candidate).where(Candidate.id.in_(part))).scalars():
                    rows[c.id] = c
            lists = self._lists(s, [i for i in ids if i in rows])
            out = []
            for i in ids:
                c = rows.get(i)
                if c is None:
                    continue
                lst = lists[i]
                out.append({
                    "id": c.id, "name": c.full_name or c.id, "job_title": c.job_title or "",
                    "years_of_experience": fnum(c.years_of_experience) or 0, "category": c.category,
                    "skills_sentences": lst["skills"][:20], "responsibility_sentences": lst["responsibilities"][:10],
                    "expected_salary": fnum(c.expected_salary), "email": c.email or "", "phone": c.phone or "",
                    "linkedin_url": c.linkedin_url, "github_url": c.github_url,
                    "languages": lst["languages"], "certifications": lst["certifications"],
                })
            return out

    def get_structured_cv(self, cid: str) -> Optional[Dict[str, Any]]:
        got = self.get_structured_cvs_batch([cid])
        return got[0] if got else None

    def candidate_documents(self, ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """{id: {raw_text, filename, file_path, mime_type, upload_date}} (for previews, downloads and the LLM review)."""
        out: Dict[str, Dict[str, Any]] = {}
        with Session(self.engine) as s:
            for part in chunks([str(i) for i in ids]):
                for c in s.execute(select(Candidate).where(Candidate.id.in_(part))).scalars():
                    out[c.id] = {"raw_text": c.raw_text, "filename": c.original_filename, "file_path": c.file_path,
                                 "mime_type": c.mime_type, "upload_date": iso(c.uploaded_at), "file_format": c.file_format,
                                 "full_name": c.full_name, "source": c.source}
        return out

    def candidate_document(self, cid: str) -> Optional[Dict[str, Any]]:
        return self.candidate_documents([cid]).get(str(cid))

    # ------------------------------------------------------------------ list rows (the Candidates page)
    def _applications_of(self, s: Session, ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """The latest application of each candidate: {candidate_id: {job_posting_id, title}}."""
        latest: Dict[str, Any] = {}
        for part in chunks(ids):
            q = (select(JobApplication, JobPosting.display_title, JobDescription.job_title)
                 .join(JobPosting, JobPosting.id == JobApplication.job_posting_id)
                 .outerjoin(JobDescription, JobDescription.id == JobPosting.job_description_id)
                 .where(JobApplication.candidate_id.in_(part)).order_by(JobApplication.applied_at.desc()))
            for app, display_title, jd_title in s.execute(q):
                latest.setdefault(app.candidate_id, (app, display_title or jd_title or ""))
        return {cid: {"job_posting_id": a.job_posting_id, "title": title} for cid, (a, title) in latest.items()}

    def candidate_rows(self, ids: List[str]) -> List[Dict[str, Any]]:
        """One row per id, in the order asked, as the Candidates list shows it."""
        ids = [str(i) for i in ids]
        if not ids:
            return []
        with Session(self.engine) as s:
            rows = {}
            for part in chunks(ids):
                for c in s.execute(select(Candidate).where(Candidate.id.in_(part))).scalars():
                    rows[c.id] = c
            present = [i for i in ids if i in rows]
            lists = self._lists(s, present)
            apps = self._applications_of(s, present)
            out = []
            for i in present:
                c, lst, app = rows[i], lists[i], apps.get(i)
                row = {
                    "id": c.id, "filename": os.path.basename(c.original_filename or "") or "Unknown", "upload_date": iso(c.uploaded_at),
                    "full_name": c.full_name or "Not specified", "job_title": c.job_title or "Not specified",
                    "years_of_experience": fnum(c.years_of_experience) if c.years_of_experience is not None else "Not specified",
                    "skills_count": len(lst["skills"]), "skills": lst["skills"][:20], "skill_keywords": lst["keywords"][:20],
                    "responsibilities_count": len(lst["responsibilities"]), "has_structured_data": True, "category": c.category,
                    "is_job_application": app is not None,
                    "applied_job_id": app["job_posting_id"] if app else None,
                    "applied_job_title": (app["title"] or None) if app else None,
                    "location": c.location, "notice_period": c.notice_period, "nationality": c.nationality, "gender": c.gender,
                    "languages": lst["languages"][:20], "certifications": lst["certifications"][:20],
                    "email": c.email, "phone": c.phone, "linkedin_url": c.linkedin_url, "github_url": c.github_url,
                    "job_application": {"expected_salary": fnum(c.expected_salary)} if app else None,
                }
                out.append(row)
            return out

    def candidate_detail(self, cid: str) -> Optional[Dict[str, Any]]:
        """Everything the candidate page shows (without the vectors' info, which the caller adds from the vector store)."""
        with Session(self.engine) as s:
            c = s.get(Candidate, cid)
            if c is None:
                return None
            lst = self._lists(s, [cid])[cid]
            notes = self._notes_of(s, [cid]).get(cid, [])
            app_rows = list(s.execute(select(JobApplication).where(JobApplication.candidate_id == cid).order_by(JobApplication.applied_at.desc())).scalars())
            applications = [{
                "job_id": a.job_posting_id, "application_date": iso(a.applied_at), "application_status": a.status,
                "source": a.source,
            } for a in app_rows]
            return {
                "id": c.id, "filename": c.original_filename, "upload_date": iso(c.uploaded_at), "file_format": c.file_format, "source": c.source,
                "full_name": c.full_name, "email": c.email, "phone": c.phone, "linkedin_url": c.linkedin_url, "github_url": c.github_url,
                "gender": c.gender, "location": c.location, "nationality": c.nationality, "notice_period": c.notice_period,
                "expected_salary": fnum(c.expected_salary), "job_title": c.job_title, "years_of_experience": fnum(c.years_of_experience),
                "category": c.category, "skills": lst["skills"], "responsibilities": lst["responsibilities"], "keywords": lst["keywords"],
                "languages": lst["languages"], "certifications": lst["certifications"], "notes": notes, "applications": applications,
                "llm_model": c.llm_model, "extraction_ms": c.extraction_ms, "embedding_model": c.embedding_model,
            }

    # ------------------------------------------------------------------ paging, counting, facets
    @staticmethod
    def _category_clause(categories: Optional[Sequence[str]]):
        cats = [c for c in (categories or []) if c]
        return Candidate.category.in_(cats) if cats else None

    def list_candidate_ids(self, offset: int, limit: int, categories: Optional[Sequence[str]] = None) -> List[str]:
        """One page of ids, newest upload first."""
        q = select(Candidate.id).order_by(Candidate.uploaded_at.desc(), Candidate.id.desc()).offset(max(0, offset)).limit(max(0, limit))
        clause = self._category_clause(categories)
        if clause is not None:
            q = q.where(clause)
        with Session(self.engine) as s:
            return list(s.execute(q).scalars())

    def list_candidate_page(self, limit: int, categories: Optional[Sequence[str]] = None,
                            after: Optional[Tuple[datetime, str]] = None) -> Tuple[List[str], Optional[str]]:
        """One page of ids, newest upload first, and the cursor of the next page (None on the last one). The page starts right after
        ``after`` through the (uploaded_at, id) index, so its cost does not depend on how deep into the list it is."""
        limit = max(1, limit)
        q = select(Candidate.id, Candidate.uploaded_at).order_by(Candidate.uploaded_at.desc(), Candidate.id.desc()).limit(limit + 1)
        clause = self._category_clause(categories)
        if clause is not None:
            q = q.where(clause)
        if after is not None:
            q = q.where(older_than(after))
        with Session(self.engine) as s:
            rows = list(s.execute(q))
        page = rows[:limit]
        return [r[0] for r in page], (page_cursor(page[-1][1], page[-1][0]) if len(rows) > limit else None)

    def cached_category_counts(self) -> Dict[str, int]:
        """The exact number of candidates in every category (their sum is the exact size of the database). Counted by one pass over the
        category index and then shared through Redis until a candidate is saved or deleted, so opening a list or moving from one category
        to another never counts rows again."""
        cache = None
        try:
            from app.providers.cache.redis import get_redis_cache

            cache = get_redis_cache()
            hit = cache.get(COUNTS_KEY, namespace=COUNTS_NS)
            if isinstance(hit, dict):
                return {str(k): int(v) for k, v in hit.items()}
        except Exception:  # noqa: BLE001 - without the cache the database is asked
            cache = None
        counts = self.category_counts()
        if cache is not None:
            try:
                cache.set(COUNTS_KEY, counts, ttl_seconds=COUNTS_TTL_SECONDS, namespace=COUNTS_NS)
            except Exception:  # noqa: BLE001
                pass
        return counts

    def count_candidates(self, categories: Optional[Sequence[str]] = None) -> int:
        q = select(func.count()).select_from(Candidate)
        clause = self._category_clause(categories)
        if clause is not None:
            q = q.where(clause)
        with Session(self.engine) as s:
            return int(s.execute(q).scalar() or 0)

    def category_counts(self) -> Dict[str, int]:
        with Session(self.engine) as s:
            return {c: int(n) for c, n in s.execute(select(Candidate.category, func.count()).group_by(Candidate.category))}

    def candidate_facet(self, field: str, limit: int = 200) -> List[Dict[str, Any]]:
        """Distinct values with the number of candidates, most common first."""
        if field not in FACET_FIELDS:
            raise ValueError(f"Facet not allowed for field: {field}")
        with Session(self.engine) as s:
            if field in FACET_COLUMNS:
                col = FACET_COLUMNS[field]
                q = select(col, func.count()).where(col.is_not(None), col != "").group_by(col).order_by(func.count().desc(), col).limit(limit)
                return [{"value": v, "count": int(n)} for v, n in s.execute(q) if v]
            column = Candidate.keywords if field == "keywords" else Candidate.languages
            percent = arrays.sample_percent(self.engine, s, Candidate.__tablename__)   # None = read every row; a big table is sampled
            rows = [(v, int(n)) for v, n in s.execute(arrays.facet(self.engine, Candidate, column, limit, percent)) if v]
            scale = 100.0 / percent if percent else 1.0
            return [{"value": v, "count": max(1, round(n * scale))} for v, n in rows]

    # ------------------------------------------------------------------ search
    @property
    def _fts(self) -> bool:
        """True on PostgreSQL, where words are found through the full-text (tsvector) indexes; elsewhere the plain LIKE form is used."""
        return self.engine.dialect.name == "postgresql"

    @staticmethod
    def _padded_like(column, term: str):
        return (literal(" ") + column + literal(" ")).like(f"% {term} %")

    def _word_match(self, field: str, term: str):
        """The CV's search text ``field`` (text | literal | location | nationality) holds ``term`` as a whole word or an exact phrase."""
        if self._fts:
            config = FTS_CONFIG if field in ("text", "literal") else "simple"          # words of the CV: word forms; places: as written
            query = func.phraseto_tsquery(literal_column(f"'{config}'::regconfig"), term)
            if field == "text":      # the CV's own words or what the AI added
                return or_(CandidateSearch.literal_tsv.op("@@")(query), CandidateSearch.extra_tsv.op("@@")(query))
            return getattr(CandidateSearch, f"{field}_tsv").op("@@")(query)
        return self._padded_like(getattr(CandidateSearch, field), term)

    def _filters(self, *, experience_min, experience_max, locations, nationalities, languages, bool_node, added_after, added_before,
                 categories=None, notes=None, exclude_ids=None):
        """The conditions of a search that are not about the typed keywords."""
        conds = []
        if exclude_ids:
            conds.append(Candidate.id.notin_(exclude_ids))
        clause = self._category_clause(categories)
        if clause is not None:
            conds.append(clause)
        if notes in ("with", "without"):
            has_note = exists().where(CandidateNote.candidate_id == Candidate.id)
            conds.append(has_note if notes == "with" else not_(has_note))
        for field, values in (("location", locations), ("nationality", nationalities)):
            wanted = [w for w in dict.fromkeys(normalize(v) for v in values or []) if w]
            if wanted:
                conds.append(or_(*[self._word_match(field, w) for w in wanted]))
        langs = [v.strip() for v in dict.fromkeys(languages or []) if str(v).strip()]
        if langs:
            conds.append(arrays.contains_any(self.engine, Candidate.languages, langs))
        if added_after is not None:
            conds.append(Candidate.uploaded_at >= datetime.utcfromtimestamp(added_after))
        if added_before is not None:
            conds.append(Candidate.uploaded_at <= datetime.utcfromtimestamp(added_before))
        if experience_min is not None:
            conds.append(Candidate.years_of_experience >= Decimal(str(experience_min)))
        if experience_max is not None:
            conds.append(Candidate.years_of_experience <= Decimal(str(experience_max)))
        if bool_node is not None:
            if self._fts:
                conds.append(bq.to_sql(bool_node, CandidateSearch.literal_tsv, fts=True))
            else:
                narrow = bq.to_narrowing(bool_node, CandidateSearch.literal)
                if narrow is not None:
                    conds.append(narrow)
                conds.append(bq.to_sql(bool_node, CandidateSearch.literal))
        return conds

    def _term_clause(self, terms: List[str], mode: str):
        """Every term (mode 'all') or at least one (mode 'any') as a whole word / exact phrase of the CV's search text. The plain substring
        test first lets a trigram index narrow the rows; the padded test then makes it exact. On PostgreSQL each term is one full-text
        phrase match on the tsvector index."""
        if self._fts:
            each = [self._word_match("text", t) for t in terms]
        else:
            each = [and_(CandidateSearch.text.like(f"%{t}%"), self._padded_like(CandidateSearch.text, t)) for t in terms]
        return and_(*each) if mode == "all" else or_(*each)

    def _tier_conditions(self, tier: str, terms: List[str], filters: Dict[str, Any]):
        conds = self._filters(**filters)
        if tier == "full" and terms:
            conds.append(self._term_clause(terms, "all"))
        elif tier == "partial":
            conds.append(self._term_clause(terms, "any"))
            conds.append(~self._term_clause(terms, "all"))
        return conds

    def search_candidates(self, *, keywords=None, match_all: bool = True, experience_min=None, experience_max=None, locations=None,
                          nationalities=None, languages=None, limit: int = 50, cursor: Optional[str] = None, with_total: bool = False,
                          boolean_query: Optional[str] = None, added_after=None, added_before=None, categories=None,
                          notes: Optional[str] = None, exclude_ids: Optional[Sequence[str]] = None) -> Dict[str, Any]:
        """The advanced search. ``exclude_ids``: candidates never returned or counted (a job's own applicants, when its boolean string
        is run against the rest of the database). A keyword matches as a whole word (a phrase as an exact phrase), anywhere in the CV; ``match_all`` false
        puts the CVs with every keyword first, then those with some. A pasted boolean string is decided exactly on the CV's own text.
        Returns {ids, matched: {id: [terms as typed]}, next_cursor, total, total_is_estimate}; the cursor is "<tier>:<timestamp>|<id>"."""
        bool_node = bq.parse(boolean_query) if (boolean_query or "").strip() else None   # raises BooleanQueryError
        typed: Dict[str, str] = {}
        for k in keywords or []:
            t = normalize(k)
            if t and t not in typed:
                typed[t] = str(k).strip()
        if bool_node is not None:
            typed = {n.term: n.shown for n in bq.positive_terms(bool_node)}
        terms = list(typed)

        if bool_node is not None or not terms:
            tiers = ["bool" if bool_node is not None else "all"]
        elif match_all or len(terms) == 1:
            tiers = ["full"]
        else:
            tiers = ["full", "partial"]

        tier, after = 0, None
        if cursor:
            head, sep, rest = cursor.partition(":")
            if sep and head.isdigit():
                tier = int(head)
                ts, _, last_id = rest.partition("|")
                after = (datetime.fromisoformat(ts), last_id) if ts else None

        filters = dict(experience_min=experience_min, experience_max=experience_max, locations=locations, nationalities=nationalities,
                       languages=languages, bool_node=bool_node, added_after=added_after, added_before=added_before,
                       categories=categories, notes=notes, exclude_ids=list(dict.fromkeys(exclude_ids or [])))
        found: List[Tuple[str, str]] = []
        next_cursor: Optional[str] = None
        with Session(self.engine) as s:
            self._limit_search_time(s)
            while tier < len(tiers) and len(found) < limit:
                conds = self._tier_conditions(tiers[tier], terms, filters)
                if after:
                    conds.append(older_than(after))
                evidence = ([self._word_match("text", t).label(f"m{i}") for i, t in enumerate(terms)] if self._fts
                            else [CandidateSearch.text])
                q = (select(Candidate.id, Candidate.uploaded_at, *evidence)
                     .join(CandidateSearch, CandidateSearch.candidate_id == Candidate.id)
                     .where(*conds).order_by(Candidate.uploaded_at.desc(), Candidate.id.desc()).limit(limit - len(found) + 1))
                rows = list(s.execute(q))
                take = rows[: limit - len(found)]
                found.extend((row[0], row[2:] if self._fts else row[2]) for row in take)
                if len(rows) > len(take):                      # more in this tier: continue right after the last one returned
                    last = take[-1]
                    next_cursor = f"{tier}:{last[1].isoformat()}|{last[0]}"
                    break
                tier, after = tier + 1, None
            total, estimate = None, False
            if with_total:
                conds = self._tier_conditions("partial" if len(tiers) == 2 else tiers[-1], terms, filters)
                if len(tiers) == 2:      # the widest pass covers every CV the search can return: all the terms, or some of them
                    conds = self._filters(**filters) + [self._term_clause(terms, "any")]
                total, estimate = self._capped_count(s, select(Candidate.id).join(CandidateSearch, CandidateSearch.candidate_id == Candidate.id)
                                                   .where(*conds))
        if not terms:
            matched = {cid: [] for cid, _ in found}
        elif self._fts:
            matched = {cid: [typed[t] for t, hit in zip(terms, flags) if hit] for cid, flags in found}
        else:
            matched = {cid: [typed[t] for t in matched_terms(text, terms)] for cid, text in found}
        return {"ids": [cid for cid, _ in found], "matched": matched, "next_cursor": next_cursor, "total": total, "total_is_estimate": estimate}

    def _limit_search_time(self, s: Session) -> None:
        """On PostgreSQL a search is cancelled after SEARCH_STATEMENT_TIMEOUT_SECONDS (for this transaction only)."""
        if self._fts:
            from sqlalchemy import text as sql_text

            from app.config.settings import settings

            s.execute(sql_text(f"SET LOCAL statement_timeout = {int(settings.SEARCH_STATEMENT_TIMEOUT_SECONDS) * 1000}"))

    @staticmethod
    def _capped_count(s: Session, base) -> Tuple[int, bool]:
        """How many rows ``base`` (a select of ids) returns, counting at most COUNT_CAP; the flag says the true number is larger."""
        n = int(s.execute(select(func.count()).select_from(base.limit(COUNT_CAP + 1).subquery())).scalar() or 0)
        return min(n, COUNT_CAP), n > COUNT_CAP

    def search_candidate_ids(self, words: List[str], offset: int, limit: int,
                             categories: Optional[Sequence[str]] = None) -> Tuple[List[str], int, bool]:
        """The basic search box: every word typed must be in the CV. One page of ids (newest first), the total (counted up to
        COUNT_CAP) and whether the true total is larger than that."""
        terms = [t for t in dict.fromkeys(normalize(w) for w in words) if t]
        with Session(self.engine) as s:
            self._limit_search_time(s)
            conds = self._tier_conditions("full", terms, dict(experience_min=None, experience_max=None, locations=None, nationalities=None,
                                                              languages=None, bool_node=None, added_after=None, added_before=None,
                                                              categories=categories))
            base = select(Candidate.id).join(CandidateSearch, CandidateSearch.candidate_id == Candidate.id).where(*conds)
            total, estimate = self._capped_count(s, base)
            ids = list(s.execute(base.order_by(Candidate.uploaded_at.desc(), Candidate.id.desc()).offset(offset).limit(limit)).scalars())
        return ids, total, estimate

    def search_candidate_page(self, words: List[str], limit: int, categories: Optional[Sequence[str]] = None,
                              after: Optional[Tuple[datetime, str]] = None,
                              with_total: bool = True) -> Tuple[List[str], Optional[int], bool, Optional[str]]:
        """The basic search box, paged by cursor: one page of ids (newest first), the total (counted up to COUNT_CAP, only when asked: the
        first page asks, the following ones do not count again), whether the true total is larger, and the cursor of the next page."""
        limit = max(1, limit)
        terms = [t for t in dict.fromkeys(normalize(w) for w in words) if t]
        with Session(self.engine) as s:
            self._limit_search_time(s)
            conds = self._tier_conditions("full", terms, dict(experience_min=None, experience_max=None, locations=None, nationalities=None,
                                                              languages=None, bool_node=None, added_after=None, added_before=None,
                                                              categories=categories))
            joined = select(Candidate.id, Candidate.uploaded_at).join(CandidateSearch, CandidateSearch.candidate_id == Candidate.id)
            total, estimate = self._capped_count(s, joined.where(*conds)) if with_total else (None, False)
            if after is not None:
                conds = conds + [older_than(after)]
            rows = list(s.execute(joined.where(*conds).order_by(Candidate.uploaded_at.desc(), Candidate.id.desc()).limit(limit + 1)))
        page = rows[:limit]
        return [r[0] for r in page], total, estimate, (page_cursor(page[-1][1], page[-1][0]) if len(rows) > limit else None)

    # ------------------------------------------------------------------ notes
    @staticmethod
    def _note_dict(n: CandidateNote) -> Dict[str, Any]:
        return {"note": n.note, "hr_user": n.hr_user, "created_at": iso(n.created_at), "updated_at": iso(n.updated_at)}

    def _notes_of(self, s: Session, ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        out: Dict[str, List[Dict[str, Any]]] = {}
        for part in chunks(ids):
            for n in s.execute(select(CandidateNote).where(CandidateNote.candidate_id.in_(part)).order_by(CandidateNote.updated_at)).scalars():
                out.setdefault(n.candidate_id, []).append(self._note_dict(n))
        return out

    def upsert_note(self, cid: str, hr_user: str, note: str) -> Optional[Dict[str, Any]]:
        with Session(self.engine) as s:
            if s.get(Candidate, cid) is None:
                return None
            row = s.get(CandidateNote, (cid, hr_user))
            now = datetime.utcnow()
            if row is None:
                row = CandidateNote(candidate_id=cid, hr_user=hr_user, note=note, created_at=now, updated_at=now)
            else:
                row.note, row.updated_at = note, now
            s.add(row)
            s.commit()
            return self._note_dict(row)

    def list_notes(self, cid: str) -> Optional[List[Dict[str, Any]]]:
        with Session(self.engine) as s:
            if s.get(Candidate, cid) is None:
                return None
            return self._notes_of(s, [cid]).get(cid, [])

    def delete_note(self, cid: str, hr_user: str) -> Optional[bool]:
        """True deleted, False no such note, None no such candidate."""
        with Session(self.engine) as s:
            if s.get(Candidate, cid) is None:
                return None
            row = s.get(CandidateNote, (cid, hr_user))
            if row is None:
                return False
            s.delete(row)
            s.commit()
            return True

    def notes_summary(self, ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """{cid: {has_notes, notes_count, latest_note}} for the ids that exist."""
        out = {i: {"cv_id": i, "has_notes": False, "notes_count": 0, "latest_note": None} for i in ids}
        with Session(self.engine) as s:
            for cid, notes in self._notes_of(s, [str(i) for i in ids]).items():
                latest = max(notes, key=lambda n: n.get("updated_at") or n.get("created_at") or "")
                out[cid] = {"cv_id": cid, "has_notes": True, "notes_count": len(notes), "latest_note": latest}
        return out
