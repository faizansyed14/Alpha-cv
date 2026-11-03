"""CV Routes - Consolidated CV API endpoints.

Handles ALL CV operations: upload, processing, listing, and management.
Single responsibility: CV document management through REST API.
"""

import asyncio
import logging
from qdrant_client.http.models import FieldCondition, Filter, MatchValue, MatchAny
import os
import re
import time
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Form, UploadFile, Query
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from app.config.settings import settings
from app.api.deps import require_admin, require_core_app
from app.models.user import User
from app.ingestion.cv_parser import get_parsing_service
from app.ingestion.pipeline import SOURCE_UPLOAD, CVSubmission, IngestError, ingest_cv
from app.ingestion.preview import render_page_png
from app.providers.llm.service import get_llm_service
from app.providers.embeddings.service import get_embedding_service
from app.providers.vectorstore.qdrant import CV_PAYLOAD, get_qdrant_utils, get_decompressed_content, resolve_candidate_full_name, resolve_candidate_contact
from app.providers.storage import get_storage_service
from app.providers.cache.memory import get_cache_service
from app.ingestion.skill_keywords import extract_skill_keywords
from app.schemas.cv_search import CVAdvancedSearchRequest, CVAdvancedSearchResponse, CVSearchResultItem
# at top of the file
import mimetypes
import shutil
from io import BytesIO

STORAGE_DIR = settings.CV_UPLOAD_DIR
os.makedirs(STORAGE_DIR, exist_ok=True)
logger = logging.getLogger(__name__)
from app.ingestion.boolean_query import BooleanQueryError
router = APIRouter()

# Constants
MAX_FILE_SIZE = settings.max_file_size_bytes

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _invalidate_match_caches(cv_id: str) -> None:
    """Drop in-process matching caches for a CV after delete/reprocess."""
    try:
        from app.matching.engine import get_matching_service
        get_matching_service().invalidate_document_cache(cv_id, "cv")
    except Exception:
        pass


def _validate_doc_id(doc_id: str) -> str:
    """Reject ids that could be used for path traversal when building file paths."""
    if not doc_id or not _SAFE_ID_RE.match(doc_id):
        raise HTTPException(status_code=400, detail="Invalid document id")
    return doc_id
SUPPORTED_EXTENSIONS = get_parsing_service().SUPPORTED_EXTENSIONS

# Kept as an alias so existing call sites in this file don't need to change.
_extract_skill_keywords = extract_skill_keywords


class StandardizeCVRequest(BaseModel):
    cv_text: str
    cv_filename: str = "cv.txt"


class NoteRequest(BaseModel):
    note: str = Field(..., min_length=1, max_length=5000)
    # Ignored: the author is always the signed-in user (it used to be trusted from here, so anyone could write as
    # anyone). Kept optional so older clients that still send it keep working.
    hr_user: Optional[str] = None


def _now_iso() -> str:
    return datetime.utcnow().isoformat()

# ----------------------------
# CV Upload Progress Tracking
# ----------------------------

# Global progress tracking for CV uploads (in production, use Redis)
_cv_upload_progress = {}

@router.get("/cv-upload-progress/{cv_id}")
async def get_cv_upload_progress(cv_id: str, _: User = Depends(require_core_app)):
    """
    Get real-time progress of CV upload processing.
    """
    try:
        progress = _cv_upload_progress.get(cv_id, {})
        if not progress:
            from app.jobs.public_cv_queue import get_public_job_status

            queued = await asyncio.to_thread(get_public_job_status, cv_id)
            if queued:
                progress = {**queued, "current_step": queued.get("current_step") or queued.get("error") or ""}
        return JSONResponse({
            "cv_id": cv_id,
            "status": progress.get("status", "not_found"),
            "progress_percent": progress.get("progress_percent", 0),
            "current_step": progress.get("current_step", ""),
            "filename": progress.get("filename", ""),
            "start_time": progress.get("start_time"),
            "estimated_completion": progress.get("estimated_completion"),
            "processing_stats": progress.get("processing_stats", {}),
            "ocr_used": progress.get("ocr_used", False)  # Track if OCR is being used
        })
    except Exception as e:
        logger.error(f"Failed to get CV upload progress: {e}")
        raise HTTPException(status_code=500, detail=f"Progress tracking error: {str(e)}")

def update_cv_upload_progress(cv_id: str, **kwargs):
    """Update CV upload progress."""
    if cv_id not in _cv_upload_progress:
        _cv_upload_progress[cv_id] = {}
    _cv_upload_progress[cv_id].update(kwargs)

async def _try_queue_upload(tmp_path: str, cv_id: str, filename: str, file_ext: str) -> bool:
    """Hand an uploaded file to the ingest worker. False (nothing changed) when queueing is not possible, in which
    case the caller processes the file itself exactly as before."""
    from app.jobs.public_cv_queue import enqueue_job, ingest_worker_online
    from app.ingestion.upload_job import KIND_CV_UPLOAD

    if not settings.ENABLE_INGEST_QUEUE:
        return False
    if not await asyncio.to_thread(ingest_worker_online):
        return False
    try:
        persisted = await asyncio.to_thread(get_storage_service().upload_file, tmp_path, cv_id, "cv", file_ext)
        await asyncio.to_thread(enqueue_job, {
            "kind": KIND_CV_UPLOAD, "application_id": cv_id, "filename": filename, "persisted_path": persisted,
            "mime_type": mimetypes.guess_type(filename)[0] or "application/octet-stream"})
    except Exception as exc:  # noqa: BLE001 - fall back to processing here rather than failing the upload
        logger.warning(f"Could not queue upload {filename}: {exc}")
        return False
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    return True


@router.post("/upload-cv")
async def upload_cv(
    file: Optional[UploadFile] = File(None),
    cv_text: Optional[str] = Form(None),
    background_processing: bool = Form(False),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    try:
        logger.info("---------- CV UPLOAD START ----------")
        parsing_service = get_parsing_service()
        raw_content = ""
        extracted_text = ""
        filename = "text_input.txt"
        file_ext = ".txt"
        extracted_pii = {"email": [], "phone": []}  # Initialize PII container
        
        # Generate the CV ID up front: the OCR progress update below needs it before the text is ready.
        cv_id = str(uuid.uuid4())

        if file:
            logger.info(f"Processing CV file upload: {file.filename}")
            if not file.filename:
                raise HTTPException(status_code=400, detail="No filename provided")
            file_ext = os.path.splitext(file.filename)[1].lower()
            if file_ext not in SUPPORTED_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {file_ext}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}"
                )
            # size check
            file.file.seek(0, 2)
            size = file.file.tell()
            file.file.seek(0)
            if size > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail=f"File too large: {size} bytes (max: {MAX_FILE_SIZE})")
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                shutil.copyfileobj(file.file, tmp)
                tmp_path = tmp.name

            # Many files at a time: keep the original, queue the work, and answer at once. The ingest worker does the
            # reading / OCR, LLM, embeddings and storing, several CVs in parallel.
            queued = await _try_queue_upload(tmp_path, cv_id, file.filename, file_ext)
            if queued:
                return JSONResponse({
                    "status": "queued", "message": f"CV '{file.filename}' queued for processing",
                    "cv_id": cv_id, "filename": file.filename, "processing_mode": "queued",
                })
            try:
                parsed = await asyncio.to_thread(parsing_service.process_document, tmp_path, "cv")
                raw_content = parsed["raw_text"]
                extracted_text = parsed["clean_text"]
                filename = file.filename
                # Get PII from parsed document
                extracted_pii = parsed.get("extracted_pii", {"email": [], "phone": []})
                # Check if OCR was used
                ocr_used = parsed.get("ocr_used", False)
                if ocr_used:
                    logger.info(f"OCR was used for processing: {filename}")
                    update_cv_upload_progress(cv_id,
                        status="processing",
                        current_step="Performing OCR (Optical Character Recognition) - This may take longer for image-based documents...",
                        ocr_used=True
                    )
            finally:
                # leave tmp for now; we may copy it into our storage folder below
                pass
        elif cv_text:
            logger.info("Processing CV text input")
            cleaned, extracted_pii = parsing_service.remove_pii_data(cv_text.strip())
            raw_content = cv_text.strip()
            extracted_text = cleaned
            filename = "text_input.txt"
            if len(extracted_text) < 50:
                raise HTTPException(status_code=400, detail="CV text too short (minimum 50 characters required)")
        else:
            raise HTTPException(status_code=400, detail="Either file upload or cv_text must be provided")
        
        logger.info(f"Text ready -> length={len(extracted_text)} (pii removed)")
        logger.info(f"Extracted PII -> emails: {len(extracted_pii.get('email', []))}, phones: {len(extracted_pii.get('phone', []))}")
        
        submission = CVSubmission(
            source=SOURCE_UPLOAD, filename=filename, cv_id=cv_id,
            file_path=tmp_path if file else None, text=None if file else raw_content,
            parsed=parsed if file else {"raw_text": raw_content, "clean_text": extracted_text, "extracted_pii": extracted_pii},
            mime_type=mimetypes.guess_type(filename)[0] or "application/octet-stream",
            progress=lambda percent, step: update_cv_upload_progress(cv_id, progress_percent=percent, current_step=step),
        )

        def run_ingest():
            try:
                return ingest_cv(submission)
            finally:
                if file and tmp_path and os.path.exists(tmp_path):
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

        if background_processing:
            # Same pipeline, just not awaited: the caller polls /cv-upload-progress/{cv_id}
            update_cv_upload_progress(cv_id, status="processing", filename=filename, start_time=time.time(),
                                      progress_percent=0, current_step="Queued", ocr_used=ocr_used)

            async def background():
                try:
                    result = await asyncio.to_thread(run_ingest)
                    update_cv_upload_progress(cv_id, status="completed", progress_percent=100,
                                              current_step="Processing completed successfully!",
                                              estimated_completion=time.time(), processing_stats=result.stats)
                except Exception as exc:  # noqa: BLE001
                    logger.error(f"Background CV processing failed for {cv_id}: {exc}")
                    update_cv_upload_progress(cv_id, status="failed", current_step=str(exc))

            asyncio.create_task(background())
            return JSONResponse({
                "status": "success",
                "message": f"CV '{filename}' queued for background processing",
                "cv_id": cv_id, "filename": filename, "processing_mode": "background",
                "estimated_completion": "2-5 minutes",
            })

        try:
            result = await asyncio.to_thread(run_ingest)
        except IngestError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc))
        logger.info(f"CV processed and stored: {result.cv_id}")
        return JSONResponse({
            "status": "success",
            "message": (f"CV '{filename}' was already in the database; its details were updated"
                        if result.merged else f"CV '{filename}' processed successfully"),
            "cv_id": result.cv_id, "filename": filename, "merged": result.merged,
            "standardized_data": result.standardized, "processing_stats": result.stats,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CV upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"CV processing failed: {e}")


CV_LIST_PAGE = 200   # CVs per API call (default and maximum); the UI shows the same 200 per page
CV_LIST_MAX_IDS = 100_000   # ids_only (no personal data) may ask for more: the match launcher needs up to the whole DB


def _cv_list_page(cvs: List[Dict[str, Any]], limit: int, offset: int, category: Optional[str], q: Optional[str],
                  ids_only: bool) -> Dict[str, Any]:
    page = cvs[offset: offset + limit]
    body: Dict[str, Any] = {"status": "success", "count": len(page), "total": len(cvs), "limit": limit,
                            "offset": offset, "category": category, "q": q}
    if ids_only:
        body["ids"] = [cv["id"] for cv in page]
    else:
        body["cvs"] = page
    return body


def _job_titles(qdrant) -> Dict[str, str]:
    """job_id -> job title for careers applications (shown as "Applied for ...")."""
    out: Dict[str, str] = {}
    try:
        for j in qdrant.get_all_job_postings(include_inactive=True):
            jid = str(j.get("id") or j.get("job_id") or "").strip()
            if not jid:
                continue
            structured = j.get("structured_info") or {}
            title = structured.get("job_title") or j.get("job_title") or ""
            if title:
                out[jid] = str(title)
    except Exception:
        return {}
    return out


def _cv_row(doc_id: str, payload: Dict[str, Any], doc_meta: Dict[str, Any], job_title_by_id: Dict[str, str]) -> Dict[str, Any]:
    """One CV as the Candidates list shows it."""
    structured = payload.get("structured_info", {}) or {}
    skills = structured.get("skills_sentences", structured.get("skills", []))
    resps = structured.get("responsibility_sentences", structured.get("responsibilities", []))

    filename = doc_meta.get("filename", "Unknown")
    if filename and "/" in filename:
        filename = filename.split("/")[-1]

    is_job_application = bool(payload.get("is_job_application", False))
    applied_job_id = str(payload.get("job_id") or "").strip() if is_job_application else ""
    # Persisted match score for the job this candidate applied to (set when a match runs against that job).
    applied_job_match = payload.get("applied_job_match")
    applied_score = applied_job_match.get("overall_score") if isinstance(applied_job_match, dict) else None
    contact = resolve_candidate_contact(payload, structured)
    skills_nonempty = [s for s in skills if isinstance(s, str) and s.strip()][:20]
    keywords_nonempty = [k for k in (structured.get("keywords") or []) if k][:20]
    languages = structured.get("languages") or []
    if not isinstance(languages, list):
        languages = []
    return {
        "id": doc_id,
        "filename": filename,
        "upload_date": doc_meta.get("upload_date", "Unknown"),
        "full_name": resolve_candidate_full_name(payload, structured),
        "job_title": structured.get("job_title", "Not specified"),
        "years_of_experience": structured.get("years_of_experience", structured.get("experience_years", "Not specified")),
        "skills_count": len(skills_nonempty),
        "skills": skills_nonempty,
        # LLM-generated keywords: also the exact field the advanced CV search filters against.
        "skill_keywords": keywords_nonempty,
        "responsibilities_count": len(resps),
        "has_structured_data": True,
        "category": structured.get("category", "General"),
        "is_job_application": is_job_application,
        "applied_job_id": applied_job_id or None,
        "applied_job_title": (job_title_by_id.get(applied_job_id) if applied_job_id else None),
        "match_score": applied_score,
        "is_top_for_job": False,  # set by _mark_top_applicants
        "location": payload.get("location") or structured.get("location"),
        "notice_period": payload.get("notice_period"),
        "nationality": payload.get("nationality"),
        "gender": structured.get("gender"),
        "languages": [str(x).strip() for x in languages if str(x).strip()][:20],
        "email": contact.get("email"),
        "phone": contact.get("phone"),
        "job_application": {
            "expected_salary": payload.get("expected_salary"),
        } if is_job_application else None,
    }


def _mark_top_applicants(rows: List[Dict[str, Any]]) -> None:
    """Rank applicants within each job by their persisted match score; the best gets the green "#1" badge."""
    by_job: Dict[str, List[Dict[str, Any]]] = {}
    for cv in rows:
        jid = cv.get("applied_job_id")
        if jid and cv.get("match_score") is not None:
            by_job.setdefault(jid, []).append(cv)
    for group in by_job.values():
        group.sort(key=lambda c: c.get("match_score") or 0, reverse=True)
        for rank, cv in enumerate(group, start=1):
            cv["match_rank"] = rank
            cv["is_top_for_job"] = rank == 1


def _applicant_ranks(qdrant) -> Dict[str, int]:
    """cv_id -> rank among the applicants of its job (1 = best), for applicants that have a persisted score.
    Reads only the applicants (job id + score), not every CV. Cached briefly."""
    cache = get_cache_service()
    cached = cache.get("applicant_ranks", namespace="cv_data")
    if cached is not None:
        return cached
    scored: Dict[str, List[tuple]] = {}
    offset = None
    while True:
        points, offset = qdrant.client.scroll(
            "cv_structured", limit=1000, offset=offset, with_vectors=False,
            scroll_filter=Filter(must=[FieldCondition(key="is_job_application", match=MatchValue(value=True))]),
            with_payload=["job_id", "applied_job_match"])
        for p in points:
            pl = p.payload or {}
            match = pl.get("applied_job_match")
            jid = str(pl.get("job_id") or "").strip()
            if jid and isinstance(match, dict) and match.get("overall_score") is not None:
                scored.setdefault(jid, []).append((float(match["overall_score"]), str(p.id)))
        if not offset:
            break
    ranks: Dict[str, int] = {}
    for group in scored.values():
        group.sort(key=lambda t: t[0], reverse=True)
        for rank, (_, cv_id) in enumerate(group, start=1):
            ranks[cv_id] = rank
    cache.set("applicant_ranks", ranks, ttl_seconds=60, namespace="cv_data")
    return ranks


def _rows_for_ids(qdrant, ids: List[str]) -> List[Dict[str, Any]]:
    """The full list rows for one page of ids: two batched reads (structured data + document metadata)."""
    if not ids:
        return []
    structs = {str(p.id): (p.payload or {}) for p in qdrant.client.retrieve(
        "cv_structured", ids=ids, with_payload=CV_PAYLOAD, with_vectors=False)}
    docs = {str(p.id): (p.payload or {}) for p in qdrant.client.retrieve(
        "cv_documents", ids=ids, with_payload=["id", "filename", "upload_date"], with_vectors=False)}
    titles = _job_titles(qdrant)
    ranks = _applicant_ranks(qdrant)
    rows = []
    for cv_id in ids:
        if cv_id not in structs:
            continue  # deleted between the id read and this one
        row = _cv_row(cv_id, structs[cv_id], docs.get(cv_id, {}), titles)
        rank = ranks.get(cv_id)
        if rank is not None:
            row["match_rank"], row["is_top_for_job"] = rank, rank == 1
        rows.append(row)
    return rows


def _matches_search(cv: Dict[str, Any], needle: str) -> bool:
    return (
        needle in str(cv.get("full_name") or "").lower()
        or needle in str(cv.get("job_title") or "").lower()
        or needle in str(cv.get("filename") or "").lower()
        or needle in str(cv.get("id") or "").lower()
    )


def _build_full_cv_list(qdrant) -> List[Dict[str, Any]]:
    """Every CV as a list row, newest first. Reads the WHOLE collection (about 20 s at 30,000 CVs), so it is only used
    for the basic search box and until uploaded_at has been backfilled; plain browsing pages through Qdrant instead."""
    titles = _job_titles(qdrant)

    structured_points = []
    offset = None
    while True:
        points, offset = qdrant.client.scroll("cv_structured", limit=200, offset=offset, with_payload=CV_PAYLOAD,
                                              with_vectors=False)
        structured_points.extend(points)
        if not offset:
            break

    docs_map: Dict[str, Dict[str, Any]] = {}
    offset = None
    while True:
        points, offset = qdrant.client.scroll("cv_documents", limit=500, offset=offset,
                                              with_payload=["id", "filename", "upload_date"], with_vectors=False)
        for p in points:
            payload = p.payload or {}
            docs_map[payload.get("id") or str(p.id)] = payload
        if not offset:
            break

    rows = [_cv_row(str(p.id), p.payload or {}, docs_map.get(str(p.id), {}), titles) for p in structured_points]
    _mark_top_applicants(rows)
    rows.sort(key=lambda x: x.get("upload_date", ""), reverse=True)
    return rows


@router.get("/cvs")
async def list_cvs(
    limit: Optional[int] = Query(None, ge=1, description=f"Page size (default and max {CV_LIST_PAGE})"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    category: Optional[str] = Query(None, description="Filter by CV category (folder)"),
    q: Optional[str] = Query(None, description="Case-insensitive search across name/title/filename/id"),
    ids_only: bool = Query(False, description="Return only CV ids (no contact data); pages up to the whole database"),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    """
    List CVs, newest first, one page per call (200). Browsing and the category folders are served by Qdrant itself
    (count + sorted, indexed paging), so the cost does not grow with the number of CVs. The basic search box and
    the period before uploaded_at has been backfilled use a cached scan of the whole collection instead.

    One call never returns the whole database: it used to hand every candidate's name, email and phone to any
    account. The match launcher, which only needs ids, asks for ids_only.
    """
    max_limit = CV_LIST_MAX_IDS if ids_only else CV_LIST_PAGE
    limit = min(limit or max_limit, max_limit)
    searching = bool(q and q.strip())
    try:
        qdrant = get_qdrant_utils()

        # ---- fast path: Qdrant counts, sorts and pages ----
        if not searching and await asyncio.to_thread(qdrant.uploaded_at_ready):
            total = await asyncio.to_thread(qdrant.count_cvs, category)
            ids = await asyncio.to_thread(qdrant.list_cv_ids_newest_first, offset, limit, category)
            body: Dict[str, Any] = {"status": "success", "count": len(ids), "total": total, "limit": limit,
                                    "offset": offset, "category": category, "q": q}
            if ids_only:
                body["ids"] = ids
            else:
                body["cvs"] = await asyncio.to_thread(_rows_for_ids, qdrant, ids)
                body["count"] = len(body["cvs"])
            return JSONResponse(body)

        # ---- fallback: the cached full list ----
        cache = get_cache_service()
        cached = cache.get("cv_list", namespace="cv_data")
        if cached is None:
            all_rows = await asyncio.to_thread(_build_full_cv_list, qdrant)
            cache.set("cv_list", {"status": "success", "count": len(all_rows), "cvs": all_rows}, ttl_seconds=60, namespace="cv_data")
        else:
            all_rows = cached.get("cvs", [])
        rows = all_rows
        if category:
            rows = [cv for cv in rows if (cv.get("category") or "General") == category]
        if searching:
            needle = q.strip().lower()
            rows = [cv for cv in rows if _matches_search(cv, needle)]
        return JSONResponse(_cv_list_page(rows, limit, offset, category, q, ids_only))

    except Exception as e:
        logger.error(f"Failed to list CVs: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list CVs: {e}")


@router.get("/categories")
async def get_categories(_: User = Depends(require_core_app)):
    """
    Get all CV categories with their counts.
    """
    try:
        qdrant = get_qdrant_utils()
        categories = qdrant.get_categories_with_counts()
        return JSONResponse(content={"categories": categories})
    except Exception as e:
        logger.error(f"Failed to get categories: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get categories: {str(e)}")

@router.get("/cvs/category/{category}")
async def get_cvs_by_category(category: str, _: User = Depends(require_admin)):
    """
    Get all CVs in a specific category.
    """
    try:
        qdrant = get_qdrant_utils()
        cvs = qdrant.list_cvs_by_category(category)
        return JSONResponse(content={"cvs": cvs, "category": category, "count": len(cvs)})
    except Exception as e:
        logger.error(f"Failed to get CVs by category {category}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get CVs by category: {str(e)}")


@router.get("/keyword-search")
async def keyword_search_cvs(
    keywords: str = Query(..., description="Comma/space separated keywords, e.g. 'python, owasp, aws'"),
    category: Optional[str] = Query(None, description="Optional category filter"),
    match_all: bool = Query(False, description="If true, a CV must contain ALL keywords; default is ANY"),
    limit: Optional[int] = Query(None, ge=1, description="Optional cap on results"),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    """
    Keyword search across the ENTIRE CV database.

    Enter one or more keywords (e.g. "python, owasp, aws"). Each CV's full searchable
    text, name, job title, category, every skill & responsibility sentence, and the
    raw extracted document text, is scanned, and CVs containing the keyword(s) are
    returned, ranked by how many distinct keywords matched (most first). By default a
    CV matches if it contains ANY keyword; pass match_all=true for AND.
    """
    try:
        # Parse keywords. Comma/newline separate phrases ("machine learning"); we keep
        # each comma-separated phrase intact and search it as a substring.
        search_terms: List[str] = []
        pseen = set()
        for chunk in re.split(r"[,\n]+", keywords or ""):
            p = " ".join(chunk.strip().lower().split())
            if p and p not in pseen:
                pseen.add(p)
                search_terms.append(p)
        if not search_terms:
            raise HTTPException(status_code=400, detail="Provide at least one keyword")

        qdrant = get_qdrant_utils()

        # job_id -> job_title for applied-job display
        job_title_by_id: Dict[str, str] = {}
        try:
            for j in qdrant.get_all_job_postings(include_inactive=True):
                jid = str(j.get("id") or j.get("job_id") or "").strip()
                structured = j.get("structured_info") or {}
                title = structured.get("job_title") or j.get("job_title") or ""
                if jid and title:
                    job_title_by_id[jid] = str(title)
        except Exception:
            job_title_by_id = {}

        # Raw document text per CV (filename/upload_date + decompressed content for deep search).
        docs_map: Dict[str, Dict[str, Any]] = {}
        raw_text_map: Dict[str, str] = {}
        scroll_offset = None
        while True:
            points, next_offset = qdrant.client.scroll(
                collection_name="cv_documents", limit=200, offset=scroll_offset,
                with_payload=True, with_vectors=False,
            )
            for p in points:
                payload = p.payload or {}
                doc_id = str(payload.get("id") or p.id)
                docs_map[doc_id] = payload
                try:
                    txt = get_decompressed_content(payload) or ""
                    if txt:
                        raw_text_map[doc_id] = txt[:30000].lower()
                except Exception:
                    pass
            if not next_offset:
                break
            scroll_offset = next_offset

        # Scan structured CVs.
        results: List[Dict[str, Any]] = []
        scroll_offset = None
        while True:
            points, next_offset = qdrant.client.scroll(
                collection_name="cv_structured", limit=200, offset=scroll_offset,
                with_payload=CV_PAYLOAD, with_vectors=False,
            )
            for p in points:
                payload = p.payload or {}
                doc_id = str(p.id)
                structured = payload.get("structured_info", {}) or {}
                cat = structured.get("category", "General")
                if category and (cat or "General") != category:
                    continue

                skills = structured.get("skills_sentences", structured.get("skills", [])) or []
                resps = structured.get("responsibility_sentences", structured.get("responsibilities", [])) or []
                full_name = resolve_candidate_full_name(payload, structured)
                job_title = structured.get("job_title", "")

                blob = " ".join([
                    str(full_name), str(job_title), str(cat),
                    " ".join(str(s) for s in skills),
                    " ".join(str(r) for r in resps),
                    raw_text_map.get(doc_id, ""),
                ]).lower()

                matched = [t for t in search_terms if t in blob]
                if not matched:
                    continue
                if match_all and len(matched) < len(search_terms):
                    continue

                doc_meta = docs_map.get(doc_id, {})
                filename = doc_meta.get("filename", "Unknown")
                if filename and "/" in filename:
                    filename = filename.split("/")[-1]

                is_job_application = bool(payload.get("is_job_application", False))
                applied_job_id = str(payload.get("job_id") or "").strip() if is_job_application else ""
                # applied_job_match is only ever written for a CV's own applied job.
                applied_job_match = payload.get("applied_job_match")
                applied_score = applied_job_match.get("overall_score") if isinstance(applied_job_match, dict) else None
                contact = resolve_candidate_contact(payload, structured)
                skills_nonempty = [s for s in skills if isinstance(s, str) and s.strip()][:20]
                keywords_nonempty = [k for k in (structured.get("keywords") or []) if k][:20]
                languages = structured.get("languages") or []
                if not isinstance(languages, list):
                    languages = []

                results.append({
                    "id": doc_id,
                    "filename": filename,
                    "upload_date": doc_meta.get("upload_date", "Unknown"),
                    "full_name": full_name or "Not specified",
                    "job_title": job_title or "Not specified",
                    "years_of_experience": structured.get("years_of_experience", structured.get("experience_years", "Not specified")),
                    "skills_count": len(skills_nonempty),
                    "skills": skills_nonempty,
                    "skill_keywords": keywords_nonempty,
                    "responsibilities_count": len(resps),
                    "has_structured_data": True,
                    "category": cat,
                    "is_job_application": is_job_application,
                    "applied_job_id": applied_job_id or None,
                    "applied_job_title": (job_title_by_id.get(applied_job_id) if applied_job_id else None),
                    "match_score": applied_score,
                    "matched_keywords": matched,
                    "matched_count": len(matched),
                    "location": payload.get("location") or structured.get("location"),
                    "nationality": payload.get("nationality"),
                    "gender": structured.get("gender"),
                    "languages": [str(x).strip() for x in languages if str(x).strip()][:20],
                    "email": contact.get("email"),
                    "phone": contact.get("phone"),
                    "job_application": {"expected_salary": payload.get("expected_salary")} if is_job_application else None,
                })
            if not next_offset:
                break
            scroll_offset = next_offset

        # Rank: most keywords matched first, then most recent.
        results.sort(key=lambda c: (c["matched_count"], str(c.get("upload_date") or "")), reverse=True)
        total = len(results)
        if limit is not None:
            results = results[:limit]

        return JSONResponse({
            "status": "success",
            "count": len(results),
            "total": total,
            "keywords": search_terms,
            "match_all": match_all,
            "cvs": results,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Keyword search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Keyword search failed: {e}")


@router.get("/search/facets/{field}")
async def get_cv_search_facet(
    field: str,
    limit: int = Query(200, ge=1, le=1000),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    """
    Distinct values + counts for a filterable field (location, nationality,
    notice_period, keywords), across every CV, feeds the searchable checkbox
    lists and the keyword-search autocomplete in the advanced search modal.
    See QdrantUtils.CV_FACET_FIELDS for the allowlist. `keywords` defaults to
    a higher limit than the others since its vocabulary is naturally larger
    (up to 20 LLM-extracted terms per CV vs. one location/nationality each).
    """
    qdrant = get_qdrant_utils()
    if field not in qdrant.CV_FACET_FIELDS:
        raise HTTPException(status_code=400, detail=f"Unsupported facet field: {field}")
    effective_limit = max(limit, 500) if field == "keywords" else limit
    values = qdrant.get_cv_facet(field, limit=effective_limit)
    values.sort(key=lambda v: -v["count"])
    return JSONResponse({"field": field, "values": values})


@router.post("/search/advanced", response_model=CVAdvancedSearchResponse)
async def search_cvs_advanced(
    req: CVAdvancedSearchRequest,
    _: User = Depends(require_core_app),
) -> CVAdvancedSearchResponse:
    """
    Advanced CV search (keywords + experience range + location + nationality),
    evaluated server-side against the whole cv_structured collection via
    indexed Qdrant filters (see QdrantUtils.search_cvs_advanced for the
    matching rules). Paginated with an opaque cursor: pass the previous
    response's next_cursor back in to get the next page (the frontend's
    "load 50, then fetch more as you scroll" flow).
    """
    try:
        qdrant = get_qdrant_utils()

        job_title_by_id: Dict[str, str] = {}
        try:
            for j in qdrant.get_all_job_postings(include_inactive=True):
                jid = str(j.get("id") or j.get("job_id") or "").strip()
                structured_jd = j.get("structured_info") or {}
                title = structured_jd.get("job_title") or j.get("job_title") or ""
                if jid and title:
                    job_title_by_id[jid] = str(title)
        except Exception:
            job_title_by_id = {}

        found = qdrant.search_cvs_advanced(
            keywords=req.keywords,
            match_all=req.match_all,
            experience_min=req.experience_min,
            experience_max=req.experience_max,
            locations=req.locations,
            nationalities=req.nationalities,
            limit=req.limit,
            cursor=req.cursor,
            with_total=not req.cursor,
            boolean_query=req.boolean_query,
        )
        points = [p for p, _ in found["points"]]
        matched_by_id = {str(p.id): matched for p, matched in found["points"]}

        doc_ids = [str(p.id) for p in points]
        docs_map: Dict[str, Dict[str, Any]] = {}
        if doc_ids:
            docs_points, _ = qdrant.client.scroll(
                collection_name="cv_documents",
                scroll_filter=Filter(must=[FieldCondition(key="id", match=MatchValue(value=doc_ids[0]))])
                if len(doc_ids) == 1 else Filter(must=[FieldCondition(key="id", match=MatchAny(any=doc_ids))]),
                limit=len(doc_ids),
                with_payload=True,
                with_vectors=False,
            )
            docs_map = {str(p.id): (p.payload or {}) for p in docs_points}

        results: List[CVSearchResultItem] = []
        for p in points:
            doc_id = str(p.id)
            payload = p.payload or {}
            structured = payload.get("structured_info", {}) or {}
            doc_meta = docs_map.get(doc_id, {})

            filename = doc_meta.get("filename", "Unknown")
            if filename and "/" in filename:
                filename = filename.split("/")[-1]

            is_job_application = bool(payload.get("is_job_application", False))
            applied_job_id = str(payload.get("job_id") or "").strip() if is_job_application else ""
            applied_job_match = payload.get("applied_job_match")
            applied_score = applied_job_match.get("overall_score") if isinstance(applied_job_match, dict) else None

            skills_src = structured.get("skills_sentences", structured.get("skills", [])) or []
            skills_nonempty = [s for s in skills_src if isinstance(s, str) and s.strip()][:20]
            languages = structured.get("languages") or []
            if not isinstance(languages, list):
                languages = []
            contact = resolve_candidate_contact(payload, structured)

            results.append(CVSearchResultItem(
                id=doc_id,
                filename=filename,
                upload_date=doc_meta.get("upload_date", "Unknown"),
                full_name=resolve_candidate_full_name(payload, structured),
                job_title=structured.get("job_title") or "Not specified",
                years_of_experience=structured.get("years_of_experience", structured.get("experience_years", "Not specified")),
                category=structured.get("category", "General"),
                skills=skills_nonempty,
                skill_keywords=[k for k in (structured.get("keywords") or []) if k][:20],
                location=payload.get("location") or structured.get("location"),
                nationality=payload.get("nationality"),
                notice_period=payload.get("notice_period"),
                gender=structured.get("gender"),
                languages=[str(x).strip() for x in languages if str(x).strip()][:20],
                email=contact.get("email"),
                phone=contact.get("phone"),
                is_job_application=is_job_application,
                applied_job_id=applied_job_id or None,
                applied_job_title=(job_title_by_id.get(applied_job_id) if applied_job_id else None),
                match_score=applied_score,
                matched_keywords=matched_by_id.get(doc_id, []),
            ))

        return CVAdvancedSearchResponse(results=results, next_cursor=found["next_cursor"], count=len(results),
                                        total=found["total"], total_is_estimate=found["total_is_estimate"])
    except BooleanQueryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Advanced CV search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Advanced CV search failed: {e}")


@router.get("/{cv_id}")
async def get_cv_details(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Get details for a specific CV.
    Combines cv_structured + cv_documents + cv_embeddings stats.
    Also handles job application CVs (stored with application_id as document_id).
    """
    try:
        logger.info(f"Starting get_cv_details for CV: {cv_id}")
        qdrant = get_qdrant_utils()

        # Structured data
        s = qdrant.client.retrieve("cv_structured", ids=[cv_id], with_payload=CV_PAYLOAD, with_vectors=False)
        if not s:
            logger.error(f"CV not found in cv_structured collection: {cv_id}")
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        structured_payload = s[0].payload or {}
        logger.info(f"Found CV in cv_structured: {cv_id}, payload keys: {list(structured_payload.keys())}")
        
        # Check if this is a job application CV (has is_job_application flag)
        is_job_application = structured_payload.get("is_job_application", False)
        logger.info(f"CV {cv_id} is_job_application: {is_job_application}")
        
        if is_job_application:
            # For job applications, the structured data is still nested under structured_info
            # but we also have application-specific fields in the main payload
            structured = structured_payload.get("structured_info", structured_payload)
        else:
            # For regular CVs, structured data is nested under structured_info
            structured = structured_payload.get("structured_info", structured_payload)

        # Doc meta
        d = qdrant.client.retrieve("cv_documents", ids=[cv_id], with_payload=True, with_vectors=False)
        doc_meta = (d[0].payload if d else {}) or {}

        # Embedding info - handle both optimized and legacy storage
        try:
            # Try optimized single-point retrieval first
            emb_point = qdrant.client.retrieve(
                collection_name="cv_embeddings",
                ids=[cv_id],
                with_payload=True,
                with_vectors=False
            )
            
            if emb_point and len(emb_point) > 0:
                payload = emb_point[0].payload
                if payload and "vector_structure" in payload:
                    # Optimized storage - single point with vector_structure
                    vector_structure = payload["vector_structure"]
                    skills_count = len(vector_structure.get("skill_vectors", []))
                    resp_count = len(vector_structure.get("responsibility_vectors", []))
                    has_title = len(vector_structure.get("job_title_vector", [])) > 0
                    has_exp = len(vector_structure.get("experience_vector", [])) > 0
                    # Get dimension from first skill vector if available
                    dim = len(vector_structure.get("skill_vectors", [[]])[0]) if vector_structure.get("skill_vectors") else 0
                else:
                    # Legacy storage - multiple points
                    emb_points, _ = qdrant.client.scroll(
                        collection_name="cv_embeddings",
                        scroll_filter=Filter(must=[FieldCondition(key="id", match=MatchValue(value=cv_id))]),
                        limit=100,
                        with_payload=True,
                        with_vectors=True
                    )
                    skills_count = len([p for p in emb_points if (p.payload or {}).get("vector_type") == "skill"])
                    resp_count = len([p for p in emb_points if (p.payload or {}).get("vector_type") == "responsibility"])
                    has_title = any((p.payload or {}).get("vector_type") == "job_title" for p in emb_points)
                    has_exp = any((p.payload or {}).get("vector_type") == "experience" for p in emb_points)
                    dim = 0
                    for p in emb_points:
                        if isinstance(p.vector, list):
                            dim = len(p.vector)
                            break
            else:
                # No embeddings found
                skills_count = resp_count = 0
                has_title = has_exp = False
                dim = 0
        except Exception as e:
            logger.warning(f"Failed to get embeddings info for {cv_id}: {e}")
            skills_count = resp_count = 0
            has_title = has_exp = False
            dim = 0

        # Handle both old and new data structures
        skills = structured.get("skills_sentences", structured.get("skills", []))
        responsibilities = structured.get("responsibility_sentences", structured.get("responsibilities", []))

        # Create optimized structured_info without duplicates
        optimized_structured = structured.copy()
        # Remove duplicate skills and responsibilities from structured_info
        # Frontend should use candidate.skills and candidate.responsibilities instead
        if "skills" in optimized_structured:
            del optimized_structured["skills"]
        if "responsibilities" in optimized_structured:
            del optimized_structured["responsibilities"]

        response = {
            "id": cv_id,
            "filename": doc_meta.get("filename", "Unknown"),
            "upload_date": doc_meta.get("upload_date", "Unknown"),
            "document_type": "cv",
            "is_job_application": is_job_application,
            "candidate": {
                "full_name": resolve_candidate_full_name(structured_payload, structured),
                "job_title": structured.get("job_title", "Not specified"),
                "years_of_experience": structured.get("years_of_experience", structured.get("experience_years", "Not specified")),
                "skills": skills,
                "responsibilities": responsibilities,
                "skills_count": len(skills),
                "responsibilities_count": len(responsibilities),
                "contact_info": structured.get("contact_info", {}),
                "expected_salary": structured_payload.get("expected_salary") or structured.get("expected_salary"),
                "gender": structured.get("gender"),
                "languages": [
                    str(x).strip() for x in (structured.get("languages") or [])
                    if str(x).strip()
                ][:20] if isinstance(structured.get("languages"), list) else [],
                "location": structured_payload.get("location") or structured.get("location"),
                "nationality": structured_payload.get("nationality") or structured.get("nationality"),
            },
            "job_application": {
                "expected_salary": structured_payload.get("expected_salary"),
                "years_of_experience": structured_payload.get("years_of_experience"),
                "experience_warning": structured_payload.get("experience_warning"),
                "applicant_name": structured_payload.get("applicant_name"),
                "applicant_email": structured_payload.get("applicant_email"),
                "applicant_phone": structured_payload.get("applicant_phone"),
                "application_date": structured_payload.get("application_date"),
                "application_status": structured_payload.get("application_status"),
                "job_id": structured_payload.get("job_id"),
            } if is_job_application else None,
            "embeddings_info": {
                "skills_embeddings": skills_count,
                "responsibilities_embeddings": resp_count,
                "has_title_embedding": has_title,
                "has_experience_embedding": has_exp,
                "embedding_dimension": dim,
            },
            "structured_info": optimized_structured,
            "processing_metadata": structured.get("processing_metadata", {})
        }

        # Add job application specific data if this is a job application
        if is_job_application:
            response["job_application"] = {
                "job_id": structured_payload.get("job_id"),
                "applicant_name": structured_payload.get("applicant_name"),
                "applicant_email": structured_payload.get("applicant_email"),
                "applicant_phone": structured_payload.get("applicant_phone"),
                "application_date": structured_payload.get("application_date"),
                "application_status": structured_payload.get("application_status"),
                "cover_letter": structured_payload.get("cover_letter"),
                "cv_filename": structured_payload.get("cv_filename"),
                "expected_salary": structured_payload.get("expected_salary"),
                "years_of_experience": structured_payload.get("years_of_experience"),
                "location": structured_payload.get("location"),
                "notice_period": structured_payload.get("notice_period"),
                "nationality": structured_payload.get("nationality")
            }

        return JSONResponse({"status": "success", "cv": response})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get CV details: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get CV details: {e}")


@router.delete("/{cv_id}")
async def delete_cv(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Delete a CV and all associated data across:
      - cv_documents
      - cv_structured
      - cv_embeddings (all vectors with document_id == cv_id)
      - S3 file storage
    """
    try:
        qdrant = get_qdrant_utils()

        # Check existence and get file info
        s = qdrant.client.retrieve("cv_structured", ids=[cv_id], with_payload=CV_PAYLOAD)
        if not s:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        
        doc_payload = (qdrant.client.retrieve("cv_documents", ids=[cv_id], with_payload=True) or [{}])[0].payload
        filename = doc_payload.get("filename", cv_id)
        file_path = doc_payload.get("file_path", "")
        
        # Delete from S3 if stored there
        if file_path and file_path.startswith('s3://'):
            try:
                s3_service = get_storage_service()
                file_ext = os.path.splitext(filename)[1] or '.pdf'
                s3_service.delete_file(cv_id, "cv", file_ext)
                logger.info(f"Deleted CV file from S3: {cv_id}")
            except Exception as e:
                logger.warning(f"Failed to delete CV from S3: {e}")

        # Delete embedding points
        emb_points, _ = qdrant.client.scroll(
            collection_name="cv_embeddings",
            scroll_filter=Filter(must=[FieldCondition(key="id", match=MatchValue(value=cv_id))]),
            limit=1000,
            with_payload=False,
            with_vectors=False
        )
        emb_ids = [str(p.id) for p in emb_points]
        if emb_ids:
            qdrant.client.delete(collection_name="cv_embeddings", points_selector=emb_ids)

        # Delete structured + document
        qdrant.client.delete(collection_name="cv_structured", points_selector=[cv_id])
        qdrant.client.delete(collection_name="cv_documents", points_selector=[cv_id])

        # Invalidate CV list cache since we deleted a CV
        cache = get_cache_service()
        cache.delete("cv_list", namespace="cv_data")
        _invalidate_match_caches(cv_id)
        logger.debug("Invalidated CV list cache after deletion")

        return JSONResponse({
            "status": "success",
            "message": f"CV '{filename}' deleted successfully",
            "deleted_cv_id": cv_id
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete CV: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete CV: {e}")


@router.get("/{cv_id}/embeddings")
async def get_cv_embeddings_info(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Get detailed embeddings information for a CV from cv_embeddings.
    """
    try:
        qdrant = get_qdrant_utils()

        # Verify CV exists
        s = qdrant.client.retrieve("cv_structured", ids=[cv_id], with_payload=CV_PAYLOAD)
        if not s:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")

        # Try optimized single-point retrieval first
        try:
            emb_point = qdrant.client.retrieve(
                collection_name="cv_embeddings",
                ids=[cv_id],
                with_payload=True,
                with_vectors=False
            )
            
            info = {
                "cv_id": cv_id,
                "embeddings_found": False,
                "skills": {"count": 0, "embedding_dimension": 0},
                "responsibilities": {"count": 0, "embedding_dimension": 0},
                "title_embedding": False,
                "experience_embedding": False,
                "total_embeddings": 0
            }
            
            if emb_point and len(emb_point) > 0:
                payload = emb_point[0].payload
                if payload and "vector_structure" in payload:
                    # Optimized storage - single point with vector_structure
                    vector_structure = payload["vector_structure"]
                    info["embeddings_found"] = True
                    info["skills"]["count"] = len(vector_structure.get("skill_vectors", []))
                    info["responsibilities"]["count"] = len(vector_structure.get("responsibility_vectors", []))
                    info["title_embedding"] = len(vector_structure.get("job_title_vector", [])) > 0
                    info["experience_embedding"] = len(vector_structure.get("experience_vector", [])) > 0
                    
                    # Get dimensions from first vectors if available
                    if vector_structure.get("skill_vectors"):
                        info["skills"]["embedding_dimension"] = len(vector_structure["skill_vectors"][0])
                    if vector_structure.get("responsibility_vectors"):
                        info["responsibilities"]["embedding_dimension"] = len(vector_structure["responsibility_vectors"][0])
                else:
                    # Legacy storage - multiple points
                    points, _ = qdrant.client.scroll(
                        collection_name="cv_embeddings",
                        scroll_filter=Filter(must=[FieldCondition(key="id", match=MatchValue(value=cv_id))]),
                        limit=2000,
                        with_payload=True,
                        with_vectors=True
                    )
                    
                    info["embeddings_found"] = bool(points)
                    
                    for p in points:
                        pld = p.payload or {}
                        vtype = pld.get("vector_type")
                        if vtype == "skill":
                            info["skills"]["count"] += 1
                            if isinstance(p.vector, list) and not info["skills"]["embedding_dimension"]:
                                info["skills"]["embedding_dimension"] = len(p.vector)
                        elif vtype == "responsibility":
                            info["responsibilities"]["count"] += 1
                            if isinstance(p.vector, list) and not info["responsibilities"]["embedding_dimension"]:
                                info["responsibilities"]["embedding_dimension"] = len(p.vector)
                        elif vtype == "job_title":
                            info["title_embedding"] = True
                        elif vtype == "experience":
                            info["experience_embedding"] = True

            info["total_embeddings"] = info["skills"]["count"] + info["responsibilities"]["count"] + int(info["title_embedding"]) + int(info["experience_embedding"])
            
        except Exception as e:
            logger.warning(f"Failed to get embeddings info for {cv_id}: {e}")
            info = {
                "cv_id": cv_id,
                "embeddings_found": False,
                "skills": {"count": 0, "embedding_dimension": 0},
                "responsibilities": {"count": 0, "embedding_dimension": 0},
                "title_embedding": False,
                "experience_embedding": False,
                "total_embeddings": 0
            }

        return JSONResponse({"status": "success", "embeddings_info": info})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get CV embeddings info: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get CV embeddings info: {e}")


@router.post("/standardize-cv")
async def standardize_cv_text(request: StandardizeCVRequest, _: User = Depends(require_core_app)) -> JSONResponse:
    try:
        if not request.cv_text or not request.cv_text.strip():
            raise HTTPException(status_code=400, detail="CV text cannot be empty")
        if len(request.cv_text) > settings.MAX_TEXT_INPUT_CHARS:
            raise HTTPException(status_code=400, detail="CV text too long (max 50KB)")
        
        # Extract PII before sending to LLM
        parsing_service = get_parsing_service()
        clean_text, extracted_pii = parsing_service.remove_pii_data(request.cv_text.strip())
        
        # Send clean text to LLM
        llm = get_llm_service()
        standardized = llm.standardize_cv(clean_text, request.cv_filename)
        
        # Add extracted PII to standardized data
        standardized["extracted_pii"] = extracted_pii
        
        # Override contact_info with extracted PII
        if "contact_info" not in standardized:
            standardized["contact_info"] = {}
        if extracted_pii.get("email") and len(extracted_pii["email"]) > 0:
            standardized["contact_info"]["email"] = extracted_pii["email"][0]
            logger.info(f"Added email to contact_info: {standardized['contact_info']['email']}")
        if extracted_pii.get("phone") and len(extracted_pii["phone"]) > 0:
            standardized["contact_info"]["phone"] = extracted_pii["phone"][0]
            logger.info(f"Added phone to contact_info: {standardized['contact_info']['phone']}")
        
        # Also store PII at top level for backward compatibility
        if extracted_pii.get("email") and len(extracted_pii["email"]) > 0:
            standardized["email"] = extracted_pii["email"][0]
        if extracted_pii.get("phone") and len(extracted_pii["phone"]) > 0:
            standardized["phone"] = extracted_pii["phone"][0]
        
        # Generate embeddings for stats
        emb_service = get_embedding_service()
        doc_embeddings = emb_service.generate_document_embeddings(standardized)
        dims = len(doc_embeddings["skill_vectors"][0]) if doc_embeddings["skill_vectors"] else 0
        
        return JSONResponse({
            "status": "success",
            "message": f"CV '{request.cv_filename}' standardized successfully",
            "filename": request.cv_filename,
            "standardized_data": standardized,
            "processing_stats": {
                "input_text_length": len(request.cv_text),
                "skills_count": len(standardized.get("skills_sentences", standardized.get("skills", []))),
                "responsibilities_count": len(standardized.get("responsibility_sentences", standardized.get("responsibilities", []))),
                "embeddings_info": {
                    "skills_count": len(doc_embeddings["skill_vectors"]),
                    "responsibilities_count": len(doc_embeddings["responsibility_vectors"]),
                    "vector_dimension": dims
                },
                "pii_extracted": {
                    "emails": len(extracted_pii.get("email", [])),
                    "phones": len(extracted_pii.get("phone", []))
                }
            }
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CV text standardization failed: {e}")
        raise HTTPException(status_code=500, detail=f"CV standardization failed: {e}")
@router.get("/{cv_id}/preview")
async def preview_cv(cv_id: str, page: int = Query(1, ge=1), scale: float = Query(1.0, ge=0.5, le=2.5),
                     _: User = Depends(require_core_app)):
    """One page of the CV drawn as a PNG from its extracted text.

    For formats a browser cannot display itself (legacy .doc, RTF, ODT, HTML, text). PDF, images and DOCX use their
    native viewers. The total page count is returned in ``X-Preview-Pages``.
    """
    _validate_doc_id(cv_id)
    res = get_qdrant_utils().client.retrieve("cv_documents", ids=[cv_id], with_payload=True, with_vectors=False)
    if not res:
        raise HTTPException(status_code=404, detail="CV not found")
    payload = res[0].payload or {}
    text = get_decompressed_content(payload)
    if not text or not text.strip():
        raise HTTPException(status_code=404, detail="This CV has no extracted text to preview")
    png, total = await asyncio.to_thread(render_page_png, text, page, label=payload.get("filename", ""), scale=scale)
    return Response(png, media_type="image/png", headers={
        "X-Preview-Pages": str(total), "Access-Control-Expose-Headers": "X-Preview-Pages",
        "Cache-Control": "private, max-age=300"})


@router.get("/{cv_id}/download")
async def download_cv(cv_id: str, _: User = Depends(require_core_app)):
    _validate_doc_id(cv_id)
    """
    Download the original uploaded CV file.
    Falls back to a .txt export of raw_content if the file_path is missing.
    Also handles job application CVs (stored with application_id as document_id).
    """
    q = get_qdrant_utils().client
    res = q.retrieve("cv_documents", ids=[cv_id], with_payload=True, with_vectors=False)
    if not res:
        raise HTTPException(status_code=404, detail="CV not found")

    payload = res[0].payload or {}
    filepath = payload.get("file_path") or payload.get("filepath")
    filename = payload.get("filename", f"{cv_id}.dat")
    
    # For job applications, use a more descriptive filename if available
    if not filepath and not payload.get("raw_content"):
        # Check if this is a job application by looking at structured data
        structured_res = q.retrieve("cv_structured", ids=[cv_id], with_payload=CV_PAYLOAD, with_vectors=False)
        if structured_res and structured_res[0].payload:
            structured_payload = structured_res[0].payload
            if structured_payload.get("is_job_application"):
                applicant_name = structured_payload.get("applicant_name", "Applicant")
                cv_filename = structured_payload.get("cv_filename", "cv.pdf")
                filename = f"{applicant_name}_{cv_filename}"

    # Check if file is in S3
    if filepath and filepath.startswith('s3://'):
        # File is stored in S3 - stream it through backend (avoids CORS)
        s3_service = get_storage_service()
        file_ext = os.path.splitext(filename)[1] or '.pdf'
        
        try:
            import tempfile
            from starlette.background import BackgroundTask

            # Legacy "s3://" paths now resolve through the local storage service
            # (boto3/S3 was replaced by filesystem storage; same layout: <type>s/<id><ext>).
            with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                tmp_path = tmp.name

            s3_service.download_file(cv_id, "cv", file_ext, tmp_path)

            mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

            def cleanup():
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

            # Temp file is removed after the response is sent.
            return FileResponse(
                tmp_path,
                media_type=mime_type,
                filename=filename,
                background=BackgroundTask(cleanup),
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to download from S3: {e}")
            # Final fallback to raw_content
            raw = get_decompressed_content(payload)
            if raw:
                logger.info(f"Final fallback to raw_content for {cv_id}")
                base_name = os.path.splitext(filename)[0]
                stripped = raw.lstrip()
                if stripped.startswith("%PDF-"):
                    return StreamingResponse(
                        BytesIO(raw.encode("latin-1", "ignore")), media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="{base_name}.pdf"'},
                    )
                if stripped[:4] == "PK\x03\x04":
                    return StreamingResponse(
                        BytesIO(raw.encode("latin-1", "ignore")),
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"Content-Disposition": f'attachment; filename="{base_name}.docx"'},
                    )
                bytes_io = BytesIO(raw.encode("utf-8"))
                headers = {"Content-Disposition": f'attachment; filename="{base_name}.txt"'}
                return StreamingResponse(bytes_io, media_type="text/plain; charset=utf-8", headers=headers)
            raise HTTPException(status_code=500, detail="Failed to download file")
    
    # Serve the persisted file if we have it (legacy local storage)
    elif filepath and os.path.exists(filepath):
        # Get the original filename from structured data if available
        original_filename = filename
        structured_res = q.retrieve("cv_structured", ids=[cv_id], with_payload=CV_PAYLOAD, with_vectors=False)
        if structured_res and structured_res[0].payload:
            structured_payload = structured_res[0].payload
            if structured_payload.get("is_job_application"):
                # Use the original CV filename for job applications
                cv_filename = structured_payload.get("cv_filename")
                if cv_filename:
                    original_filename = cv_filename
            else:
                # For regular CVs, use the filename from structured data
                structured_filename = structured_payload.get("filename")
                if structured_filename:
                    original_filename = structured_filename
        
        # Determine MIME type
        mime_type = payload.get("mime_type") or mimetypes.guess_type(filepath)[0] or "application/octet-stream"
        
        return FileResponse(
            filepath, 
            media_type=mime_type, 
            filename=original_filename
        )

    # Fallback: stream raw_content as a .txt download (helps older records)
    raw = get_decompressed_content(payload)
    if raw:
        # Try to preserve original filename extension if available
        fallback_filename = filename
        structured_res = q.retrieve("cv_structured", ids=[cv_id], with_payload=CV_PAYLOAD, with_vectors=False)
        if structured_res and structured_res[0].payload:
            structured_payload = structured_res[0].payload
            if structured_payload.get("is_job_application"):
                cv_filename = structured_payload.get("cv_filename")
                if cv_filename:
                    # Keep original extension if it's a text-based format, otherwise convert to .txt
                    original_ext = os.path.splitext(cv_filename)[1].lower()
                    if original_ext in ['.txt', '.md']:
                        fallback_filename = cv_filename
                    else:
                        fallback_filename = f"{os.path.splitext(cv_filename)[0]}.txt"
            else:
                structured_filename = structured_payload.get("filename")
                if structured_filename:
                    original_ext = os.path.splitext(structured_filename)[1].lower()
                    if original_ext in ['.txt', '.md']:
                        fallback_filename = structured_filename
                    else:
                        fallback_filename = f"{os.path.splitext(structured_filename)[0]}.txt"
        
        # Some legacy records stored the *raw file bytes* (not extracted text) in
        # raw_content. Serving those as text/plain makes the preview dump "%PDF-…"
        # on screen. Detect the real format from the magic bytes and serve it with
        # the correct content type + extension so the PDF/DOCX preview works.
        stripped = raw.lstrip()
        base_name = os.path.splitext(fallback_filename)[0]
        if stripped.startswith("%PDF-"):
            data = raw.encode("latin-1", "ignore")
            return StreamingResponse(
                BytesIO(data), media_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="{base_name}.pdf"'},
            )
        if stripped[:4] == "PK\x03\x04":
            data = raw.encode("latin-1", "ignore")
            return StreamingResponse(
                BytesIO(data),
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                headers={"Content-Disposition": f'attachment; filename="{base_name}.docx"'},
            )

        bytes_io = BytesIO(raw.encode("utf-8"))
        headers = {
            "Content-Disposition": f'attachment; filename="{fallback_filename}"'
        }
        return StreamingResponse(bytes_io, media_type="text/plain; charset=utf-8", headers=headers)

    raise HTTPException(status_code=404, detail="File not found on server")


# ----------------------------
# Note Management APIs
# ----------------------------

@router.post("/{cv_id}/note")
async def add_or_update_note(cv_id: str, request: NoteRequest, user: User = Depends(require_core_app)) -> JSONResponse:
    """
    Add or update a note for a specific CV.
    Notes are stored in the cv_structured collection under the 'hr_notes' field.
    """
    try:
        logger.info(f"Adding/updating note for CV: {cv_id}")
        qdrant = get_qdrant_utils()
        
        # Check if CV exists
        s = qdrant.client.retrieve("cv_structured", ids=[cv_id], with_payload=True, with_vectors=False)
        if not s:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        
        # Get current structured data
        current_payload = s[0].payload or {}
        structured_info = current_payload.get("structured_info", {})
        
        # IMPORTANT: Preserve job application metadata at root level
        # This ensures job posting links remain intact
        is_job_application = current_payload.get("is_job_application", False)
        job_posting_id = current_payload.get("job_posting_id")
        applicant_email = current_payload.get("applicant_email")
        application_id = current_payload.get("application_id")
        cv_filename = current_payload.get("cv_filename")
        
        # Add/update note
        if "hr_notes" not in structured_info:
            structured_info["hr_notes"] = []
        
        author = user.username
        # Check if note already exists for this HR user
        existing_note_index = None
        for i, note in enumerate(structured_info["hr_notes"]):
            if note.get("hr_user") == author:
                existing_note_index = i
                break
        
        note_data = {
            "note": request.note,
            "hr_user": author,
            "created_at": _now_iso(),
            "updated_at": _now_iso()
        }
        
        if existing_note_index is not None:
            # Update existing note
            structured_info["hr_notes"][existing_note_index] = note_data
            logger.info(f"Updated note for CV {cv_id} by HR user {author}")
        else:
            # Add new note
            structured_info["hr_notes"].append(note_data)
            logger.info(f"Added new note for CV {cv_id} by HR user {author}")
        
        # Build updated payload - PRESERVE all job application metadata
        updated_payload = {
            **current_payload,
            "structured_info": structured_info
        }
        
        # Explicitly preserve job application fields to ensure they're not lost
        if is_job_application:
            updated_payload["is_job_application"] = is_job_application
            if job_posting_id:
                updated_payload["job_posting_id"] = job_posting_id
            if applicant_email:
                updated_payload["applicant_email"] = applicant_email
            if application_id:
                updated_payload["application_id"] = application_id
            if cv_filename:
                updated_payload["cv_filename"] = cv_filename
            
            logger.info(f"Preserved job application link: job_posting_id={job_posting_id}")
        
        # Store updated data
        qdrant.store_structured_data(cv_id, "cv", updated_payload)
        
        return JSONResponse({
            "status": "success",
            "message": "Note added/updated successfully",
            "cv_id": cv_id,
            "note": note_data
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to add/update note for CV {cv_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add/update note: {e}")


@router.get("/{cv_id}/note")
async def get_cv_note(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Get all notes for a specific CV.
    """
    try:
        logger.info(f"Getting notes for CV: {cv_id}")
        qdrant = get_qdrant_utils()
        
        # Get CV structured data
        s = qdrant.client.retrieve("cv_structured", ids=[cv_id], with_payload=CV_PAYLOAD, with_vectors=False)
        if not s:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        
        structured_info = s[0].payload.get("structured_info", {})
        notes = structured_info.get("hr_notes", [])
        
        return JSONResponse({
            "status": "success",
            "cv_id": cv_id,
            "notes": notes,
            "notes_count": len(notes)
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get notes for CV {cv_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get notes: {e}")


@router.delete("/{cv_id}/note/{hr_user}")
async def delete_cv_note(cv_id: str, hr_user: str, user: User = Depends(require_core_app)) -> JSONResponse:
    if hr_user != user.username and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only delete your own notes")
    """
    Delete a note for a specific CV by HR user.
    """
    try:
        logger.info(f"Deleting note for CV: {cv_id} by HR user: {hr_user}")
        qdrant = get_qdrant_utils()
        
        # Check if CV exists
        s = qdrant.client.retrieve("cv_structured", ids=[cv_id], with_payload=True, with_vectors=False)
        if not s:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        
        # Get current structured data
        current_payload = s[0].payload or {}
        structured_info = current_payload.get("structured_info", {})
        
        # IMPORTANT: Preserve job application metadata at root level
        # This ensures job posting links remain intact
        is_job_application = current_payload.get("is_job_application", False)
        job_posting_id = current_payload.get("job_posting_id")
        applicant_email = current_payload.get("applicant_email")
        application_id = current_payload.get("application_id")
        cv_filename = current_payload.get("cv_filename")
        
        # Remove note for this HR user
        if "hr_notes" in structured_info:
            original_count = len(structured_info["hr_notes"])
            structured_info["hr_notes"] = [
                note for note in structured_info["hr_notes"] 
                if note.get("hr_user") != hr_user
            ]
            
            if len(structured_info["hr_notes"]) == original_count:
                raise HTTPException(status_code=404, detail=f"No note found for HR user: {hr_user}")
        
        # Build updated payload - PRESERVE all job application metadata
        updated_payload = {
            **current_payload,
            "structured_info": structured_info
        }
        
        # Explicitly preserve job application fields to ensure they're not lost
        if is_job_application:
            updated_payload["is_job_application"] = is_job_application
            if job_posting_id:
                updated_payload["job_posting_id"] = job_posting_id
            if applicant_email:
                updated_payload["applicant_email"] = applicant_email
            if application_id:
                updated_payload["application_id"] = application_id
            if cv_filename:
                updated_payload["cv_filename"] = cv_filename
            
            logger.info(f"Preserved job application link: job_posting_id={job_posting_id}")
        
        # Store updated data
        qdrant.store_structured_data(cv_id, "cv", updated_payload)
        
        logger.info(f"Deleted note for CV {cv_id} by HR user {hr_user}")
        
        return JSONResponse({
            "status": "success",
            "message": "Note deleted successfully",
            "cv_id": cv_id,
            "hr_user": hr_user
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete note for CV {cv_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete note: {e}")


@router.get("/notes/all")
async def get_all_cvs_with_notes(_: User = Depends(require_core_app)) -> JSONResponse:
    """
    Get all CVs that have notes, with their note information.
    This is used for the Notes tab in the frontend.
    """
    try:
        logger.info("Getting all CVs with notes")
        qdrant = get_qdrant_utils()
        
        # Get all CVs with structured data
        all_cvs = []
        offset = None
        
        while True:
            points, next_offset = qdrant.client.scroll(
                collection_name="cv_structured",
                limit=200,
                offset=offset,
                with_payload=CV_PAYLOAD,
                with_vectors=False
            )
            
            for point in points:
                payload = point.payload or {}
                structured_info = payload.get("structured_info", {})
                notes = structured_info.get("hr_notes", [])
                
                if notes:  # Only include CVs that have notes
                    # Get document metadata for filename and upload date
                    doc_meta = {}
                    try:
                        doc_result = qdrant.client.retrieve("cv_documents", ids=[str(point.id)], with_payload=True, with_vectors=False)
                        if doc_result:
                            doc_meta = doc_result[0].payload or {}
                    except Exception as e:
                        logger.warning(f"Failed to get document metadata for CV {point.id}: {e}")
                    
                    # Clean up filename
                    filename = doc_meta.get("filename", "Unknown")
                    if filename and "/" in filename:
                        filename = filename.split("/")[-1]
                    
                    cv_data = {
                        "cv_id": str(point.id),
                        "filename": filename,
                        "upload_date": doc_meta.get("upload_date", "Unknown"),
                        "full_name": resolve_candidate_full_name(payload, structured_info),
                        "job_title": structured_info.get("job_title", "Not specified"),
                        "years_of_experience": structured_info.get("years_of_experience", structured_info.get("experience_years", "Not specified")),
                        "notes": notes,
                        "notes_count": len(notes),
                        "latest_note": max(notes, key=lambda x: x.get("updated_at", x.get("created_at", ""))) if notes else None
                    }
                    all_cvs.append(cv_data)
            
            if not next_offset:
                break
            offset = next_offset
        
        # Sort by latest note date
        all_cvs.sort(key=lambda x: x["latest_note"]["updated_at"] if x["latest_note"] else "", reverse=True)
        
        return JSONResponse({
            "status": "success",
            "cvs_with_notes": all_cvs,
            "total_count": len(all_cvs)
        })
        
    except Exception as e:
        logger.error(f"Failed to get CVs with notes: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get CVs with notes: {e}")


# ------------------------------
# Batch Notes Summary Endpoint
# ------------------------------

class NotesSummaryRequest(BaseModel):
    cv_ids: List[str]


@router.post("/notes/summary")
async def get_notes_summary(payload: NotesSummaryRequest, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Return a lightweight notes summary for a batch of CV IDs.
    For each cv_id: { cv_id, has_notes, notes_count, latest_note }
    - Optimized for UI lists (e.g., matching results) to avoid N per-CV note calls
    - Does NOT include full notes array
    """
    try:
        if not payload.cv_ids:
            return JSONResponse({
                "status": "success",
                "summaries": [],
                "count": 0
            })

        # Deduplicate while preserving order
        seen = set()
        ordered_ids: List[str] = []
        for cv_id in payload.cv_ids:
            if cv_id and cv_id not in seen:
                seen.add(cv_id)
                ordered_ids.append(cv_id)

        qdrant = get_qdrant_utils()

        # Prepare defaults for all requested IDs
        summaries_map: Dict[str, Dict[str, Any]] = {
            cv_id: {
                "cv_id": cv_id,
                "has_notes": False,
                "notes_count": 0,
                "latest_note": None,
            }
            for cv_id in ordered_ids
        }

        # Qdrant retrieve supports multiple IDs; chunk for safety
        CHUNK_SIZE = 256
        for i in range(0, len(ordered_ids), CHUNK_SIZE):
            chunk = ordered_ids[i:i + CHUNK_SIZE]
            try:
                results = qdrant.client.retrieve(
                    "cv_structured",
                    ids=chunk,
                    with_payload=CV_PAYLOAD,
                    with_vectors=False,
                )
            except Exception as e:
                logger.warning(f"Failed to retrieve notes summary chunk {i}-{i+len(chunk)}: {e}")
                continue

            for point in results or []:
                try:
                    payload = point.payload or {}
                    structured_info = payload.get("structured_info", {})
                    notes = structured_info.get("hr_notes", []) or []

                    summary = summaries_map.get(str(point.id))
                    # Some deployments may store UUIDs as strings; ensure both lookups
                    if summary is None:
                        summary = summaries_map.get(point.id)  # type: ignore[index]

                    if summary is not None:
                        summary["has_notes"] = len(notes) > 0
                        summary["notes_count"] = len(notes)
                        if notes:
                            latest_note = max(
                                notes,
                                key=lambda x: x.get("updated_at", x.get("created_at", ""))
                            )
                            summary["latest_note"] = latest_note
                except Exception as inner_e:
                    logger.warning(f"Failed to process summary for point {getattr(point, 'id', 'unknown')}: {inner_e}")

        # Preserve original order in response
        summaries_list = [summaries_map[cid] for cid in ordered_ids]

        return JSONResponse({
            "status": "success",
            "summaries": summaries_list,
            "count": len(summaries_list)
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get notes summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get notes summary: {e}")
