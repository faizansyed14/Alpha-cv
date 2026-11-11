"""Storage backend interface.

CV/JD original files are stored through one of these backends, selected by
the STORAGE_BACKEND env var ("local" or "s3"). Relational data (auth,
candidates, jobs) lives in Postgres and is switched to AWS RDS by
changing DATABASE_URL only, it does not go through here.
"""
from abc import ABC, abstractmethod


class StorageBackend(ABC):
    """File storage contract used by CV/JD upload, download and delete."""

    @abstractmethod
    def upload_file(self, local_file_path: str, doc_id: str, doc_type: str, file_ext: str) -> str:
        """Persist a local temp file; returns the stored path/URI."""

    @abstractmethod
    def download_file(self, doc_id: str, doc_type: str, file_ext: str, local_path: str) -> str:
        """Copy a stored file to local_path; returns local_path."""

    @abstractmethod
    def delete_file(self, doc_id: str, doc_type: str, file_ext: str) -> bool:
        """Delete a stored file (idempotent)."""

    @abstractmethod
    def health_check(self) -> dict:
        """Backend health information."""

    def get_download_url(self, doc_id: str, doc_type: str, file_ext: str, expires_in: int = 3600) -> str:
        """URL a client can use to fetch the file (default: internal API route)."""
        return f"/api/storage/files/{doc_type}/{doc_id}{file_ext}"

    @staticmethod
    def content_type_for(file_ext: str) -> str:
        return {
            '.pdf': 'application/pdf',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.doc': 'application/msword',
            '.txt': 'text/plain',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
        }.get(file_ext.lower(), 'application/octet-stream')

    # Backwards-compatible alias (older call sites used a private name).
    def _get_content_type(self, file_ext: str) -> str:
        return self.content_type_for(file_ext)

    @staticmethod
    def _key(doc_id: str, doc_type: str, file_ext: str) -> str:
        """Canonical object key: <type>s/<id><ext> (same layout local and S3)."""
        return f"{doc_type}s/{doc_id}{file_ext}"
