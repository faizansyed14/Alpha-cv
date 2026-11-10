"""
Careers Routes - Public Job Postings & Applications
Handles:
  - HR job posting creation (authenticated)
  - Public job viewing (no auth required)
  - Public job applications (no auth required)
  - Admin management of job postings and applications
"""

import asyncio
import logging
import uuid
from datetime import datetime, date, timedelta
from typing import Literal, Optional, List, Any, Union
import tempfile

from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Depends, Query, status, BackgroundTasks
from fastapi.responses import JSONResponse
import hashlib
import os
from app.schemas.careers import (
    JobPostingResponse, 
    PublicJobView, 
    JobApplicationResponse,
    JobApplicationSummary,
    JobPostingSummary,
    JobStatusUpdate
)
from app.ingestion.cv_parser import get_parsing_service
from app.providers.llm.service import get_llm_service  
from app.providers.embeddings.service import get_embedding_service
from app.store import get_store
from app.providers.storage import get_storage_service
from app.services import locations_service
from app.api.deps import require_admin, require_core_app
from app.models.user import User
from app.config.settings import settings
from app.security.uploads import PUBLIC_CV_EXTENSIONS, secure_upload
from app.ingestion.pipeline import claim_application
from app.services.careers_helpers import (
    generate_public_token,
    generate_public_slug,
    now_iso,
    get_safe_applicant_name,
    generate_email_subject_id,
    generate_email_subject_template,
    generate_boolean_search_string,
    MAX_FILE_SIZE,
)

logger = logging.getLogger(__name__)
router = APIRouter()

def _preview_careers_list_text(value: Any, max_chars: int = 320) -> str:
    """Short previews for list endpoints (full text is available on detail endpoints)."""
    if value is None:
        return ""
    if isinstance(value, list):
        parts = [str(x).strip() for x in value if str(x).strip()]
        text = " ".join(parts)
    else:
        text = str(value)
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"

# ==================== PUBLIC ENDPOINTS (No Authentication) ====================

def _summary(job: dict, user: Optional[User] = None) -> JobPostingSummary:
    """One posting as the lists show it. The poster's name and role are internal: only a signed-in user (``user``) sees them."""
    is_owner = bool(user) and job.get("posted_by_user") == user.username
    is_admin = bool(user) and user.role == "admin"
    return JobPostingSummary(
        job_id=job["id"],
        job_title=job["job_title"],
        job_location=job["job_location"],
        job_summary=_preview_careers_list_text(job["job_summary"], 320),
        key_responsibilities=_preview_careers_list_text(job["key_responsibilities"], 320),
        qualifications=_preview_careers_list_text(job["qualifications"], 320),
        upload_date=job.get("upload_date") or now_iso(),
        filename=job.get("filename") or "job_description.pdf",
        is_active=job.get("is_active", True),
        application_count=int(job.get("application_count") or 0) if user else 0,
        public_token=job["public_token"],
        posted_by_user=job.get("posted_by_user") if user else None,
        posted_by_role=job.get("posted_by_role") if user else None,
        can_edit=is_owner or is_admin,
        can_delete=is_owner or is_admin,
        email_subject_id=job.get("email_subject_id") if user else None,
        email_subject_template=job.get("email_subject_template") if user else None,
        boolean_search_string=(job.get("boolean_search_string") or "") if user else None,
    )


@router.get("/jobs/recent", response_model=List[JobPostingSummary])
async def get_recent_job_postings(limit: int = 10) -> List[JobPostingSummary]:
    """
    Public endpoint: Get recent job postings (no authentication required)

    Returns the most recent active job postings for display on public job pages.
    Used to show "More Openings" section to candidates.
    """
    try:
        rows, _total = await asyncio.to_thread(get_store().list_job_postings, include_inactive=False, offset=0,
                                               limit=max(1, min(int(limit or 5), 50)))
        return [_summary(job) for job in rows]
    except Exception as e:
        logger.error(f"Failed to get recent job postings: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve recent job postings")


@router.get("/jobs/open")
async def search_open_jobs(
    q: Optional[str] = Query(None, max_length=200, description="Words of the job title or location"),
    skills: Optional[List[str]] = Query(None, max_length=10, description="Every skill must appear in the posting (repeat the parameter)"),
    region: Optional[Literal["UAE", "KSA", "Remote", "Not specified"]] = Query(None),
    areas: Optional[List[str]] = Query(None, max_length=30, description="Any of these words in the location (emirates, cities)"),
    limit: int = Query(12, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> dict:
    """Public endpoint: the open job postings, searched and paged by the database (the careers page's search, location tabs and skills)."""
    try:
        rows, total = await asyncio.to_thread(get_store().list_public_postings, q=q, skills=skills, region=region, areas=areas,
                                              offset=offset, limit=limit)
        return {"jobs": [_summary(job) for job in rows], "total": total}
    except Exception as e:
        logger.error(f"Failed to search open jobs: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve job openings")


@router.get("/jobs/{public_token}", response_model=PublicJobView)
async def get_public_job(public_token: str) -> PublicJobView:
    """
    Public endpoint: View job posting (no authentication required)

    This endpoint must be accessible to anyone with the link.
    Returns structured job information for display to candidates.
    """
    try:
        job = await asyncio.to_thread(get_store().get_job_posting_by_token, public_token, True)
        if not job:
            raise HTTPException(status_code=404, detail="Job posting not found")

        years = job.get("years_of_experience")
        return PublicJobView(
            job_id=job["id"],
            job_title=job["job_title"] or "Position Available",
            job_location=job["job_location"],
            job_description=job["job_summary"] or "Job description not available",
            upload_date=job.get("created_date") or now_iso(),
            requirements=job["skills"][:10],               # top 10 for display
            responsibilities=job["responsibilities"][:10],
            experience_required=f"{years:g} years" if isinstance(years, (int, float)) else "Not specified",
            is_active=job.get("is_active", True),          # the actual status: a closed job still shows, as closed
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get public job: {e}")
        raise HTTPException(status_code=500, detail="Failed to load job posting")

@router.get("/locations/search")
async def search_locations(q: str = "", limit: int = 10) -> JSONResponse:
    """Public city/country autocomplete for the apply form's "current location"
    field. Local dataset (GeoNames), no external API call, no auth required -
    candidates use this before they've logged in.
    """
    limit = max(1, min(limit, 20))
    results = locations_service.search_locations(q, limit=limit)
    return JSONResponse({"results": results})


@router.post("/jobs/{public_token}/autofill")
async def autofill_from_cv(public_token: str, cv_file: UploadFile = File(...)) -> dict:
    """Public endpoint: read a dropped CV and return the form values that can be filled with certainty.

    Same parsers, same contact extraction and the same `standardize_cv` prompt as the application itself; nothing is
    stored (the file is read from a temp file that is deleted), and the AI reading is parked in Redis for 30 minutes so
    submitting the form does not call the model again. Rate-limited like an application."""
    from app.ingestion.autofill import build_autofill, cached_standardized, park_standardized
    from app.ingestion.pipeline import _llm_slots

    job_data = await asyncio.to_thread(get_store().get_job_posting_by_token, public_token, True)
    if not job_data or not job_data.get("is_active", True):
        raise HTTPException(status_code=404, detail="Job posting not found or no longer active")
    content, _name, _kind = await secure_upload(cv_file, PUBLIC_CV_EXTENSIONS)   # size, real type, bombs, macros, scripts, virus scan
    ext = os.path.splitext(cv_file.filename or "")[1].lower() or ".pdf"

    def work() -> dict:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(content)
            path = tmp.name
        try:
            parsed = get_parsing_service().process_document(path, "cv")
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        text = parsed.get("clean_text") or ""
        if len(text.strip()) < 50:
            return {"fields": {}, "sources": {}, "readable": False}
        standardized = cached_standardized(text)
        if standardized is None:
            try:
                with _llm_slots:
                    standardized = get_llm_service().standardize_cv(text, cv_file.filename or "cv")
                park_standardized(text, standardized)
            except Exception as exc:  # noqa: BLE001 - autofill must never block the form
                logger.warning(f"Autofill AI reading failed, offering parser results only: {exc}")
                standardized = None
        result = build_autofill(parsed, standardized)
        result["readable"] = True
        return result

    try:
        return await asyncio.to_thread(work)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Autofill failed: {exc}")
        return {"fields": {}, "sources": {}, "readable": False}


@router.post("/jobs/{public_token}/apply", response_model=JobApplicationResponse)
async def apply_to_job(
    public_token: str,
    background_tasks: BackgroundTasks,
    applicant_name: str = Form(..., min_length=1, max_length=100),
    applicant_email: str = Form(...),
    applicant_phone: Optional[str] = Form(None),
    expected_salary: float = Form(..., description="Expected salary in AED"),
    years_of_experience: float = Form(..., description="Years of experience"),
    location: Optional[str] = Form(None, max_length=200, description="Candidate's current location"),
    notice_period: Optional[str] = Form(None, max_length=50, description="Candidate's notice period"),
    nationality: Optional[str] = Form(None, max_length=100, description="Candidate's nationality"),
    cv_file: UploadFile = File(...),
    background_processing: bool = Form(True)  # Enable async processing by default
) -> JobApplicationResponse:
    """
    Public endpoint: Submit application (no authentication required)
    
    Supports both synchronous and asynchronous processing:
    - background_processing=True: Fast response, processes in background (recommended for high traffic)
    - background_processing=False: Traditional sync processing (immediate result)
    
    Pipeline:
    1. Validate job exists and is active
    2. Validate application data and CV file
    3. Either process immediately OR queue for background processing
    4. Return confirmation with tracking info
    """
    try:
        logger.info(f"Application received for job token: {public_token[:8]}... from {applicant_name} (async: {background_processing})")
        
        # 1. Verify job exists and is active
        store = get_store()
        job_data = await asyncio.to_thread(store.get_job_posting_by_token, public_token, True)
        if not job_data:
            raise HTTPException(status_code=404, detail="Job posting not found or no longer active")
            
        if not job_data.get("is_active", True):
            raise HTTPException(status_code=400, detail="This job posting is no longer accepting applications")
        
        # 2. Validate the CV file: size while reading, real type, zip/PDF bombs, macros, scripts, optional virus scan
        file_content, _name, _kind = await secure_upload(cv_file, PUBLIC_CV_EXTENSIONS)
        
        # Basic email validation
        if "@" not in applicant_email or "." not in applicant_email:
            raise HTTPException(status_code=400, detail="Please provide a valid email address")
        
        application_id = str(uuid.uuid4())

        # One application per person per job: refuse a repeat immediately, with a message the form can show.
        applicant_key = applicant_email.strip().lower()
        prior = await asyncio.to_thread(store.check_existing_application, applicant_key, job_data["id"])
        if prior:
            raise HTTPException(status_code=409, detail="You have already applied to this job. "
                                "We have your application and will be in touch if there is a match.")
        if not await asyncio.to_thread(claim_application, applicant_key, job_data["id"], application_id):
            raise HTTPException(status_code=409, detail="Your application for this job is already being processed.")

        content_sha256 = hashlib.sha256(file_content).hexdigest()  # for duplicate-CV detection
        
        # Store CV file (local uploads folder; storage service may be S3 or local)
        persisted_path = None
        if cv_file.filename:
            file_ext = os.path.splitext(cv_file.filename)[1].lower() or '.pdf'
            s3_service = get_storage_service()
            dest_dir = os.path.join(s3_service.base_dir, "cvs")
            os.makedirs(dest_dir, exist_ok=True)
            dest_path = os.path.join(dest_dir, f"{application_id}{file_ext}")

            try:
                # Primary: use storage service (handles local copy or S3)
                with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                    tmp.write(file_content)
                    tmp_path = tmp.name
                persisted_path = s3_service.upload_file(tmp_path, application_id, "cv", file_ext)
                logger.info(f"Job application CV stored: {persisted_path}")
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
            except Exception as e:
                logger.error(f"Storage upload failed for job application CV: {e}")
                # Fallback: write raw file to uploads/cvs so PDF is always available for preview/download
                try:
                    with open(dest_path, "wb") as f:
                        f.write(file_content)
                    persisted_path = dest_path
                    logger.info(f"Job application CV saved to uploads fallback: {persisted_path}")
                except Exception as fallback_err:
                    logger.error(f"Fallback save to uploads failed: {fallback_err}")
                    persisted_path = None
        
        application_data = {
            "application_id": application_id,
            "applicant_name": applicant_name,
            "applicant_email": applicant_email,
            "applicant_phone": applicant_phone,
            "expected_salary": expected_salary,
            "years_of_experience": years_of_experience,
            "location": location,
            "notice_period": notice_period,
            "nationality": nationality,
            "cv_file_path": persisted_path,
            "cv_filename": cv_file.filename,
            "content_type": cv_file.content_type,
            "content_sha256": content_sha256,
            "public_token": public_token
        }


        if background_processing:
            # Preferred: Redis-backed queue handled by a dedicated worker container
            try:
                from app.jobs.public_cv_queue import enqueue_public_application, is_public_cv_queue_enabled

                if is_public_cv_queue_enabled():
                    job_id = enqueue_public_application(application_data)
                    return JobApplicationResponse(
                        success=True,
                        application_id=application_id,
                        message=f"Thank you, {applicant_name}! Your application has been received and queued for processing.",
                        next_steps=f"Your CV is being processed in the background. Check status at /api/careers/applications/{application_id}/status",
                        job_id=job_id,
                    )
            except Exception as queue_error:
                logger.warning(f"Public CV queue enqueue failed, falling back to in-process background task: {queue_error}")
                # Continue to in-process path below
    
    

        # In-process fallback (queue disabled / unavailable, or background_processing=False): the same function the
        # queue worker runs, so there is one way a job-page application is processed.
        background_tasks.add_task(_process_application_in_process, application_data)

        # Return immediate response
        return JobApplicationResponse(
            success=True,
            application_id=application_id,
            message=f"Thank you, {applicant_name}! Your application is being processed with our optimized systems.",
            next_steps=f"Your CV is being processed in the background. Check status at /api/careers/applications/{application_id}/status",
            job_id=application_id
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process application: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit application. Please try again later.")


async def _process_application_in_process(application_data: dict) -> None:
    """Run the shared application pipeline in this process and record its status for the status endpoint."""
    from app.api.routers.cvs import update_cv_upload_progress
    from app.services.careers_service import process_job_application_async

    application_id = application_data["application_id"]
    update_cv_upload_progress(application_id, status="processing", progress_percent=5)
    result = await process_job_application_async(application_data)
    if result.get("success"):
        update_cv_upload_progress(application_id, status="completed", progress_percent=100)
    else:
        update_cv_upload_progress(application_id, status="failed", current_step=result.get("error"))


@router.get("/applications/{application_id}/status")
async def get_application_status(application_id: str) -> JSONResponse:
    """Get background processing status for a public-link application.

    Works for both:
    - Redis queue worker mode (ENABLE_PUBLIC_CV_QUEUE=true)
    - Legacy in-process background task mode (uses /api/cv/cv-upload-progress/{id})
    """
    # 1) Prefer Redis queue status (new worker path)
    try:
        from app.jobs.public_cv_queue import get_public_job_status

        st = get_public_job_status(application_id)
        if st:
            return JSONResponse({"source": "redis_queue", **st})
    except Exception:
        pass

    # 2) Fallback to in-process progress tracker (legacy path)
    try:
        from app.api.routers.cvs import _cv_upload_progress  # type: ignore

        prog = _cv_upload_progress.get(application_id)
        if prog:
            return JSONResponse({"source": "in_process", **prog})
    except Exception:
        pass

    return JSONResponse({"source": "none", "status": "not_found", "application_id": application_id}, status_code=404)


# ==================== HR/ADMIN ENDPOINTS (May require authentication later) ====================

@router.post("/admin/jobs/post", response_model=JobPostingResponse)
async def post_job(
    # Form data fields for manual job posting
    job_title: Optional[str] = Form(None),
    job_location: Optional[str] = Form(None),
    job_summary: Optional[str] = Form(None),
    key_responsibilities: Optional[str] = Form(None),
    qualifications: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_core_app)
) -> JobPostingResponse:
    """
    HR endpoint: Upload job description → create public link
    
    Pipeline:
    1. Validate file upload (if provided) or form data
    2. Extract text using parsing service (if file) or use form data
    3. Process with LLM service (extract title, requirements, etc.) or use form data
    4. Generate public access token
    5. Store in job_postings_* collections
    6. Also store in jd_* collections for main database view
    7. Return public link
    """
    try:
        # Check if we have file or form data
        has_file = file is not None and file.filename
        has_form_data = any([job_title, job_location, job_summary, key_responsibilities, qualifications])
        
        if not has_file and not has_form_data:
            raise HTTPException(status_code=400, detail="Either file upload or form data must be provided")
        
        if has_file:
            logger.info(f"HR job posting upload: {file.filename}")
            # 1. Validate file (same checks as a visitor's CV)
            await secure_upload(file, PUBLIC_CV_EXTENSIONS)
        
        job_id = str(uuid.uuid4())
        public_token = generate_public_token()
        
        # 2. Process data (file or form)
        if has_file:
            # Extract text from file
            file_content = await file.read()
            if len(file_content) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB")
            
            
            # Get file extension for temp file
            file_ext = '.' + file.filename.split('.')[-1].lower() if '.' in file.filename else '.txt'
            
            # Save to temporary file for parsing
            with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                tmp.write(file_content)
                tmp_path = tmp.name
            
            try:
                parsing_service = get_parsing_service()
                parsed = parsing_service.process_document(tmp_path, "jd")
                extracted_text = parsed["clean_text"]
            finally:
                # Clean up temporary file
                os.unlink(tmp_path)
            
            if not extracted_text or len(extracted_text.strip()) < 100:
                raise HTTPException(status_code=400, detail="Could not extract sufficient text from job description. Please check the file format.")
            
            # 3. Process with LLM service to extract structured data
            llm_service = get_llm_service()
            llm_result = llm_service.standardize_jd(extracted_text, file.filename)
            
            # Extract job title for response
            final_job_title = "Position Available"
            if llm_result:
                # Check both direct job_title and structured_info.job_title
                final_job_title = llm_result.get("job_title") or llm_result.get("structured_info", {}).get("job_title", final_job_title)
        else:
            # Use form data directly
            logger.info(f"HR job posting from form data: {job_title}")
            
            # Create structured data from form inputs
            llm_result = {
                "doc_type": "job_description",
                "job_title": job_title or "Position Available",
                "years_of_experience": None,
                "job_category": None,
                "seniority_level": None,
                "role_family": None,
                "skills_sentences": [qual for qual in (qualifications or "").split('\n') if qual.strip()][:20],
                "responsibility_sentences": [resp for resp in (key_responsibilities or "").split('\n') if resp.strip()][:10],
                "structured_info": {
                    "job_title": job_title or "Position Available",
                    "location": job_location or "",
                    "job_location": job_location or "",
                    "job_summary": job_summary or "",
                    "summary": job_summary or "",
                    "responsibilities": [resp for resp in (key_responsibilities or "").split('\n') if resp.strip()],
                    "skills": [qual for qual in (qualifications or "").split('\n') if qual.strip()]
                }
            }
            
            # Use form data for text content
            extracted_text = f"{job_title or 'Position Available'}\n\n{job_summary or ''}\n\nResponsibilities:\n{key_responsibilities or ''}\n\nQualifications:\n{qualifications or ''}"
            final_job_title = job_title or "Position Available"
        
        # 4. Generate email subject ID and template
        email_subject_id = generate_email_subject_id(final_job_title)
        email_subject_template = generate_email_subject_template(final_job_title, email_subject_id)
        public_token = generate_public_slug(final_job_title, email_subject_id)   # the readable public link
        logger.info(f"Generated email subject: {email_subject_template}")

        # 4b. Boolean search string (Naukri Gulf). Prefer the LLM's value, else build one
        # deterministically from the title + skills so it is never empty.
        _llm_bool = (llm_result or {}).get("boolean_search_string") or ""
        _skills_for_bool = (
            (llm_result or {}).get("skills_sentences")
            or (llm_result or {}).get("structured_info", {}).get("skills")
            or (llm_result or {}).get("skills")
            or []
        )
        boolean_search_string = _llm_bool.strip() or generate_boolean_search_string(final_job_title, _skills_for_bool)
        logger.info(f"Boolean search string: {boolean_search_string}")

        # 5. Generate embeddings
        embedding_service = get_embedding_service()
        embeddings_data = embedding_service.generate_document_embeddings(llm_result)

        # 6. Store the description and the posting (PostgreSQL), and the description's vectors (Qdrant)
        store = get_store()
        filename = file.filename if has_file else f"job_posting_{job_id}.txt"
        content_type = file.content_type if has_file else "text/plain"
        standardized = {**llm_result, "boolean_search_string": boolean_search_string}
        store.save_job_description({
            "id": job_id, "filename": filename, "file_format": os.path.splitext(filename)[1].lstrip("."), "mime_type": content_type,
            "raw_text": extracted_text, "standardized": standardized,
            "llm_model": (llm_result.get("processing_metadata") or {}).get("model_used") if isinstance(llm_result, dict) else None,
        })
        stored = store.store_embeddings("jd", job_id, embeddings_data)
        if stored:
            store.create_job_posting({
                "id": job_id, "job_description_id": job_id, "public_token": public_token, "posted_by_user": current_user.username, "posted_by_role": current_user.role,
                "email_subject_id": email_subject_id, "email_subject_template": email_subject_template,
            })
            if not has_file:    # typed in the form: the public page shows exactly what was typed
                store.update_job_posting(job_id, {
                    "job_title": job_title or "Position Available", "job_location": job_location or "", "job_summary": job_summary or "",
                    "key_responsibilities": key_responsibilities or "", "qualifications": qualifications or ""})
        if not stored:
            store.delete_job_description(job_id)
            logger.error(f"Failed to store job posting {job_id}")
            raise HTTPException(status_code=500, detail="Failed to create job posting. Please try again.")

        # 7. Build public link
        # In production, use proper domain from config
        base_url = settings.FRONTEND_URL
        public_link = f"{base_url}/careers/jobs/{public_token}"
        
        logger.info(f"Job posting created: {job_id} with public link")
        
        return JobPostingResponse(
            job_id=job_id,
            public_link=public_link,
            public_token=public_token,
            job_title=final_job_title,
            upload_date=now_iso(),
            filename=filename,
            is_active=True,
            posted_by_user=current_user.username,
            posted_by_role=current_user.role,
            email_subject_id=email_subject_id,
            email_subject_template=email_subject_template,
            boolean_search_string=boolean_search_string
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to post job: {e}")
        raise HTTPException(status_code=500, detail="Failed to create job posting. Please try again later.")
@router.get("/admin/jobs", response_model=Union[List[JobPostingSummary], dict])
async def list_job_postings(
    include_inactive: bool = False,
    limit: Optional[int] = Query(None, ge=1, le=200),
    offset: Optional[int] = Query(None, ge=0),
    q: Optional[str] = Query(None, max_length=200, description="Search the title, poster, e-mail subject or id of every posting"),
    scope: Literal["all", "mine", "others"] = Query("all", description="Only the postings you posted, or only the others'"),
    status_filter: Literal["all", "active", "inactive"] = Query("all", alias="status", description="Only open or only closed postings"),
    current_user: User = Depends(require_core_app)
) -> Union[List[JobPostingSummary], dict]:
    """List job postings for the HR dashboard. Everyone sees every posting; edit / delete rights are the poster's and the admin's."""
    try:
        paged = not (limit is None and offset is None)
        # Backwards compatible default: legacy clients call without pagination params.
        rows, total = await asyncio.to_thread(
            get_store().list_job_postings, include_inactive=include_inactive,
            offset=int(offset or 0) if paged else 0, limit=int(limit or 25) if paged else 1000, q=q,
            posted_by=current_user.username if scope == "mine" else None, not_posted_by=current_user.username if scope == "others" else None,
            status=None if status_filter == "all" else status_filter)
        summaries = [_summary(job, current_user) for job in rows]
        logger.info(f"Found {len(summaries)} job postings (total={total})")
        if not paged:
            return summaries
        counts = await asyncio.to_thread(
            get_store().posting_status_counts, q=q, posted_by=current_user.username if scope == "mine" else None,
            not_posted_by=current_user.username if scope == "others" else None)
        return {"jobs": summaries, "total": total, "counts": counts}
    except Exception as e:
        logger.error(f"Failed to list job postings: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve job postings")


@router.get("/admin/overview", response_model=dict)
async def careers_overview(current_user: User = Depends(require_core_app)) -> dict:
    """The dashboard's numbers: postings live and closed, applications (total, per day), postings per month, the busiest postings
    and the newest ones. Counted by the database over every posting; counts and titles only, no candidate data."""
    try:
        return await asyncio.to_thread(get_store().careers_overview)
    except Exception as e:
        logger.error(f"Failed to build the careers overview: {e}")
        raise HTTPException(status_code=500, detail="Failed to load the overview")


@router.get("/admin/jobs-trends", response_model=dict)
async def job_application_trends(
    days: int = 14,
    current_user: User = Depends(require_core_app),
) -> dict:
    """Applications received per day for each job over the last ``days`` days (oldest first), for the Careers
    performance charts. Counts only: no candidate data."""
    from collections import defaultdict
    from datetime import timedelta

    days = max(1, min(int(days or 14), 90))
    today = datetime.utcnow().date()
    labels = [(today - timedelta(days=days - 1 - i)) for i in range(days)]
    index = {d.isoformat(): i for i, d in enumerate(labels)}
    series: dict = defaultdict(lambda: [0] * days)
    try:
        rows = await asyncio.to_thread(get_store().application_counts_by_day, datetime.combine(labels[0], datetime.min.time()))
    except Exception as e:
        logger.warning(f"job trends failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to load trends")
    for posting_id, day, count in rows:
        if day in index:
            series[posting_id][index[day]] += count
    return {"days": [d.isoformat() for d in labels], "series": dict(series)}


@router.get("/admin/reports/weekly", response_model=dict)
async def weekly_analysis_report(
    start_date: str,
    end_date: str,
    current_admin: User = Depends(require_admin),  # ADMIN ONLY
):
    """Return lightweight stats for a weekly analysis report.

    This endpoint is intentionally aggregate-only (no CV text, no large payloads) so it can be
    called on demand without impacting normal Careers operations.
    """
    try:
        def _parse_ymd(v: str) -> date:
            try:
                return datetime.strptime(v.strip(), "%Y-%m-%d").date()
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

        start = _parse_ymd(start_date)
        end = _parse_ymd(end_date)
        if end < start:
            raise HTTPException(status_code=400, detail="end_date must be >= start_date")

        in_range = await asyncio.to_thread(get_store().postings_between, datetime.combine(start, datetime.min.time()),
                                           datetime.combine(end + timedelta(days=1), datetime.min.time()))

        recruiter_counts: dict[str, int] = {}
        by_recruiter: dict[str, list[dict]] = {}
        for j in in_range:
            poster = (j.get("posted_by_user") or "Unknown").strip() or "Unknown"
            recruiter_counts[poster] = recruiter_counts.get(poster, 0) + 1
            by_recruiter.setdefault(poster, []).append(
                {"job_id": str(j["id"]), "job_title": str(j.get("job_title") or "Position Available"),
                 "applications": int(j.get("application_count") or 0)})

        recruiters_sorted = sorted(recruiter_counts.items(), key=lambda x: (-x[1], x[0].lower()))     # stable ordering for the UI/doc output
        return {
            "range": {"start_date": start.isoformat(), "end_date": end.isoformat()},
            "total_jobs_posted": len(in_range),
            "recruiters_posted": [{"recruiter": name, "jobs_posted": count} for name, count in recruiters_sorted],
            "applications_by_recruiter": {
                name: sorted(rows, key=lambda r: r.get("job_title", "").lower())
                for name, rows in by_recruiter.items()
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"weekly_analysis_report failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate weekly report")

def _posting_text(job: dict) -> dict:
    """The fields the job form and the matcher read, for one posting."""
    return {
        "job_title": job["job_title"], "job_location": job["job_location"], "job_summary": job["job_summary"],
        "key_responsibilities": job["key_responsibilities"], "qualifications": job["qualifications"],
        "jd_id": job.get("jd_id") or job["id"],   # jd_id: what the frontend matches against
    }


@router.get("/admin/jobs/{job_id}/match-data", response_model=dict)
async def get_job_for_matching(job_id: str, current_user: User = Depends(require_core_app)) -> dict:
    """Get job data for matching - all users can access any job for matching purposes"""
    try:
        job = await asyncio.to_thread(get_store().get_job_posting_by_id, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job posting not found")
        return _posting_text(job)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job data for matching: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve job data")


def _own_job_or_403(job: dict, user: User, action: str) -> None:
    if user.role != "admin" and job.get("posted_by_user") != user.username:
        logger.warning(f"Unauthorized {action} attempt: {user.username} on a job posted by {job.get('posted_by_user')}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You can only {action} job postings that you created")


@router.get("/admin/jobs/{job_id}/edit-data", response_model=dict)
async def get_job_for_edit(job_id: str, current_user: User = Depends(require_core_app)) -> dict:
    """Get job data for editing - users can only edit their own jobs"""
    try:
        job = await asyncio.to_thread(get_store().get_job_posting_by_id, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job posting not found")
        _own_job_or_403(job, current_user, "edit")
        return _posting_text(job)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job data for editing: {e}")
        raise HTTPException(status_code=500, detail="Failed to get job data for editing")


@router.patch("/admin/jobs/{job_id}/status", response_model=dict)
async def toggle_job_status(
    job_id: str,
    status_update: JobStatusUpdate,
    current_user: User = Depends(require_core_app)
) -> dict:
    """Activate/deactivate job postings - users can only toggle their own jobs"""
    try:
        store = get_store()
        job = await asyncio.to_thread(store.get_job_posting_by_id, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job posting not found")
        _own_job_or_403(job, current_user, "toggle status of")
        if not await asyncio.to_thread(store.update_job_posting, job_id, {"is_active": status_update.is_active}):
            raise HTTPException(status_code=404, detail="Job posting not found")
        return {
            "success": True,
            "job_id": job_id,
            "is_active": status_update.is_active,
            "message": f"Job posting {'activated' if status_update.is_active else 'deactivated'} successfully",
            "reason": status_update.reason
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update job status: {e}")
        raise HTTPException(status_code=500, detail="Failed to update job status")

@router.get("/admin/jobs/{job_id}/applications", response_model=List[JobApplicationSummary])
async def get_job_applications(
    job_id: str,
    limit: int = Query(1000, ge=1, le=5000, description="Applications per call (a posting closes itself at 250, so this is rarely reached)"),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_core_app),
) -> List[JobApplicationSummary]:
    """The applications to a specific job, newest first"""
    try:
        store = get_store()
        if not await asyncio.to_thread(store.get_job_posting_by_id, job_id):
            raise HTTPException(status_code=404, detail="Job posting not found")
        applications = await asyncio.to_thread(store.applications_for_job, job_id, limit, offset)
        summaries = [
            JobApplicationSummary(
                application_id=app["id"],
                job_id=job_id,
                applicant_name=get_safe_applicant_name(app),      # never null: falls back to the e-mail, then "Applicant"
                applicant_email=app.get("applicant_email") or "unknown@email.com",
                applicant_phone=app.get("applicant_phone"),
                linkedin_url=app.get("linkedin_url"),
                github_url=app.get("github_url"),
                application_date=app.get("application_date") or "Unknown",
                cv_filename=app.get("cv_filename") or "unknown.pdf",
                expected_salary=app.get("expected_salary"),
                years_of_experience=app.get("years_of_experience"),
                location=app.get("location"),
                notice_period=app.get("notice_period"),
                nationality=app.get("nationality"),
                status=app.get("status") or "pending",
                source=app.get("source") or "website",
            )
            for app in applications
        ]
        logger.info(f"Found {len(summaries)} applications for job {job_id}")
        return summaries
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job applications: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve applications")


# ==================== UTILITY ENDPOINTS ====================

@router.post("/admin/jobs/{jd_id}/extract-ui-data")
async def extract_jd_for_ui(jd_id: str, _: User = Depends(require_core_app)) -> dict:
    """
    Extract human-readable data from already processed JD for UI display.
    This is separate from the matching pipeline and uses a different LLM prompt.
    """
    try:
        logger.info(f"Extracting UI data for JD: {jd_id}")
        
        jd_doc = await asyncio.to_thread(get_store().jd_document, jd_id)
        if not jd_doc:
            raise HTTPException(status_code=404, detail="JD not found")

        # Use the original text and send it to the LLM for auto-fill
        raw_content = jd_doc["raw_text"]

        if not raw_content:
            raise HTTPException(status_code=400, detail="No raw content found in JD document")
        
        logger.info(f"Using raw content for auto-fill, length: {len(raw_content)}")
        
        # Send raw content to LLM for UI extraction
        llm_service = get_llm_service()
        ui_data = llm_service.extract_jd_for_ui_display(raw_content, "auto_fill")
        
        if not ui_data:
            raise HTTPException(status_code=500, detail="Failed to extract UI data from JD")
        
        logger.info(f"UI data extracted from raw content via LLM")
        
        if not ui_data:
            raise HTTPException(status_code=500, detail="Failed to extract UI data")
        
        logger.info(f"UI data extracted successfully for JD: {jd_id}")
        
        return {
            "success": True,
            "jd_id": jd_id,  # Return the original JD ID for the next step
            "job_title": ui_data.get("job_title", ""),
            "job_location": ui_data.get("job_location", ""),
            "job_summary": ui_data.get("job_summary", ""),
            "key_responsibilities": ui_data.get("key_responsibilities", ""),
            "qualifications": ui_data.get("qualifications", "")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to extract UI data: {e}")
        raise HTTPException(status_code=500, detail="Failed to extract UI data")




@router.post("/admin/jobs/unified-update")
async def unified_job_update(
    jd_id: Optional[str] = Form(None),
    job_id: Optional[str] = Form(None),
    job_title: str = Form(...),
    job_location: str = Form(...),
    job_summary: str = Form(...),
    key_responsibilities: str = Form(...),
    qualifications: str = Form(...),
    current_user: User = Depends(require_core_app)
) -> dict:
    """
    Unified endpoint for creating or updating job postings.
    - If job_id is provided: Update existing job posting
    - If jd_id is provided (and no job_id): Create new job posting from JD
    """
    try:
        store = get_store()
        text = {"job_title": job_title, "job_location": job_location, "job_summary": job_summary,
                "key_responsibilities": key_responsibilities, "qualifications": qualifications}

        if job_id:
            existing = await asyncio.to_thread(store.get_job_posting_by_id, job_id)
            if not existing:
                raise HTTPException(status_code=404, detail="Job posting not found")
            _own_job_or_403(existing, current_user, "update")
            # Boolean search string: keep the existing one if present, else build it from the (possibly edited) title + skills.
            skills = [q for q in (qualifications or "").split("\n") if q.strip()]
            boolean_search_string = (existing.get("boolean_search_string") or "").strip() or generate_boolean_search_string(job_title, skills)
            ok = await asyncio.to_thread(store.update_job_posting, job_id, {
                **text, "boolean_search_string": boolean_search_string})
            if not ok:
                raise HTTPException(status_code=500, detail="Failed to update job posting")
            return {"success": True, "job_id": job_id, "public_token": existing.get("public_token"), "message": "Job posting updated successfully"}

        elif jd_id:
            jd = await asyncio.to_thread(store.get_structured_jd, jd_id)
            if not jd:
                raise HTTPException(status_code=404, detail="Original JD not found")
            new_job_id = str(uuid.uuid4())
            email_subject_id = generate_email_subject_id(job_title)
            email_subject_template = generate_email_subject_template(job_title, email_subject_id)
            public_token = generate_public_slug(job_title, email_subject_id)   # the readable public link
            # Boolean search string: prefer the JD's LLM-generated string, else build one from the title + skills.
            llm_bool = ((jd.get("structured_info") or {}).get("boolean_search_string") or "").strip()
            boolean_search_string = llm_bool or generate_boolean_search_string(
                job_title, jd.get("skills_sentences") or [q for q in (qualifications or "").split("\n") if q.strip()])
            await asyncio.to_thread(store.create_job_posting, {
                "id": new_job_id, "job_description_id": jd_id, "public_token": public_token, "posted_by_user": current_user.username, "posted_by_role": current_user.role,
                "email_subject_id": email_subject_id, "email_subject_template": email_subject_template})
            await asyncio.to_thread(store.update_job_posting, new_job_id, {**text, "boolean_search_string": boolean_search_string})
            logger.info(f"New job posting created: {new_job_id}")
            return {"success": True, "job_id": new_job_id, "public_token": public_token, "message": "Job posting created successfully"}
        else:
            raise HTTPException(status_code=400, detail="Either job_id (for update) or jd_id (for create) must be provided")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process job update: {e}")
        raise HTTPException(status_code=500, detail="Failed to process job update")


@router.delete("/admin/jobs/{job_id}")
async def delete_job_posting(
    job_id: str,
    current_user: User = Depends(require_core_app)  # Allow both admin and user
) -> JSONResponse:
    """
    Delete a specific job posting (soft deletion): it disappears from every list, its description is hidden
    from the library, and its applications are kept, archived. Admins can delete any posting; users their own.
    """
    try:
        store = get_store()
        job = await asyncio.to_thread(store.get_job_posting_by_id, job_id)
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job posting with ID {job_id} not found")
        _own_job_or_403(job, current_user, "delete")
        results = await asyncio.to_thread(store.soft_delete_job_posting, job_id, current_user.username)
        if not results["success"]:
            raise HTTPException(status_code=500, detail=f"Failed to delete job posting: {results.get('error', 'Unknown error')}")
        logger.info(f"Soft-deleted job posting {job_id} by {current_user.username}")
        return JSONResponse({
            "success": True,
            "message": f"Job posting {job_id} deleted successfully",
            "details": results,
            "deleted_by": {"username": current_user.username, "role": current_user.role, "timestamp": datetime.utcnow().isoformat()},
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during job posting {job_id} deletion by {current_user.username}: {e}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred while deleting the job posting. Please try again later.")
