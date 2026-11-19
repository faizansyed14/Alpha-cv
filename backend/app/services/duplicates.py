"""Candidates that are the same person, made before "one candidate per person" (app/ingestion/identity.py), and joining them.

A group is every candidate with the same e-mail address AND the same phone (the rule new CVs follow). In a group the candidate with the
newest CV is kept; each older one is joined into it and then removed:

* its job applications move to the kept candidate (a job both applied to keeps the kept candidate's application);
* its notes move too (a recruiter who wrote on both keeps one note holding both texts);
* a detail the kept candidate lacks (nationality, notice period, LinkedIn ...) is taken from it;
* its file's fingerprint is remembered on the kept candidate, so that old file sent again joins the kept candidate;
* then the older candidate, its vectors and its stored file are deleted.

Nothing is changed by ``find_groups``; ``merge_group`` changes one group. scripts/db/merge_duplicates.py runs them (report first).
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlmodel import Session

from app.models.talent import Candidate, CandidateNote, JobApplication

logger = logging.getLogger(__name__)

# details taken from an older CV when the kept candidate has none (what the CV itself says is the newest CV's business)
GAP_FIELDS = ("email", "phone", "linkedin_url", "github_url", "gender", "location", "nationality", "notice_period", "expected_salary")


@dataclass
class Member:
    id: str
    name: Optional[str]
    filename: str
    uploaded_at: Optional[datetime]


@dataclass
class Group:
    email: str
    phone_key: str
    keep: Member
    others: List[Member] = field(default_factory=list)


def find_groups(store) -> List[Group]:
    """Every group of two or more candidates with the same e-mail and phone; the one with the newest CV is the one kept. Read-only."""
    with Session(store.engine) as s:
        rows = s.execute(select(Candidate.id, func.lower(Candidate.email), Candidate.phone_key, Candidate.full_name, Candidate.original_filename,
                                Candidate.uploaded_at)
                         .where(Candidate.email.isnot(None), Candidate.email != "", Candidate.phone_key.isnot(None))).all()
    by_person: Dict[tuple, List[Member]] = defaultdict(list)
    for cid, email, phone, name, filename, uploaded in rows:
        by_person[(email.strip(), phone)].append(Member(cid, name, filename or "", uploaded))
    groups = []
    for (email, phone), members in sorted(by_person.items()):
        if len(members) < 2:
            continue
        members.sort(key=lambda m: (m.uploaded_at or datetime.min, m.id), reverse=True)
        groups.append(Group(email=email, phone_key=phone, keep=members[0], others=members[1:]))
    return groups


def merge_group(store, keep_id: str, other_ids: List[str], storage: Any = None) -> Dict[str, Any]:
    """Join the candidates ``other_ids`` into ``keep_id`` (see the module note) and delete them. The database part is one transaction:
    if it fails nothing has changed. Returns what was done."""
    moved_apps = moved_notes = 0
    removed: List[Dict[str, Any]] = []
    with Session(store.engine) as s:
        keep = s.get(Candidate, keep_id, with_for_update=True)
        if keep is None:
            raise LookupError(f"Candidate {keep_id} does not exist")
        previous = list(keep.previous_sha256 or [])
        for oid in other_ids:
            other = s.get(Candidate, oid)
            if other is None or oid == keep_id:
                continue
            for app in list(s.execute(select(JobApplication).where(JobApplication.candidate_id == oid)).scalars()):
                if s.get(JobApplication, (app.job_posting_id, keep_id)) is None:
                    s.add(JobApplication(job_posting_id=app.job_posting_id, candidate_id=keep_id, source=app.source, status=app.status,
                                         applied_at=app.applied_at))
                    moved_apps += 1
                s.delete(app)
            for note in list(s.execute(select(CandidateNote).where(CandidateNote.candidate_id == oid)).scalars()):
                mine = s.get(CandidateNote, (keep_id, note.hr_user))
                if mine is None:
                    s.add(CandidateNote(candidate_id=keep_id, hr_user=note.hr_user, note=note.note, created_at=note.created_at,
                                        updated_at=note.updated_at))
                elif note.note and note.note.strip() not in (mine.note or ""):
                    mine.note = f"{mine.note}\n\n{note.note}" if mine.note else note.note
                    s.add(mine)
                moved_notes += 1
                s.delete(note)
            for name in GAP_FIELDS:
                if getattr(keep, name) in (None, "") and getattr(other, name) not in (None, ""):
                    setattr(keep, name, getattr(other, name))
            previous += [other.content_sha256, *(other.previous_sha256 or [])]
            firsts = [d for d in (keep.first_added_at, other.first_added_at, other.uploaded_at) if d]
            keep.first_added_at = min(firsts) if firsts else keep.first_added_at
            removed.append({"id": oid, "filename": other.original_filename, "file_format": other.file_format, "file_path": other.file_path})
        keep.previous_sha256 = list(dict.fromkeys(h for h in previous if h and h != keep.content_sha256))
        s.add(keep)
        s.commit()

    store.save_candidate({"id": keep_id})              # rebuilds the search text with the details just joined in
    for info in removed:
        store.delete_candidate(info["id"])             # the row (and anything left on it) and its vectors
        if info.get("file_path"):
            ext = os.path.splitext(info.get("filename") or "")[1].lower() or (f".{info['file_format']}" if info.get("file_format") else ".pdf")
            try:
                (storage or _storage()).delete_file(info["id"], "cv", ext)
            except Exception as exc:  # noqa: BLE001 - the candidate is gone; a stray file is reported, not fatal
                logger.warning(f"Could not delete the stored file of {info['id']}: {exc}")
    return {"kept": keep_id, "removed": [i["id"] for i in removed], "applications_moved": moved_apps, "notes_moved": moved_notes}


def _storage():
    from app.providers.storage import get_storage_service

    return get_storage_service()
