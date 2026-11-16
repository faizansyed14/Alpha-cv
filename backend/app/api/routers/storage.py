import asyncio
import os
import re
import tempfile
import logging
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask

from app.api.deps import require_core_app
from app.models.user import User
from app.providers.storage import get_storage_service
from app.store import get_store

logger = logging.getLogger(__name__)
router = APIRouter()

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_ALLOWED_DOC_TYPES = {"cv", "cvs", "jd", "jds"}


def _local_file(storage_service, doc_type: str, doc_id: str) -> Optional[str]:
    """The file in the local storage folder for this exact id, or None (also when the folder does not exist, as with S3)."""
    base_dir = storage_service.base_dir
    # 'cv'/'cvs' and 'jd'/'jds' are the same folder
    target_dir = os.path.join(base_dir, f"{doc_type}s" if not doc_type.endswith("s") else doc_type)
    if not os.path.isdir(target_dir):
        target_dir = os.path.join(base_dir, doc_type)
        if not os.path.isdir(target_dir):
            return None
    # the extension is not always stored, so match the name without it; the id must be exact: a prefix match let a short id ("a") open someone else's file
    found = [f for f in os.listdir(target_dir) if os.path.splitext(f)[0] == doc_id]
    return os.path.join(target_dir, found[0]) if found else None


@router.get("/files/{doc_type}/{doc_id}")
async def get_file(doc_type: str, doc_id: str, _: User = Depends(require_core_app)):
    """
    Serve the original CV / JD file, for the preview and download.
    With local storage the file is read from the storage folder. With S3 (production) it is fetched from the bucket, and if the
    file is not stored at all the extracted text is served instead, so a preview never ends in "not found" for a document that exists.
    """
    # Validate path components before any filesystem access (path traversal guard).
    if doc_type not in _ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Invalid document type")
    if not _SAFE_ID_RE.match(doc_id or ""):
        raise HTTPException(status_code=400, detail="Invalid document id")
    try:
        storage_service = get_storage_service()
        is_cv = doc_type.startswith("cv")
        doc = None
        try:
            store = get_store()
            doc = await asyncio.to_thread(store.candidate_document if is_cv else store.jd_document, doc_id)
        except Exception:  # noqa: BLE001
            logger.warning("Could not read the %s record for %s", doc_type, doc_id, exc_info=True)

        local = await asyncio.to_thread(_local_file, storage_service, doc_type, doc_id)
        if local:
            return FileResponse(path=local, filename=(doc or {}).get("filename") or os.path.basename(local),
                                media_type=storage_service._get_content_type(os.path.splitext(local)[1]))
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        filename = doc.get("filename") or f"{doc_id}.dat"
        file_ext = os.path.splitext(filename)[1] or (".pdf" if is_cv else ".txt")
        if (doc.get("file_path") or "").startswith("s3://"):
            with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                tmp_path = tmp.name
            try:
                await asyncio.to_thread(storage_service.download_file, doc_id, "cv" if is_cv else "jd", file_ext, tmp_path)
                return FileResponse(tmp_path, filename=filename, media_type=storage_service._get_content_type(file_ext),
                                    background=BackgroundTask(lambda: os.path.exists(tmp_path) and os.unlink(tmp_path)))
            except Exception:  # noqa: BLE001
                logger.error("Could not fetch %s %s from storage", doc_type, doc_id, exc_info=True)
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        raw = doc.get("raw_text")
        if raw and raw.strip():
            stem, ext = os.path.splitext(filename)
            text_name = filename if ext.lower() in (".txt", ".md") else f"{stem}.txt"
            return StreamingResponse(BytesIO(raw.encode("utf-8")), media_type="text/plain; charset=utf-8",
                                     headers={"Content-Disposition": f'inline; filename="{text_name}"'})
        raise HTTPException(status_code=404, detail="The original file is not stored for this document")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving file: {e}")
        raise HTTPException(status_code=500, detail="Internal error. Please try again or contact support.")
