"""Counts and samples for the admin pages (System, Database view, Monitor)."""
from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy import func, select
from sqlmodel import Session

from app.models.talent import Candidate, JobApplication, JobDescription, JobPosting
from app.store import arrays


class StatsStore:
    engine: Any

    def library_counts(self) -> Dict[str, int]:
        with Session(self.engine) as s:
            return {
                "cvs": int(s.execute(select(func.count()).select_from(Candidate)).scalar() or 0),
                "jds": int(s.execute(select(func.count()).select_from(JobDescription).where(JobDescription.deleted_at.is_(None))).scalar() or 0),
            }

    def skill_stats(self) -> Dict[str, Dict[str, float]]:
        """Average / largest / smallest number of skills per CV and per job description."""
        out: Dict[str, Dict[str, float]] = {}
        with Session(self.engine) as s:
            for key, owner in (("cv", Candidate), ("jd", JobDescription)):
                n = arrays.length(self.engine, owner.skills)
                avg, high, low = s.execute(select(func.avg(n), func.max(n), func.min(n))).one()
                out[key] = {"avg": float(avg or 0), "max": int(high or 0), "min": int(low or 0)}
        return out

    def table_counts(self) -> List[Dict[str, Any]]:
        """Row counts of the data tables, for the database status page."""
        tables = [("candidate", Candidate), ("job_description", JobDescription), ("job_posting", JobPosting), ("job_application", JobApplication)]
        with Session(self.engine) as s:
            return [{"name": name, "rows": int(s.execute(select(func.count()).select_from(model)).scalar() or 0)} for name, model in tables]

    def recent_candidates(self, n: int) -> List[Dict[str, Any]]:
        ids = self.list_candidate_ids(0, n)
        rows = self.candidate_rows(ids)
        return [{
            "id": r["id"], "name": r["full_name"], "filename": r["filename"], "job_title": r["job_title"], "skills_count": r["skills_count"],
            "experience_years": r["years_of_experience"], "upload_date": r["upload_date"] or "Unknown", "top_skills": r["skills"][:5],
            "responsibilities_count": r["responsibilities_count"],
        } for r in rows]

    def recent_job_descriptions(self, n: int) -> List[Dict[str, Any]]:
        rows, _total = self.list_job_descriptions(offset=0, limit=n)
        out = []
        with Session(self.engine) as s:
            for r in rows:
                resp = int(s.execute(select(arrays.length(self.engine, JobDescription.responsibilities)).where(JobDescription.id == r["id"])).scalar() or 0)
                out.append({"id": r["id"], "filename": r["filename"], "job_title": r["job_title"], "required_skills": r["skills_count"],
                            "required_years": r["years_of_experience"], "upload_date": r["upload_date"] or "Unknown",
                            "top_skills": r["skill_keywords"][:5], "responsibilities_count": resp})
        return out
