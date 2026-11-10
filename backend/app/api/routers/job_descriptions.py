"""
JD Routes - Consolidated Job Description API endpoints
Handles ALL Job Description operations: upload, processing, listing, and management.
Single responsibility: Job Description document management through REST API.
"""

import asyncio
import logging
import re
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Form, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from app.config.settings import settings
from app.security.uploads import JD_EXTENSIONS, secure_upload
from app.api.deps import require_core_app
from app.models.user import User
from app.ingestion.cv_parser import get_parsing_service
from app.providers.llm.service import get_llm_service
from app.providers.embeddings.service import get_embedding_service
from app.store import get_store
from app.ingestion.preview import render_page_png
from app.providers.storage import get_storage_service
from app.providers.cache.memory import get_cache_service
from app.ingestion.skill_keywords import extract_skill_keywords

logger = logging.getLogger(__name__)
router = APIRouter()

# Constants
JD_LIST_PAGE = 200   # JDs per API call (default and maximum)
MAX_FILE_SIZE = settings.max_file_size_bytes
SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg']


# Request models for text-based processing
class StandardizeJDRequest(BaseModel):
    jd_text: str
    jd_filename: str = "jd.txt"


@router.post("/upload-jd")
async def upload_jd(
    file: Optional[UploadFile] = File(None),
    jd_text: Optional[str] = Form(None),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    """
    Upload and process Job Description file or text.
    Pipeline: validate -> extract -> PII removal -> LLM standardization -> EXACT embeddings (31) -> store.
    The description (text, title, skills, responsibilities, requirements) is rows in PostgreSQL; the 31 vectors are in Qdrant.
    """
    try:
        logger.info("---------- JD UPLOAD START ----------")

        parsing_service = get_parsing_service()

        # ---- Step 0: Determine input & extract text ----
        raw_content = ""
        extracted_text = ""
        filename = "text_input.txt"
        file_ext = ".txt"

        if file:
            logger.info(f"Processing JD file upload: {file.filename}")

            # Validate file
            if not file.filename:
                raise HTTPException(status_code=400, detail="No filename provided")

            # size while reading, real type (not the name), bombs, macros, scripts, optional virus scan
            await secure_upload(file, JD_EXTENSIONS)
            file_ext = os.path.splitext(file.filename)[1].lower()

            # Save to tmp and process
            import tempfile, shutil
            with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                shutil.copyfileobj(file.file, tmp)
                tmp_path = tmp.name

            try:
                parsed = parsing_service.process_document(tmp_path, "jd")
                raw_content = parsed["raw_text"]
                extracted_text = parsed["clean_text"]
                filename = file.filename
            except Exception as e:
                try:
                    os.unlink(tmp_path)
                except:
                    pass
                raise e

        elif jd_text:
            logger.info("Processing JD text input")
            cleaned, _pii = parsing_service.remove_pii_data(jd_text.strip())
            raw_content = jd_text.strip()
            extracted_text = cleaned
            filename = "text_input.txt"

            if len(extracted_text) < 50:
                raise HTTPException(status_code=400, detail="JD text too short (minimum 50 characters required)")
        else:
            raise HTTPException(status_code=400, detail="Either file upload or jd_text must be provided")

        logger.info(f"Text ready -> length={len(extracted_text)} (pii removed)")

        # ---- Step 1: LLM standardization ----
        logger.info("---------- STEP 1: LLM STANDARDIZATION ----------")
        llm = get_llm_service()
        standardized = llm.standardize_jd(extracted_text, filename)

        # ---- Step 2: EXACT embeddings (31 vectors) ----
        logger.info("---------- STEP 2: EMBEDDING GENERATION (31 vectors) ----------")
        emb_service = get_embedding_service()
        doc_embeddings = emb_service.generate_document_embeddings(standardized)
        # doc_embeddings contains:
        #   skill_vectors[20], responsibility_vectors[10], job_title_vector[1]
        #   plus: skills, responsibilities, job_title

        # ---- Step 3: Store file in S3 (if uploaded as file) ----
        logger.info("---------- STEP 3: S3 STORAGE ----------")
        jd_id = str(uuid.uuid4())
        persisted_path = None
        
        if file:
            # Upload original file to S3
            s3_service = get_storage_service()
            try:
                persisted_path = s3_service.upload_file(tmp_path, jd_id, "jd", file_ext)
                logger.info(f"JD file uploaded to S3: {persisted_path}")
                # Cleanup temp file
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
            except Exception as e:
                logger.warning(f"Failed to upload JD to S3: {e}")
                try:
                    os.unlink(tmp_path)
                except:
                    pass
        elif jd_text:
            # Save text to temp file then upload to S3
            s3_service = get_storage_service()
            try:
                import tempfile, shutil
                import tempfile
                dest_filename = f"{jd_id}.txt"
                dest_path = os.path.join(tempfile.gettempdir(), dest_filename)
                with open(dest_path, "w", encoding="utf-8") as f:
                    f.write(raw_content or extracted_text or "")
                persisted_path = s3_service.upload_file(dest_path, jd_id, "jd", ".txt")
                logger.info(f"JD text uploaded to S3: {persisted_path}")
                # Cleanup temp file
                try:
                    os.unlink(dest_path)
                except Exception:
                    pass
            except Exception as e:
                logger.warning(f"Failed to upload JD text to S3: {e}")
        
        # ---- Step 4: store the description (PostgreSQL) and its vectors (Qdrant) ----
        logger.info("---------- STEP 4: DATABASE STORAGE ----------")
        store = get_store()

        import mimetypes
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        meta = standardized.get("processing_metadata") or {}

        store.save_job_description({
            "id": jd_id, "filename": filename, "file_format": file_ext.lstrip("."), "mime_type": mime_type, "file_path": persisted_path,
            "raw_text": extracted_text, "standardized": standardized, "llm_model": meta.get("model_used"),
        })
        if not store.store_embeddings("jd", jd_id, doc_embeddings):
            store.delete_job_description(jd_id)
            raise HTTPException(status_code=500, detail="The job description's embeddings could not be saved")

        logger.info(f"JD processed and stored: {jd_id}")
        _invalidate_jd_list_cache()

        return JSONResponse({
            "status": "success",
            "message": f"Job Description '{filename}' processed successfully",
            "jd_id": jd_id,
            "filename": filename,
            "standardized_data": standardized,
            "processing_stats": {
                "text_length": len(extracted_text),
                "skills_count": len(standardized.get("skills_sentences", standardized.get("skills", []))),
                "responsibilities_count": len(standardized.get("responsibility_sentences", standardized.get("responsibilities", []))),
                "embeddings_generated": 31
            }
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"JD upload failed: {e}")
        raise HTTPException(status_code=500, detail="JD processing failed. Please try again or contact support.")


def _invalidate_jd_list_cache():
    try:
        get_cache_service().delete("jd_list", namespace="jd_data")
        logger.debug("Invalidated JD list cache")
    except Exception as e:
        logger.warning(f"Failed to invalidate JD list cache: {e}")


@router.get("/jds")
async def list_jds(
    limit: Optional[int] = Query(None, ge=1, description=f"Page size (default and max {JD_LIST_PAGE})"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    category: Optional[str] = Query(None, description="Filter by JD category (folder)"),
    q: Optional[str] = Query(None, description="Case-insensitive search across job title/filename/id"),
    _: User = Depends(require_core_app),
) -> JSONResponse:
    """List job descriptions, newest first, one page per call. The database filters, counts and pages."""
    limit = min(limit or JD_LIST_PAGE, JD_LIST_PAGE)   # one call never returns more than a page; `total` says how many exist
    try:
        rows, total = await asyncio.to_thread(get_store().list_job_descriptions, q=q, category=category, offset=offset, limit=limit)
        return JSONResponse({"status": "success", "count": len(rows), "total": total, "jds": rows, "limit": limit, "offset": offset,
                             "category": category, "q": q})
    except Exception as e:
        logger.error(f"Failed to list JDs: {e}")
        raise HTTPException(status_code=500, detail="Failed to list JDs. Please try again or contact support.")


@router.get("/jd/{jd_id}")
async def get_jd_details(jd_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """Get details for a specific JD: its rows, plus what is stored in Qdrant for it."""
    try:
        store = get_store()
        d = await asyncio.to_thread(store.jd_detail, jd_id)
        if not d:
            raise HTTPException(status_code=404, detail=f"JD not found: {jd_id}")
        emb = await asyncio.to_thread(store.embeddings_info, jd_id, "jd")
        skills, responsibilities = d["skills"], d["responsibilities"]
        years = d["years_of_experience"] if d["years_of_experience"] is not None else "Not specified"
        response = {
            "id": jd_id, "filename": d["filename"] or "Unknown", "upload_date": d["upload_date"], "document_type": "jd",
            "job_requirements": {
                "job_title": d["job_title"] or "Not specified", "years_of_experience": years, "skills": skills,
                "skill_keywords": extract_skill_keywords(skills, limit=20), "responsibilities": responsibilities,
                "skills_count": len(skills), "responsibilities_count": len(responsibilities),
                "boolean_search_string": d["boolean_search_string"],
                "required_languages": d["required_languages"], "required_certifications": d["required_certifications"],
            },
            "boolean_search_string": d["boolean_search_string"],
            "embeddings_info": {
                "skills_embeddings": emb["skills"], "responsibilities_embeddings": emb["responsibilities"],
                "has_title_embedding": emb["has_title"], "embedding_dimension": emb["dimension"],
            },
            # the same facts under the names the page reads (built from the rows, not stored a second time)
            "structured_info": {
                "job_title": d["job_title"], "years_of_experience": d["years_of_experience"], "category": d["category"],
                "skills_sentences": skills, "responsibility_sentences": responsibilities, "boolean_search_string": d["boolean_search_string"],
                "required_languages": d["required_languages"], "required_certifications": d["required_certifications"],
            },
            "processing_metadata": {"model_used": d["llm_model"], "embedding_model": d["embedding_model"]},
        }
        return JSONResponse({"status": "success", "jd": response})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get JD details: {e}")
        raise HTTPException(status_code=500, detail="Failed to get JD details. Please try again or contact support.")


_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


@router.get("/jd/{jd_id}/preview")
async def preview_jd(jd_id: str, page: int = Query(1, ge=1), scale: float = Query(1.0, ge=0.5, le=2.5),
                     _: User = Depends(require_core_app)):
    """One page of the JD drawn as a PNG from its extracted text, for formats a browser cannot display itself
    (legacy .doc, RTF, ODT, HTML). Same as the CV preview. The page count is returned in ``X-Preview-Pages``."""
    if not _SAFE_ID_RE.match(jd_id or ""):
        raise HTTPException(status_code=400, detail="Invalid document id")
    doc = await asyncio.to_thread(get_store().jd_document, jd_id)
    if not doc:
        raise HTTPException(status_code=404, detail="JD not found")
    text = doc["raw_text"]
    if not text or not text.strip():
        raise HTTPException(status_code=404, detail="This JD has no extracted text to preview")
    png, total = await asyncio.to_thread(render_page_png, text, page, label=doc["filename"] or "", scale=scale)
    return Response(png, media_type="image/png", headers={
        "X-Preview-Pages": str(total), "Access-Control-Expose-Headers": "X-Preview-Pages",
        "Cache-Control": "private, max-age=300"})


@router.delete("/jd/{jd_id}")
async def delete_jd(jd_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """Delete a JD: its rows (skills, responsibilities, requirements) and its vectors in Qdrant. Job postings made from it stay."""
    try:
        filename = await asyncio.to_thread(get_store().delete_job_description, jd_id)
        if filename is None:
            raise HTTPException(status_code=404, detail=f"JD not found: {jd_id}")
        _invalidate_jd_list_cache()
        return JSONResponse({"status": "success", "message": f"Job Description '{filename}' deleted successfully", "deleted_jd_id": jd_id})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete JD: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete JD. Please try again or contact support.")


@router.get("/jd/{jd_id}/embeddings")
async def get_jd_embeddings_info(jd_id: str, _: User = Depends(require_core_app)) -> JSONResponse:
    """What is stored in Qdrant for a Job Description."""
    try:
        store = get_store()
        if not await asyncio.to_thread(store.jd_detail, jd_id):
            raise HTTPException(status_code=404, detail=f"JD not found: {jd_id}")
        e = await asyncio.to_thread(store.embeddings_info, jd_id, "jd")
        info = {
            "jd_id": jd_id, "embeddings_found": e["embeddings_found"],
            "skills": {"count": e["skills"], "embedding_dimension": e["dimension"] if e["skills"] else 0},
            "responsibilities": {"count": e["responsibilities"], "embedding_dimension": e["dimension"] if e["responsibilities"] else 0},
            "title_embedding": e["has_title"],
            "total_embeddings": e["skills"] + e["responsibilities"] + int(e["has_title"]),
        }
        return JSONResponse({"status": "success", "embeddings_info": info})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get JD embeddings info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get JD embeddings info. Please try again or contact support.")


@router.post("/standardize-jd")
async def standardize_jd_text(request: StandardizeJDRequest, _: User = Depends(require_core_app)) -> JSONResponse:
    """
    Standardize JD text using LLM without storing to database.
    Also returns dimensions/counts of the embeddings that WOULD be generated.
    """
    try:
        if not request.jd_text or not request.jd_text.strip():
            raise HTTPException(status_code=400, detail="JD text cannot be empty")
        if len(request.jd_text) > settings.MAX_TEXT_INPUT_CHARS:
            raise HTTPException(status_code=400, detail="JD text too long (max 50KB)")

        llm = get_llm_service()
        standardized = llm.standardize_jd(request.jd_text, request.jd_filename)

        emb_service = get_embedding_service()
        doc_embeddings = emb_service.generate_document_embeddings(standardized)

        dims = len(doc_embeddings["skill_vectors"][0]) if doc_embeddings["skill_vectors"] else 0
        return JSONResponse({
            "status": "success",
            "message": f"JD '{request.jd_filename}' standardized successfully",
            "filename": request.jd_filename,
            "standardized_data": standardized,
            "processing_stats": {
                "input_text_length": len(request.jd_text),
                "skills_count": len(standardized.get("skills_sentences", standardized.get("skills", []))),
                "responsibilities_count": len(standardized.get("responsibility_sentences", standardized.get("responsibilities", []))),
                "embeddings_info": {
                    "skills_count": len(doc_embeddings["skill_vectors"]),
                    "responsibilities_count": len(doc_embeddings["responsibility_vectors"]),
                    "vector_dimension": dims
                }
            }
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"JD text standardization failed: {e}")
        raise HTTPException(status_code=500, detail="JD standardization failed. Please try again or contact support.")
