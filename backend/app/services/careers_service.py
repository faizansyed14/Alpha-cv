"""
Enhanced Careers Service for Viral Traffic
==========================================

Async processing service designed to handle massive job application loads
without blocking the main API thread.
"""

import asyncio
import logging
import time
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def process_job_application_async(application_data: Dict[str, Any]) -> Dict[str, Any]:
    """Process a job-page application through the shared CV pipeline (app/ingestion/pipeline.py).

    Called by the queue consumer in the background worker and by the in-process fallback in the apply route, so an
    application is read, stored and linked the same way as an upload or a Naukri email. What the candidate typed on the
    form (nationality, current location, notice period, expected salary ...) is joined into the CV's record.
    """
    from app.ingestion.pipeline import (SOURCE_JOB_PAGE, CVSubmission, DuplicateApplication, IngestError,
                                        ingest_cv, release_application)
    from app.store import get_store

    start_time = time.time()
    application_id = application_data.get("application_id", "unknown")
    job_id = None
    try:
        logger.info(f"Processing application {application_id}")
        job = await asyncio.to_thread(get_store().get_job_posting_by_token, application_data["public_token"])
        if not job:
            raise IngestError(f"Job posting not found for token: {application_data['public_token']}", 404)
        job_id = job["id"]

        submission = CVSubmission(
            source=SOURCE_JOB_PAGE,
            cv_id=application_id,
            filename=application_data.get("cv_filename") or "application.pdf",
            persisted_path=application_data.get("cv_file_path"),
            mime_type=application_data.get("content_type"),
            content_sha256=application_data.get("content_sha256"),
            candidate={
                "name": application_data.get("applicant_name"), "email": application_data.get("applicant_email"),
                "phone": application_data.get("applicant_phone"),
                "expected_salary": application_data.get("expected_salary"),
                "years_of_experience": application_data.get("years_of_experience"),
                "location": application_data.get("location"), "notice_period": application_data.get("notice_period"),
                "nationality": application_data.get("nationality"),
            },
            job={"job_id": job["id"], "job_title": job.get("job_title"),
                 "public_token": application_data["public_token"]},
        )
        result = await asyncio.to_thread(ingest_cv, submission)

        processing_time = time.time() - start_time
        logger.info(f"Application {application_id} processed in {processing_time:.2f}s")
        return {
            "success": True, "application_id": application_id, "cv_id": result.cv_id, "merged": result.merged,
            "processing_time": processing_time,
            "message": f"Thank you, {application_data.get('applicant_name')}! Your application has been processed successfully.",
            "next_steps": "We'll review your application and contact you if there's a match.",
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"Application {application_id} failed after {time.time() - start_time:.2f}s: {e}")
        if not isinstance(e, DuplicateApplication):   # a failed attempt must not block the person from retrying
            release_application(application_data.get("applicant_email"), job_id, application_id)
        return {
            "duplicate": isinstance(e, DuplicateApplication),
            "success": False, "application_id": application_id, "error": str(e),
            "processing_time": time.time() - start_time,
            "message": "We're sorry, but there was an issue processing your application. Please try again later.",
        }
