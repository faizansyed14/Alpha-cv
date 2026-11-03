"""Queued CV uploads: the work the ingest worker does for one uploaded file.

The upload route only validates the file, keeps the original in storage and enqueues this job, so a batch of 50 CVs
is accepted in moments and the heavy work (reading / OCR, the LLM, embeddings, storing) happens in the background
worker, many files at a time. Progress is published under the CV id for the upload page to follow.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict

from app.ingestion.pipeline import SOURCE_UPLOAD, CVSubmission, IngestError, ingest_cv
from app.jobs.public_cv_queue import set_public_job_status

logger = logging.getLogger(__name__)

KIND_CV_UPLOAD = "cv_upload"


async def process_cv_upload(job: Dict[str, Any]) -> None:
    """Run the shared ingestion pipeline for one queued upload and record how it went."""
    cv_id = job["application_id"]                      # the queue keys jobs by this field; for uploads it is the CV id
    started = time.time()

    def progress(percent: int, step: str) -> None:
        set_public_job_status(cv_id, status="processing", progress_percent=percent, current_step=step)

    set_public_job_status(cv_id, status="processing", started_at=started, progress_percent=1,
                          current_step="Starting", filename=job.get("filename"), error=None)
    try:
        result = await asyncio.to_thread(ingest_cv, CVSubmission(
            source=SOURCE_UPLOAD, cv_id=cv_id, filename=job["filename"], persisted_path=job["persisted_path"],
            mime_type=job.get("mime_type"), progress=progress))
    except IngestError as exc:
        set_public_job_status(cv_id, status="failed", finished_at=time.time(), error=str(exc), current_step=str(exc))
        logger.warning(f"Queued upload {cv_id} rejected: {exc}")
        return
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop the worker
        set_public_job_status(cv_id, status="failed", finished_at=time.time(), error=str(exc), current_step=str(exc))
        logger.error(f"Queued upload {cv_id} failed: {exc}")
        return

    set_public_job_status(cv_id, status="completed", finished_at=time.time(), progress_percent=100,
                          current_step="Processing completed successfully", cv_id=result.cv_id, merged=result.merged,
                          processing_stats=result.stats)
    logger.info(f"Queued upload {cv_id} done in {time.time() - started:.1f}s")
