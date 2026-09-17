"""Local filesystem storage backend (default).

Files live under LOCAL_STORAGE_DIR (a docker volume in the compose stacks),
laid out as <type>s/<doc_id><ext> — the same key layout the S3 backend uses,
so switching backends later does not change any identifiers.
"""
import logging
import os
import shutil
from datetime import datetime

from app.core.config import settings
from app.services.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class LocalStorageBackend(StorageBackend):
    """Stores CV/JD files on the local filesystem."""

    def __init__(self):
        self.base_dir = settings.LOCAL_STORAGE_DIR or os.path.join(os.getcwd(), 'uploads')
        os.makedirs(os.path.join(self.base_dir, 'cvs'), exist_ok=True)
        os.makedirs(os.path.join(self.base_dir, 'jds'), exist_ok=True)
        logger.info(f"✅ LocalStorageBackend initialized at: {self.base_dir}")

    def _path(self, doc_id: str, doc_type: str, file_ext: str) -> str:
        return os.path.join(self.base_dir, self._key(doc_id, doc_type, file_ext))

    def upload_file(self, local_file_path: str, doc_id: str, doc_type: str, file_ext: str) -> str:
        try:
            dest_path = self._path(doc_id, doc_type, file_ext)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            shutil.copy2(local_file_path, dest_path)
            logger.info(f"✅ Stored file locally: {dest_path}")
            return dest_path
        except Exception as e:
            logger.error(f"❌ Local storage upload failed: {e}")
            raise Exception(f"Failed to copy file to local storage: {str(e)}")

    def download_file(self, doc_id: str, doc_type: str, file_ext: str, local_path: str) -> str:
        try:
            source_path = self._path(doc_id, doc_type, file_ext)
            if not os.path.exists(source_path):
                raise FileNotFoundError(f"File not found: {source_path}")
            shutil.copy2(source_path, local_path)
            return local_path
        except Exception as e:
            logger.error(f"❌ Failed to retrieve file: {e}")
            raise Exception(f"Failed to retrieve file: {str(e)}")

    def delete_file(self, doc_id: str, doc_type: str, file_ext: str) -> bool:
        try:
            file_path = self._path(doc_id, doc_type, file_ext)
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"✅ Deleted local file: {file_path}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to delete local file: {e}")
            raise Exception(f"Failed to delete local file: {str(e)}")

    def file_exists(self, doc_id: str, doc_type: str, file_ext: str) -> bool:
        return os.path.exists(self._path(doc_id, doc_type, file_ext))

    def get_file_metadata(self, doc_id: str, doc_type: str, file_ext: str) -> dict:
        try:
            file_path = self._path(doc_id, doc_type, file_ext)
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")
            stats = os.stat(file_path)
            return {
                'size': stats.st_size,
                'last_modified': datetime.fromtimestamp(stats.st_mtime),
                'content_type': self.content_type_for(file_ext),
                'metadata': {
                    'doc_id': doc_id,
                    'doc_type': doc_type,
                    'original_extension': file_ext,
                },
            }
        except Exception as e:
            logger.error(f"❌ Failed to get file metadata: {e}")
            raise Exception(f"Failed to get file metadata: {str(e)}")

    def health_check(self) -> dict:
        try:
            test_file = os.path.join(self.base_dir, '.health_check')
            with open(test_file, 'w') as f:
                f.write('ok')
            os.remove(test_file)
            return {'service': 'local_storage', 'status': 'healthy', 'base_dir': self.base_dir}
        except Exception as e:
            logger.error(f"❌ Storage health check failed: {e}")
            return {'service': 'local_storage', 'status': 'unhealthy', 'error': str(e), 'base_dir': self.base_dir}
