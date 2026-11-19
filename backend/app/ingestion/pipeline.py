"""The one way a CV enters the system, whichever door it came through.

Uploads and job-page applications both call :func:`ingest_cv`, so a CV is read, standardised,
embedded, stored and (when it belongs to a job) linked by exactly the same code, and is matched afterwards by the same
queue. A submission differs only in *where it came from* (``source``) and in the extra facts that door knows about the
candidate (``candidate``: nationality, current location, notice period, expected salary ...) and the job (``job``).
Those facts are joined into the CV's single record:

* the record is the candidate row; every source adds to it and none overwrites it with blanks;
* candidate-supplied values (what the person typed on the job page) win over values the LLM read from the CV, and land in the
  same columns, so a CV from the upload page and one from the job page look exactly alike;
* the same file arriving again (same SHA-256) is joined to the existing candidate instead of being stored twice; applying to a
  job adds an application row for that candidate (one per job).

Everything about the person is written to PostgreSQL (app/store); only the 31 vectors go to Qdrant.
``ingest_cv`` is blocking (parsing, OCR, LLM, embeddings, database); call it with ``asyncio.to_thread``.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.exc import IntegrityError

from app.config.settings import settings
from app.ingestion.autofill import cached_standardized
from app.ingestion.contact import resolve_name
from app.ingestion.identity import email_keys, phone_keys
from app.ingestion.cv_parser import get_parsing_service
from app.ingestion.profile_links import pick_github, pick_linkedin
from app.monitoring.recorder import timed
from app.providers.embeddings.service import get_embedding_service
from app.providers.llm.service import get_llm_service
from app.providers.storage import get_storage_service
from app.store import get_store

logger = logging.getLogger(__name__)

SOURCE_UPLOAD = "upload"
SOURCE_JOB_PAGE = "website"          # the public job-page apply form

# Facts a door can supply about the candidate. They are joined into the record; empty values never overwrite.
CANDIDATE_FIELDS = ("name", "email", "phone", "linkedin_url", "github_url", "nationality", "location", "notice_period", "expected_salary",
                    "years_of_experience")

MIN_TEXT_CHARS = 50

Progress = Callable[[int, str], None]

# Stage pools. However many CVs are being ingested at once (queued uploads, job-page applications, e-mail intake), at
# most this many are inside the LLM call or inside the embedding call in this process. The rest wait their turn at
# that stage while others read, OCR or store, so a 100-CV batch keeps every stage busy without flooding OpenAI
# (rate limits) or the embedding model server.
_llm_slots = threading.BoundedSemaphore(max(1, settings.INGEST_LLM_CONCURRENCY))
_embed_slots = threading.BoundedSemaphore(max(1, settings.INGEST_EMBED_CONCURRENCY))


class IngestError(Exception):
    """The CV cannot be ingested (unreadable, too little text ...). ``status`` is the HTTP code a route should use."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


class DuplicateApplication(IngestError):
    """This person already applied to this job. ``existing_id`` is the record of the first application."""

    def __init__(self, existing_id: str, applied_on: Optional[str] = None) -> None:
        super().__init__("You have already applied to this job." + (f" Your application was received on {applied_on}." if applied_on else ""), 409)
        self.existing_id = existing_id
        self.applied_on = applied_on


@dataclass
class CVSubmission:
    source: str
    filename: str
    #: local path of the original file; parsed here and (unless ``persisted_path`` is set) saved to storage
    file_path: Optional[str] = None
    #: pasted text instead of a file
    text: Optional[str] = None
    #: result of ``process_document`` when the caller already parsed (keeps the upload route's fast validation)
    parsed: Optional[Dict[str, Any]] = None
    cv_id: Optional[str] = None
    #: the original is already in storage (the job page saves it before queueing)
    persisted_path: Optional[str] = None
    content_sha256: Optional[str] = None
    mime_type: Optional[str] = None
    #: facts about the candidate from this door, keys from CANDIDATE_FIELDS
    candidate: Dict[str, Any] = field(default_factory=dict)
    #: weaker facts, used only when the CV itself gives none
    hints: Dict[str, Any] = field(default_factory=dict)
    #: the job this CV applies to: {"job_id": ..., plus anything the door knows: job_title, subject_id, ...}
    job: Optional[Dict[str, Any]] = None
    progress: Optional[Progress] = None


@dataclass
class IngestResult:
    cv_id: str
    merged: bool = False                     # True when an existing record was updated instead of a new one created
    replaced: bool = False                   # True when this CV replaced the older CV of the same person (cv_id is that candidate)
    standardized: Dict[str, Any] = field(default_factory=dict)
    stats: Dict[str, Any] = field(default_factory=dict)


def _present(value: Any) -> bool:
    return value is not None and value != "" and value != []


def _clean(values: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in values.items() if _present(v)}


def normalize_email(email: Optional[str]) -> Optional[str]:
    return email.strip().lower() if isinstance(email, str) and email.strip() else None


def _lock_key(email: str, job_id: str) -> str:
    return f"apply-lock:{job_id}:{email}"


def claim_application(email: Optional[str], job_id: Optional[str], owner: str, ttl_s: int = 900) -> bool:
    """Reserve (email, job) while an application is being processed, so a double click, a retry or the same person
    arriving by two doors at once cannot create two applications before the first is stored. False = already claimed.
    Without Redis there is no lock and the stored-record check below is the only guard."""
    email = normalize_email(email)
    if not (email and job_id):
        return True
    try:
        from app.providers.cache.redis import get_redis_cache

        cache = get_redis_cache()
        if not cache.is_connected:
            return True
        return bool(cache.redis_client.set(_lock_key(email, job_id), owner, nx=True, ex=ttl_s))
    except Exception:  # noqa: BLE001 - a lock outage must not block applications
        return True


def release_application(email: Optional[str], job_id: Optional[str], owner: str) -> None:
    """Let the person retry after a failed attempt (only the claimer can release)."""
    email = normalize_email(email)
    if not (email and job_id):
        return
    try:
        from app.providers.cache.redis import get_redis_cache

        r = get_redis_cache().redis_client
        key = _lock_key(email, job_id)
        value = r.get(key)
        if value is not None and (value.decode() if isinstance(value, bytes) else value) == owner:
            r.delete(key)
    except Exception:  # noqa: BLE001
        pass


def sha256_of_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ---------------------------------------------------------------------------------------------------------------------
# reading the document
# ---------------------------------------------------------------------------------------------------------------------
def _local_copy(sub: CVSubmission) -> Optional[str]:
    """A readable local file for the submission: the given path, or a download of the stored original."""
    if sub.file_path and os.path.exists(sub.file_path):
        return sub.file_path
    if sub.persisted_path:
        if not sub.persisted_path.startswith("s3://") and os.path.exists(sub.persisted_path):
            return sub.persisted_path
        ext = os.path.splitext(sub.filename)[1].lower() or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            dest = tmp.name
        get_storage_service().download_file(sub.cv_id, "cv", ext, dest)
        return dest
    return None


def _read(sub: CVSubmission) -> Dict[str, Any]:
    parsing = get_parsing_service()
    if sub.parsed:
        return sub.parsed
    if sub.text is not None:
        cleaned, pii = parsing.remove_pii_data(sub.text.strip())
        return {"raw_text": sub.text.strip(), "clean_text": cleaned, "extracted_pii": pii, "ocr_used": False}
    path = _local_copy(sub)
    if not path:
        raise IngestError("The CV file could not be found", 500)
    try:
        return parsing.process_document(path, "cv")
    except Exception as exc:  # noqa: BLE001
        raise IngestError(f"Could not read the CV: {exc}", 400) from exc
    finally:
        if path != sub.file_path and path != sub.persisted_path and path and os.path.exists(path):
            try:
                os.unlink(path)
            except OSError:
                pass


# ---------------------------------------------------------------------------------------------------------------------
# the record
# ---------------------------------------------------------------------------------------------------------------------
def _candidate_facts(sub: CVSubmission, standardized: Dict[str, Any], pii: Dict[str, Any]) -> Dict[str, Any]:
    """Facts about the person: what the door supplied wins; the LLM/PII reading of the CV fills what is missing."""
    contact = standardized.get("contact_info") or {}
    from_cv = {
        "name": standardized.get("name"),
        "email": (pii.get("email") or [None])[0] or contact.get("email"),
        "phone": (pii.get("phone") or [None])[0] or contact.get("phone"),
        "linkedin_url": pick_linkedin(pii.get("linkedin") or []),
        "github_url": pick_github(pii.get("github") or [], pii.get("github_repo_only") or [], standardized.get("name"),
                                  (pii.get("email") or [None])[0] or contact.get("email")),
        "nationality": standardized.get("nationality"),
        "location": standardized.get("location") or standardized.get("current_location"),
        "notice_period": standardized.get("notice_period"),
        "years_of_experience": standardized.get("years_of_experience"),
    }
    facts = {**_clean(sub.hints), **_clean(from_cv), **_clean(sub.candidate)}
    if facts.get("email"):
        facts["email"] = normalize_email(facts["email"])
    return facts


def _person(sub: CVSubmission, standardized: Dict[str, Any], pii: Dict[str, Any]) -> Dict[str, Any]:
    """The columns of the candidate row: the joined facts plus what the CV itself says about the job."""
    facts = _candidate_facts(sub, standardized, pii)
    person = {k: v for k, v in facts.items() if k != "name"}
    person["full_name"] = facts.get("name")
    person["job_title"] = standardized.get("job_title")
    person["category"] = standardized.get("category")
    person["gender"] = standardized.get("gender")
    return person


def _application_data(sub: CVSubmission, facts: Dict[str, Any]) -> Dict[str, Any]:
    """What the application row stores: which door it came through and when (the person's own details live on the candidate)."""
    return {"source": sub.source,
            "applied_at": datetime.utcnow()}


# ---------------------------------------------------------------------------------------------------------------------
# merging into an existing candidate
# ---------------------------------------------------------------------------------------------------------------------
def discard_orphan_original(store, cv_id: str, stored_path: Optional[str]) -> bool:
    """Delete an original file that was saved to storage for ``cv_id`` but that no candidate row owns: the upload turned out to be a
    duplicate (the candidate already exists with its own file) or processing failed. Never touches a file whose name is not this
    id, and never a file whose candidate exists. Returns True when a delete was sent; a failure is only logged."""
    if not stored_path:
        return False
    stem, ext = os.path.splitext(os.path.basename(stored_path))
    if stem != cv_id:
        return False
    try:
        if store.candidate_document(cv_id):
            return False
        get_storage_service().delete_file(cv_id, "cv", ext)
        logger.info(f"Removed the unused stored file of {cv_id} ({stored_path})")
        return True
    except Exception as exc:  # noqa: BLE001 - a stray file is cleaned up later, it must never fail the upload
        logger.warning(f"Could not remove the unused stored file of {cv_id}: {exc}")
        return False


def _merge_into(store, existing: Dict[str, Any], sub: CVSubmission, stored_path: Optional[str] = None) -> IngestResult:
    cv_id = existing["id"]
    facts = _clean(sub.candidate)
    person = {k: v for k, v in facts.items() if k != "name"}
    if facts.get("name"):
        person["full_name"] = facts["name"]
    store.merge_candidate_facts(cv_id, person)
    if sub.job and sub.job.get("job_id"):
        store.link_application(sub.job["job_id"], cv_id, _application_data(sub, facts))
    logger.info(f"CV {cv_id} already stored; joined data from {sub.source} into the existing candidate")
    if sub.cv_id and sub.cv_id != cv_id:
        # the existing candidate keeps its own file; the copy this submission saved first (queued uploads and the job page save it
        # before the duplicate is known) belongs to nobody
        discard_orphan_original(store, sub.cv_id, stored_path or sub.persisted_path)
    return IngestResult(cv_id=cv_id, merged=True, standardized={}, stats={"merged_fields": sorted(person), "source": sub.source})


# ---------------------------------------------------------------------------------------------------------------------
# the pipeline
# ---------------------------------------------------------------------------------------------------------------------
def ingest_cv(sub: CVSubmission) -> IngestResult:
    def step(percent: int, message: str) -> None:
        if sub.progress:
            try:
                sub.progress(percent, message)
            except Exception:  # noqa: BLE001 - progress reporting never breaks ingestion
                pass

    started = time.perf_counter()
    sub.cv_id = sub.cv_id or str(uuid.uuid4())
    with timed("job", "ingest", sub.source, notable=True, cv_id=sub.cv_id, filename=sub.filename) as t:
        try:
            result = _ingest(sub, step)
            t.detail["merged"] = result.merged
            return result
        except Exception:
            t.fail()
            raise
        finally:
            logger.info(f"CV ingest ({sub.source}) took {time.perf_counter() - started:.1f}s")


def _ingest(sub: CVSubmission, step: Progress) -> IngestResult:
    store = get_store()
    step(5, "Reading the document")
    parsed = _read(sub)
    text = parsed.get("clean_text") or ""
    pii = parsed.get("extracted_pii") or {"email": [], "phone": []}
    if len(text.strip()) < MIN_TEXT_CHARS:
        raise IngestError("Could not extract sufficient text from the CV (minimum 50 characters)", 400)

    sha = sub.content_sha256
    if not sha and sub.file_path and os.path.exists(sub.file_path):
        sha = sha256_of_file(sub.file_path)
    if not sha:                                                   # pasted text, or a file we cannot reopen: the text identifies it
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    job_id = (sub.job or {}).get("job_id")

    # One application per person per job, whichever door it arrives by. The applicant's e-mail is what the door
    # supplied, or the one read from the CV when it supplied none.
    applicants = [normalize_email(e) for e in (sub.candidate.get("email"), (pii.get("email") or [None])[0], sub.hints.get("email"))]
    for applicant in dict.fromkeys(a for a in applicants if a):
        prior = store.check_existing_application(applicant, job_id) if job_id else None
        if prior and prior.get("id") != sub.cv_id:
            raise DuplicateApplication(prior["id"], prior.get("application_date"))

    existing = store.find_candidate_by_hash(sha)
    if existing:
        step(95, "Already in the database - joining the new details")
        return _merge_into(store, existing, sub)

    step(25, "Standardising with AI")
    # The public form's autofill may already have read this very CV a moment ago; reuse that answer, same prompt.
    standardized = cached_standardized(text)
    if standardized is None:
        with _llm_slots:
            standardized = get_llm_service().standardize_cv(text, sub.filename)
    contact = standardized.setdefault("contact_info", {})
    # The LLM saw [EMAIL] / [PHONE] in place of the contact details, so its name can come back empty, "Unknown" or a
    # heading; fall back to the document's header, then the e-mail address.
    name = resolve_name(standardized.get("name") or contact.get("name"), parsed.get("raw_text") or "",
                        (pii.get("email") or [None])[0] or sub.candidate.get("email") or sub.hints.get("email"))
    if name:
        standardized["name"] = contact["name"] = name
    if pii.get("email"):
        contact["email"] = standardized["email"] = pii["email"][0]
    if pii.get("phone"):
        contact["phone"] = standardized["phone"] = pii["phone"][0]
    own_email = (pii.get("email") or [None])[0] or contact.get("email")
    own_linkedin = pick_linkedin(pii.get("linkedin") or [])
    own_github = pick_github(pii.get("github") or [], pii.get("github_repo_only") or [], name, own_email)
    if own_linkedin:
        contact["linkedin"] = standardized["linkedin_url"] = own_linkedin
    if own_github:
        contact["github"] = standardized["github_url"] = own_github

    step(50, "Generating embeddings")
    with _embed_slots:
        embeddings = get_embedding_service().generate_document_embeddings(standardized)

    step(70, "Storing")
    ext = os.path.splitext(sub.filename)[1].lower() or ".txt"
    record = _cv_record(sub, sha, text, ext, standardized, pii)

    # One candidate per person: a newer CV of someone already in the database (same e-mail AND phone) replaces their CV. Decided under
    # the person's lock, so two CVs of the same person arriving together are stored one after the other, never as two candidates.
    emails = email_keys([sub.candidate.get("email"), (pii.get("email") or [None])[0], sub.hints.get("email")])
    phones = phone_keys([sub.candidate.get("phone"), (pii.get("phone") or [None])[0], sub.hints.get("phone")])
    if not (settings.CV_REPLACE_SAME_PERSON and emails and phones):
        return _store_new(store, sub, record, embeddings, standardized, pii, job_id, step)
    try:
        with store.person_lock(emails):
            again = store.find_candidate_by_hash(sha)              # the same file was stored while this one was being read
            if again:
                step(95, "Already in the database - joining the new details")
                return _merge_into(store, again, sub)
            person = store.find_same_person(emails, phones, exclude=sub.cv_id)
            if person:
                return _replace_cv(store, person, sub, record, embeddings, standardized, pii, ext, job_id, step)
            return _store_new(store, sub, record, embeddings, standardized, pii, job_id, step)
    except TimeoutError as exc:
        raise IngestError(f"{exc}. Please try again in a minute.", 503) from exc


def _cv_record(sub: CVSubmission, sha: str, text: str, ext: str, standardized: Dict[str, Any], pii: Dict[str, Any]) -> Dict[str, Any]:
    """The candidate row as ``save_candidate`` takes it, without the file's place in storage (added by the caller)."""
    meta = standardized.get("processing_metadata") or {}
    return {
        "content_sha256": sha, "filename": sub.filename, "file_format": ext.lstrip("."),
        "mime_type": sub.mime_type or mimetypes.guess_type(sub.filename)[0] or "application/octet-stream",
        "source": sub.source, "raw_text": text, "facts": _person(sub, standardized, pii),
        "skills": [x for x in standardized.get("skills_sentences", standardized.get("skills", [])) if x],
        "responsibilities": [x for x in standardized.get("responsibility_sentences", standardized.get("responsibilities", [])) if x],
        "keywords": standardized.get("keywords") or [], "languages": standardized.get("languages") or [],
        "certifications": standardized.get("certifications") or [],
        "llm_model": meta.get("model_used"),
        "extraction_ms": int(float(meta["processing_time"]) * 1000) if meta.get("processing_time") is not None else None,
    }


def _stats(text: str, standardized: Dict[str, Any], pii: Dict[str, Any], **extra: Any) -> Dict[str, Any]:
    return {
        "text_length": len(text),
        "skills_count": len(standardized.get("skills_sentences", standardized.get("skills", []))),
        "responsibilities_count": len(standardized.get("responsibility_sentences", standardized.get("responsibilities", []))),
        "embeddings_generated": 31,
        "pii_extracted": {"emails": len(pii.get("email", [])), "phones": len(pii.get("phone", [])),
                          "linkedin": len(pii.get("linkedin", [])), "github": len(pii.get("github", []))},
        **extra,
    }


def _link(store, job_id: Optional[str], cv_id: str, sub: CVSubmission, standardized: Dict[str, Any], pii: Dict[str, Any], step: Progress) -> None:
    if job_id:
        step(90, "Linking to the job")
        if not store.link_application(job_id, cv_id, _application_data(sub, _candidate_facts(sub, standardized, pii))):
            logger.warning(f"CV {cv_id} stored but could not be linked to job {job_id}")


def _store_new(store, sub: CVSubmission, record: Dict[str, Any], embeddings: Dict[str, Any], standardized: Dict[str, Any],
               pii: Dict[str, Any], job_id: Optional[str], step: Progress) -> IngestResult:
    """A new candidate."""
    text, sha = record["raw_text"], record["content_sha256"]
    ext = "." + record["file_format"] if record.get("file_format") else ".txt"
    persisted = sub.persisted_path or _persist_original(sub, text, ext)
    try:
        store.save_candidate({**record, "id": sub.cv_id, "file_path": persisted})
        if not store.store_embeddings("cv", sub.cv_id, embeddings):
            raise IngestError("The CV's embeddings could not be saved", 500)
    except IngestError:
        store.delete_candidate(sub.cv_id)                         # never leave a candidate without its vectors
        raise
    except IntegrityError as exc:
        # the same file was stored a moment ago by another worker (the file hash is unique): join this submission into that candidate
        store.delete_candidate(sub.cv_id)
        winner = store.find_candidate_by_hash(sha)
        if not winner:
            raise IngestError(f"The CV could not be saved to the database: {exc}", 500) from exc
        logger.info(f"CV {sub.cv_id} was stored at the same moment by another worker; joining the details into {winner['id']}")
        return _merge_into(store, winner, sub, stored_path=persisted)
    except Exception as exc:  # noqa: BLE001
        store.delete_candidate(sub.cv_id)
        raise IngestError(f"The CV could not be saved to the database: {exc}", 500) from exc

    _link(store, job_id, sub.cv_id, sub, standardized, pii, step)
    step(100, "Done")
    return IngestResult(cv_id=sub.cv_id, standardized=standardized, stats=_stats(text, standardized, pii))


def _replace_cv(store, cid: str, sub: CVSubmission, record: Dict[str, Any], embeddings: Dict[str, Any], standardized: Dict[str, Any],
                pii: Dict[str, Any], ext: str, job_id: Optional[str], step: Progress) -> IngestResult:
    """A newer CV of candidate ``cid``: it becomes their CV (file, text, extracted data, vectors) and the old one is gone. Their notes,
    applications and form details stay. All or nothing: if any step fails, the old file, vectors and row are put back as they were."""
    step(75, "A newer CV of a candidate already in the database - replacing the old one")
    storage = get_storage_service()
    old = store.candidate_document(cid) or {}
    old_ext = os.path.splitext(old.get("filename") or "")[1].lower() or (f".{old['file_format']}" if old.get("file_format") else "")
    try:
        old_vectors = store.retrieve_embeddings(cid, "cv")         # to put back if a later step fails
    except Exception as exc:  # noqa: BLE001 - nothing has changed yet: stop rather than replace without a way back
        raise IngestError(f"The vector store is not answering; the CV was not replaced: {exc}", 503) from exc
    temps: List[str] = []
    backup: Optional[str] = None
    new_path: Optional[str] = None
    try:
        # 1. keep a copy of the old original, so a failure below can put it back
        if old.get("file_path") and old_ext:
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=old_ext) as tmp:
                    backup = tmp.name
                temps.append(backup)
                storage.download_file(cid, "cv", old_ext, backup)
            except Exception as exc:  # noqa: BLE001 - nothing to restore from; the old file is simply not restorable
                logger.warning(f"Could not keep a copy of the old CV of {cid} before replacing it: {exc}")
                backup = None
        # 2. the new original, under the candidate's id (where previews and downloads look for it)
        local = _local_copy(sub)
        if local and local not in (sub.file_path, sub.persisted_path):
            temps.append(local)
        if not local:                                              # pasted text: stored as a .txt file, as for a new candidate
            with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8") as tmp:
                tmp.write(record["raw_text"])
                local = tmp.name
            temps.append(local)
            ext = ".txt"
            record = {**record, "file_format": "txt"}
        new_path = storage.upload_file(local, cid, "cv", ext)
        # 3. the vectors, then the row
        if not store.store_embeddings("cv", cid, embeddings):
            raise IngestError("The CV's embeddings could not be saved", 500)
        # the source stays the door the person first came through; uploaded_at becomes this CV's date (lists, freshness, the age box)
        store.replace_cv(cid, {**{k: v for k, v in record.items() if k != "source"}, "file_path": new_path, "uploaded_at": datetime.utcnow()})
    except Exception as exc:  # noqa: BLE001
        _restore(store, storage, cid, old_vectors, backup, old_ext, ext, new_path)
        if isinstance(exc, IngestError):
            raise
        raise IngestError(f"The newer CV could not replace the old one: {exc}", 500) from exc
    finally:
        for path in temps:
            try:
                os.unlink(path)
            except OSError:
                pass

    if old_ext and old_ext != ext:                                 # the old original had another type: it is no longer anyone's file
        try:
            storage.delete_file(cid, "cv", old_ext)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Could not remove the old CV file of {cid}: {exc}")
    if sub.cv_id and sub.cv_id != cid:                             # the copy this submission saved under its own id first
        discard_orphan_original(store, sub.cv_id, sub.persisted_path)
    logger.info(f"CV from {sub.source} replaced the CV of candidate {cid} (same e-mail and phone)")
    _link(store, job_id, cid, sub, standardized, pii, step)
    step(100, "Done")
    return IngestResult(cv_id=cid, replaced=True, standardized=standardized,
                        stats=_stats(record["raw_text"], standardized, pii, replaced_cv_of=cid))


def _restore(store, storage, cid: str, old_vectors: Optional[Dict[str, Any]], backup: Optional[str], old_ext: str, new_ext: str,
             new_path: Optional[str]) -> None:
    """Put the candidate back as it was after a failed replacement (the row itself was not changed: its write is the last step)."""
    if old_vectors:
        try:
            store.store_embeddings("cv", cid, old_vectors)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Could not put back the vectors of {cid} after a failed CV replacement: {exc}")
    if new_path and new_ext != old_ext:
        try:
            storage.delete_file(cid, "cv", new_ext)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Could not remove the new file of {cid} after a failed CV replacement: {exc}")
    if backup and new_path and new_ext == old_ext:                 # the new file overwrote the old one: put the old one back
        try:
            storage.upload_file(backup, cid, "cv", old_ext)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Could not put back the old CV file of {cid} after a failed CV replacement: {exc}")


def _persist_original(sub: CVSubmission, text: str, ext: str) -> Optional[str]:
    """Save the original file (or the pasted text) to storage so it can be previewed and downloaded later."""
    storage = get_storage_service()
    temp: Optional[str] = None
    try:
        if sub.file_path and os.path.exists(sub.file_path):
            return storage.upload_file(sub.file_path, sub.cv_id, "cv", ext)
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8") as tmp:
            tmp.write(text)
            temp = tmp.name
        return storage.upload_file(temp, sub.cv_id, "cv", ".txt")
    except Exception as exc:  # noqa: BLE001 - the CV is still usable without its original
        logger.warning(f"Could not persist the original file for {sub.cv_id}: {exc}")
        return None
    finally:
        if temp and os.path.exists(temp):
            try:
                os.unlink(temp)
            except OSError:
                pass
