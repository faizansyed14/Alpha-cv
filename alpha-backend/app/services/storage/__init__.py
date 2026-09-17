"""File storage backends (local filesystem / AWS S3), selected via env.

STORAGE_BACKEND=local (default) -> LocalStorageBackend (LOCAL_STORAGE_DIR)
STORAGE_BACKEND=s3              -> S3StorageBackend (S3_BUCKET/S3_REGION/S3_PREFIX)
"""
import logging
import threading
from typing import Optional

from app.core.config import settings
from app.services.storage.base import StorageBackend
from app.services.storage.local_storage import LocalStorageBackend

logger = logging.getLogger(__name__)

_storage_service: Optional[StorageBackend] = None
_lock = threading.Lock()


def get_storage_service() -> StorageBackend:
    """Global storage backend instance, chosen by settings.STORAGE_BACKEND."""
    global _storage_service
    if _storage_service is None:
        with _lock:
            if _storage_service is None:
                backend = settings.STORAGE_BACKEND.strip().lower()
                if backend == "s3":
                    from app.services.storage.s3_storage import S3StorageBackend
                    _storage_service = S3StorageBackend()
                else:
                    if backend not in ("", "local"):
                        logger.warning(f"Unknown STORAGE_BACKEND '{backend}', using local")
                    _storage_service = LocalStorageBackend()
    return _storage_service
