"""CV Routes - Consolidated CV API endpoints.

Handles ALL CV operations: upload, processing, listing, and management.
Single responsibility: CV document management through REST API.
"""

import asyncio
import logging
import os
import re
import time
import uuid
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Form, UploadFile, Query
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from app.config.settings import settings
from app.security.uploads import CV_EXTENSIONS, secure_upload
from app.api.deps import require_core_app
from app.models.user import User
from app.ingestion.cv_parser import get_parsing_service
from app.ingestion.pipeline import SOURCE_UPLOAD, CVSubmission, IngestError, ingest_cv
from app.ingestion.preview import render_page_png
from app.providers.llm.service import get_llm_service
from app.providers.embeddings.service import get_embedding_service
from app.store import get_store
from app.store.candidates import FACET_FIELDS, BadCursor, parse_page_cursor
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
        raise HTTPException(status_code=500, detail="Progress tracking error. Please try again or contact support.")

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
            # size while reading, real type (not the name), bombs, macros, scripts, optional virus scan
            await secure_upload(file, CV_EXTENSIONS)
            file_ext = os.path.splitext(file.filename)[1].lower()
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
        raise HTTPException(status_code=500, detail="CV processing failed. Please try again or contact support.")


CV_LIST_PAGE = 200   # CVs per API call (default and maximum); the UI shows the same 200 per page
CV_LIST_MAX_IDS = 100_000   # ids_only (no personal data) may ask for more: the match launcher needs up to the whole DB


@router.get("/cvs")
async def list_cvs(
    limit: Optional[int] = Query(None, ge=1, description=f"Page size (default and max {CV_LIST_PAGE})"),
    offset: int = Query(0, ge=0, description="Number of items to skip (older clients; prefer cursor)"),
    category: Optional[str] = Query(None, description="Filter by CV category (folder)"),
    categories: Optional[List[str]] = Query(None, description="Several categories at once (repeat the parameter); newest first across all of them"),
    q: Optional[str] = Query(None, description="Search box: every word typed must be in the CV (its text, title, skills, name, contact)"),
    ids_only: bool = Query(False, description="Return only CV ids (no contact data); pages up to the whole database"),
    cursor: Optional[str] = Query(None, max_length=120, description="The next_cursor of the previous page: the next page starts right after it"),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    """
    List CVs, newest first, one page per call (200). The search box needs every word typed to be in the CV.

    Paging is by cursor: the answer carries ``next_cursor`` (null on the last page) and the next call sends it back. A page then starts
    at its first row through the index, so page 5,000 costs what page 1 costs. ``total`` is the exact number of candidates (in the chosen
    categories), read from the shared per-category counts and never counted per call. ``offset`` still works for older clients.

    One call never returns the whole database: it used to hand every candidate's name, email and phone to any
    account. The match launcher, which only needs ids, asks for ids_only.
    """
    cats = list(dict.fromkeys([c for c in (categories or []) if c] or ([category] if category else [])))
    max_limit = CV_LIST_MAX_IDS if ids_only else CV_LIST_PAGE
    limit = min(limit or max_limit, max_limit)
    try:
        after = parse_page_cursor(cursor)
    except BadCursor:
        raise HTTPException(status_code=400, detail="This page of the list is no longer valid. Please reload the list.")
    by_cursor = after is not None or offset == 0
    store = get_store()
    try:
        estimate, next_cursor = False, None
        if q and q.strip():
            words = [w for w in re.split(r"\s+", q.strip()) if w][:8]
            if by_cursor:      # the matches are counted on the first page only
                ids, total, estimate, next_cursor = await asyncio.to_thread(store.search_candidate_page, words, limit, cats, after, after is None)
            else:
                ids, total, estimate = await asyncio.to_thread(store.search_candidate_ids, words, offset, limit, cats)
        else:
            counts = await asyncio.to_thread(store.cached_category_counts)
            total = sum(counts.get(c, 0) for c in cats) if cats else sum(counts.values())
            if by_cursor:
                ids, next_cursor = await asyncio.to_thread(store.list_candidate_page, limit, cats, after)
            else:
                ids = await asyncio.to_thread(store.list_candidate_ids, offset, limit, cats)
        body: Dict[str, Any] = {"status": "success", "count": len(ids), "total": total, "total_is_estimate": estimate, "limit": limit,
                                "offset": offset, "next_cursor": next_cursor, "category": cats[0] if len(cats) == 1 else category, "q": q}
        if ids_only:
            body["ids"] = ids
        else:
            body["cvs"] = await asyncio.to_thread(store.candidate_rows, ids)
            body["count"] = len(body["cvs"])
        return JSONResponse(body)
    except Exception as e:
        logger.error(f"Failed to list CVs: {e}")
        raise HTTPException(status_code=500, detail="Failed to list CVs. Please try again or contact support.")


@router.get("/categories")
async def get_categories(_: User = Depends(require_core_app)):
    """
    Get all CV categories with their counts.
    """
    try:
        # exact, and the same numbers the list's total is read from (see cached_category_counts)
        counts = await asyncio.to_thread(get_store().cached_category_counts)
        return JSONResponse(content={"categories": counts})
    except Exception as e:
        logger.error(f"Failed to get categories: {e}")
        raise HTTPException(status_code=500, detail="Failed to get categories. Please try again or contact support.")

@router.get("/search/facets/{field}")
async def get_cv_search_facet(
    field: str,
    limit: int = Query(200, ge=1, le=1000),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    """
    Distinct values + counts for a filterable field (location, nationality,
    notice_period, keywords, languages), across every CV, feeds the searchable checkbox
    lists and the keyword-search autocomplete in the advanced search modal.
    `keywords` defaults to a higher limit than the others since its vocabulary is
    naturally larger (up to 20 LLM-extracted terms per CV vs. one location/nationality each).
    """
    if field not in FACET_FIELDS:
        raise HTTPException(status_code=400, detail=f"Unsupported facet field: {field}")
    effective_limit = max(limit, 500) if field == "keywords" else limit
    cache, key = get_cache_service(), f"facet:{field}:{effective_limit}"
    values = cache.get(key, namespace="cv_data")
    if values is None:
        values = await asyncio.to_thread(get_store().candidate_facet, field, effective_limit)
        cache.set(key, values, ttl_seconds=300, namespace="cv_data")      # a vocabulary list: five minutes old is fine, and it is costly on a big table
    values = [dict(v) for v in values]
    if field == "location":
        # The location filter is country-wise: cities roll up into their country. `members` are the raw stored
        # locations behind each country, which the search uses to find them.
        from app.services import locations_service

        values = locations_service.group_by_country(values)
    values.sort(key=lambda v: -v["count"])
    return JSONResponse({"field": field, "values": values})


def _freshness_range(within_days: Optional[int], date_from: Optional[str], date_to: Optional[str]):
    """Epoch-second bounds for the freshness filter. A bad date is a 400, not a silently ignored filter."""
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz

    def day(value: str, end: bool) -> float:
        try:
            d = _dt.strptime(value.strip(), "%Y-%m-%d").replace(tzinfo=_tz.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must look like 2026-11-03")
        return (d + _td(days=1)).timestamp() - 0.001 if end else d.timestamp()

    after = before = None
    if within_days:
        after = (_dt.now(_tz.utc) - _td(days=int(within_days))).timestamp()
    if date_from:
        after = max(after or 0.0, day(date_from, False))
    if date_to:
        before = day(date_to, True)
    return after, before


@router.post("/search/advanced", response_model=CVAdvancedSearchResponse)
async def search_cvs_advanced(
    req: CVAdvancedSearchRequest,
    _: User = Depends(require_core_app),
) -> CVAdvancedSearchResponse:
    """
    Advanced CV search (keywords + experience range + location + nationality + languages + a pasted boolean string),
    evaluated by the database against every CV. Paginated with an opaque cursor: pass the previous
    response's next_cursor back in to get the next page (the frontend's "load 50, then fetch more as you scroll" flow).
    """
    try:
        store = get_store()
        added_after, added_before = _freshness_range(req.added_within_days, req.added_from, req.added_to)
        found = await asyncio.to_thread(
            store.search_candidates,
            keywords=req.keywords, match_all=req.match_all, experience_min=req.experience_min, experience_max=req.experience_max,
            locations=req.locations, nationalities=req.nationalities, languages=req.languages, limit=req.limit, cursor=req.cursor,
            with_total=not req.cursor, boolean_query=req.boolean_query, added_after=added_after, added_before=added_before,
            categories=req.categories, notes=req.notes)
        rows = await asyncio.to_thread(store.candidate_rows, found["ids"])
        fields = CVSearchResultItem.model_fields
        results = [CVSearchResultItem(**{**{k: r.get(k) for k in fields if k in r}, "matched_keywords": found["matched"].get(r["id"], [])})
                   for r in rows]
        return CVAdvancedSearchResponse(results=results, next_cursor=found["next_cursor"], count=len(results),
                                        total=found["total"], total_is_estimate=found["total_is_estimate"])
    except BooleanQueryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Advanced CV search failed: {e}")
        raise HTTPException(status_code=500, detail="Advanced CV search failed. Please try again or contact support.")


@router.get("/{cv_id}")
async def get_cv_details(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Get details for a specific CV: the candidate's rows, their latest application (if any) and what is stored in Qdrant for them.
    """
    try:
        store = get_store()
        d = await asyncio.to_thread(store.candidate_detail, cv_id)
        if not d:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        emb = await asyncio.to_thread(store.embeddings_info, cv_id, "cv")

        contact = {k: v for k, v in (("name", d["full_name"]), ("email", d["email"]), ("phone", d["phone"]),
                                      ("linkedin", d["linkedin_url"]), ("github", d["github_url"])) if v}
        years = d["years_of_experience"] if d["years_of_experience"] is not None else "Not specified"
        latest = d["applications"][0] if d["applications"] else None
        application = None
        if latest:
            application = {
                "job_id": latest["job_id"], "applicant_name": d["full_name"], "applicant_email": d["email"], "applicant_phone": d["phone"],
                "application_date": latest["application_date"], "application_status": latest["application_status"],
                "cv_filename": d["filename"],
                "expected_salary": d["expected_salary"], "years_of_experience": d["years_of_experience"], "location": d["location"],
                "notice_period": d["notice_period"], "nationality": d["nationality"],
            }
        response = {
            "id": cv_id, "filename": d["filename"] or "Unknown", "upload_date": d["upload_date"], "document_type": "cv",
            "is_job_application": latest is not None,
            "candidate": {
                "full_name": d["full_name"] or "Not specified", "job_title": d["job_title"] or "Not specified", "years_of_experience": years,
                "skills": d["skills"], "responsibilities": d["responsibilities"], "skills_count": len(d["skills"]),
                "responsibilities_count": len(d["responsibilities"]), "contact_info": contact, "email": d["email"], "phone": d["phone"],
                "linkedin_url": d["linkedin_url"], "github_url": d["github_url"], "expected_salary": d["expected_salary"], "gender": d["gender"],
                "languages": d["languages"][:20], "certifications": d["certifications"][:20], "location": d["location"],
                "nationality": d["nationality"], "notice_period": d["notice_period"],
            },
            "job_application": application,
            "embeddings_info": {
                "skills_embeddings": emb["skills"], "responsibilities_embeddings": emb["responsibilities"],
                "has_title_embedding": emb["has_title"], "embedding_dimension": emb["dimension"],
            },
            # the same facts again under the names the candidate page reads (built from the rows above, not stored a second time)
            "structured_info": {
                "name": d["full_name"], "full_name": d["full_name"], "job_title": d["job_title"], "category": d["category"], "gender": d["gender"],
                "languages": d["languages"], "certifications": d["certifications"], "keywords": d["keywords"],
                "skills_sentences": d["skills"], "responsibility_sentences": d["responsibilities"], "contact_info": contact,
                "years_of_experience": d["years_of_experience"], "location": d["location"], "nationality": d["nationality"],
                "notice_period": d["notice_period"], "expected_salary": d["expected_salary"], "email": d["email"], "phone": d["phone"],
                "linkedin_url": d["linkedin_url"], "github_url": d["github_url"], "hr_notes": d["notes"], "source": d["source"],
            },
            "processing_metadata": {"model_used": d["llm_model"], "processing_time": (d["extraction_ms"] or 0) / 1000.0,
                                    "embedding_model": d["embedding_model"]},
        }
        return JSONResponse({"status": "success", "cv": response})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get CV details: {e}")
        raise HTTPException(status_code=500, detail="Failed to get CV details. Please try again or contact support.")


@router.delete("/{cv_id}")
async def delete_cv(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Delete a CV and everything about it: the candidate's rows (skills, notes, applications ...), its vectors in Qdrant, and the stored file.
    """
    try:
        info = await asyncio.to_thread(get_store().delete_candidate, cv_id)
        if info is None:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        filename = info["filename"] or cv_id
        if info.get("file_path"):
            try:
                await asyncio.to_thread(get_storage_service().delete_file, cv_id, "cv", os.path.splitext(filename)[1] or ".pdf")
            except Exception as e:  # noqa: BLE001 - the record is gone; a stray file is reported, not fatal
                logger.warning(f"Failed to delete the stored file of CV {cv_id}: {e}")
        _invalidate_match_caches(cv_id)
        return JSONResponse({"status": "success", "message": f"CV '{filename}' deleted successfully", "deleted_cv_id": cv_id})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete CV: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete CV. Please try again or contact support.")


@router.get("/{cv_id}/embeddings")
async def get_cv_embeddings_info(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    What is stored in Qdrant for a CV: how many skill / responsibility vectors, the title and experience vectors, the dimension.
    """
    try:
        store = get_store()
        if not await asyncio.to_thread(store.candidate_exists, cv_id):
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        e = await asyncio.to_thread(store.embeddings_info, cv_id, "cv")
        info = {
            "cv_id": cv_id, "embeddings_found": e["embeddings_found"],
            "skills": {"count": e["skills"], "embedding_dimension": e["dimension"] if e["skills"] else 0},
            "responsibilities": {"count": e["responsibilities"], "embedding_dimension": e["dimension"] if e["responsibilities"] else 0},
            "title_embedding": e["has_title"],
            "total_embeddings": e["skills"] + e["responsibilities"] + int(e["has_title"]),
        }
        return JSONResponse({"status": "success", "embeddings_info": info})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get CV embeddings info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get CV embeddings info. Please try again or contact support.")


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
        raise HTTPException(status_code=500, detail="CV standardization failed. Please try again or contact support.")
@router.get("/{cv_id}/preview")
async def preview_cv(cv_id: str, page: int = Query(1, ge=1), scale: float = Query(1.0, ge=0.5, le=2.5),
                     _: User = Depends(require_core_app)):
    """One page of the CV drawn as a PNG from its extracted text.

    For formats a browser cannot display itself (legacy .doc, RTF, ODT, HTML, text). PDF, images and DOCX use their
    native viewers. The total page count is returned in ``X-Preview-Pages``.
    """
    _validate_doc_id(cv_id)
    doc = await asyncio.to_thread(get_store().candidate_document, cv_id)
    if not doc:
        raise HTTPException(status_code=404, detail="CV not found")
    text = doc["raw_text"]
    if not text or not text.strip():
        raise HTTPException(status_code=404, detail="This CV has no extracted text to preview")
    png, total = await asyncio.to_thread(render_page_png, text, page, label=doc["filename"] or "", scale=scale)
    return Response(png, media_type="image/png", headers={
        "X-Preview-Pages": str(total), "Access-Control-Expose-Headers": "X-Preview-Pages",
        "Cache-Control": "private, max-age=300"})


@router.get("/{cv_id}/download")
async def download_cv(cv_id: str, _: User = Depends(require_core_app)):
    """
    Download the original uploaded CV file. Falls back to a .txt export of the extracted text if the file is no longer in storage.
    """
    _validate_doc_id(cv_id)
    doc = await asyncio.to_thread(get_store().candidate_document, cv_id)
    if not doc:
        raise HTTPException(status_code=404, detail="CV not found")
    filename = doc["filename"] or f"{cv_id}.dat"
    filepath = doc["file_path"]
    mime_type = doc["mime_type"] or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    if filepath and filepath.startswith("s3://"):
        # Stored through the storage service (legacy "s3://" paths resolve to its local layout): copy to a temp file and stream it.
        import tempfile
        from starlette.background import BackgroundTask

        file_ext = os.path.splitext(filename)[1] or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
            tmp_path = tmp.name
        try:
            await asyncio.to_thread(get_storage_service().download_file, cv_id, "cv", file_ext, tmp_path)
            return FileResponse(tmp_path, media_type=mime_type, filename=filename,
                                background=BackgroundTask(lambda: os.path.exists(tmp_path) and os.unlink(tmp_path)))
        except Exception as e:  # noqa: BLE001
            logger.error(f"Failed to download from storage: {e}")
    elif filepath and os.path.exists(filepath):
        return FileResponse(filepath, media_type=mime_type, filename=filename)

    raw = doc["raw_text"]
    if raw:
        base_name, ext = os.path.splitext(filename)
        text_name = filename if ext.lower() in (".txt", ".md") else f"{base_name}.txt"
        return StreamingResponse(BytesIO(raw.encode("utf-8")), media_type="text/plain; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="{text_name}"'})
    raise HTTPException(status_code=404, detail="File not found on server")


# ----------------------------
# Note Management APIs
# ----------------------------

@router.post("/{cv_id}/note")
async def add_or_update_note(cv_id: str, request: NoteRequest, user: User = Depends(require_core_app)) -> JSONResponse:
    """Add or update the signed-in recruiter's note on a CV (one note per recruiter)."""
    try:
        note = await asyncio.to_thread(get_store().upsert_note, cv_id, user.username, request.note)
        if note is None:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        return JSONResponse({"status": "success", "message": "Note added/updated successfully", "cv_id": cv_id, "note": note})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to add/update note for CV {cv_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to add/update note. Please try again or contact support.")


@router.get("/{cv_id}/note")
async def get_cv_note(cv_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """Get all notes for a specific CV."""
    try:
        notes = await asyncio.to_thread(get_store().list_notes, cv_id)
        if notes is None:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        return JSONResponse({"status": "success", "cv_id": cv_id, "notes": notes, "notes_count": len(notes)})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get notes for CV {cv_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get notes. Please try again or contact support.")


@router.delete("/{cv_id}/note/{hr_user}")
async def delete_cv_note(cv_id: str, hr_user: str, user: User = Depends(require_core_app)) -> JSONResponse:
    """Delete a recruiter's note on a CV (your own, or any if you are an admin)."""
    if hr_user != user.username and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only delete your own notes")
    try:
        deleted = await asyncio.to_thread(get_store().delete_note, cv_id, hr_user)
        if deleted is None:
            raise HTTPException(status_code=404, detail=f"CV not found: {cv_id}")
        if deleted is False:
            raise HTTPException(status_code=404, detail=f"No note found for HR user: {hr_user}")
        return JSONResponse({"status": "success", "message": "Note deleted successfully", "cv_id": cv_id, "hr_user": hr_user})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete note for CV {cv_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete note. Please try again or contact support.")


# ------------------------------
# Batch Notes Summary Endpoint
# ------------------------------

class NotesSummaryRequest(BaseModel):
    cv_ids: List[str] = Field(..., max_length=1000)     # one page of a list, never the whole database


@router.post("/notes/summary")
async def get_notes_summary(payload: NotesSummaryRequest, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Return a lightweight notes summary for a batch of CV IDs.
    For each cv_id: { cv_id, has_notes, notes_count, latest_note }
    - Optimized for UI lists (e.g., matching results) to avoid N per-CV note calls
    - Does NOT include full notes array
    """
    try:
        ordered_ids = list(dict.fromkeys(i for i in payload.cv_ids if i))
        if not ordered_ids:
            return JSONResponse({"status": "success", "summaries": [], "count": 0})
        summaries = await asyncio.to_thread(get_store().notes_summary, ordered_ids)
        return JSONResponse({"status": "success", "summaries": [summaries[i] for i in ordered_ids], "count": len(ordered_ids)})
    except Exception as e:
        logger.error(f"Failed to build notes summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to build notes summary. Please try again or contact support.")
