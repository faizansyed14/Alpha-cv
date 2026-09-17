"""AWS S3 storage backend.

Enable with STORAGE_BACKEND=s3 plus S3_BUCKET (and optionally S3_REGION /
S3_PREFIX). Credentials come from the standard AWS chain (env vars, shared
credentials file, or an EC2/ECS instance role — the recommended option on a
single EC2 deployment). Object keys mirror the local layout:
<prefix><type>s/<doc_id><ext>, so migrating is a one-time `aws s3 sync` of
LOCAL_STORAGE_DIR plus flipping STORAGE_BACKEND in .env.
"""
import logging
import os
import tempfile

from app.core.config import settings
from app.services.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class S3StorageBackend(StorageBackend):
    """Stores CV/JD files in an S3 bucket."""

    def __init__(self):
        if not settings.S3_BUCKET:
            raise RuntimeError("STORAGE_BACKEND=s3 requires S3_BUCKET to be set")
        try:
            import boto3
            from botocore.config import Config
        except ImportError as e:
            raise RuntimeError("STORAGE_BACKEND=s3 requires the boto3 package") from e

        self.bucket = settings.S3_BUCKET
        self.prefix = settings.S3_PREFIX.strip("/")
        client_kwargs = {"config": Config(retries={"max_attempts": 3, "mode": "standard"})}
        if settings.S3_REGION:
            client_kwargs["region_name"] = settings.S3_REGION
        self.s3_client = boto3.client("s3", **client_kwargs)
        logger.info(f"✅ S3StorageBackend initialized: bucket={self.bucket} prefix={self.prefix or '-'}")

    def _object_key(self, doc_id: str, doc_type: str, file_ext: str) -> str:
        key = self._key(doc_id, doc_type, file_ext)
        return f"{self.prefix}/{key}" if self.prefix else key

    def upload_file(self, local_file_path: str, doc_id: str, doc_type: str, file_ext: str) -> str:
        key = self._object_key(doc_id, doc_type, file_ext)
        try:
            self.s3_client.upload_file(
                local_file_path, self.bucket, key,
                ExtraArgs={"ContentType": self.content_type_for(file_ext)},
            )
            uri = f"s3://{self.bucket}/{key}"
            logger.info(f"✅ Stored file in S3: {uri}")
            return uri
        except Exception as e:
            logger.error(f"❌ S3 upload failed: {e}")
            raise Exception(f"Failed to upload file to S3: {str(e)}")

    def download_file(self, doc_id: str, doc_type: str, file_ext: str, local_path: str) -> str:
        try:
            self.s3_client.download_file(self.bucket, self._object_key(doc_id, doc_type, file_ext), local_path)
            return local_path
        except Exception as e:
            logger.error(f"❌ Failed to retrieve file from S3: {e}")
            raise Exception(f"Failed to retrieve file: {str(e)}")

    def delete_file(self, doc_id: str, doc_type: str, file_ext: str) -> bool:
        try:
            self.s3_client.delete_object(Bucket=self.bucket, Key=self._object_key(doc_id, doc_type, file_ext))
            return True
        except Exception as e:
            logger.error(f"❌ Failed to delete S3 object: {e}")
            raise Exception(f"Failed to delete file: {str(e)}")

    def file_exists(self, doc_id: str, doc_type: str, file_ext: str) -> bool:
        try:
            self.s3_client.head_object(Bucket=self.bucket, Key=self._object_key(doc_id, doc_type, file_ext))
            return True
        except Exception:
            return False

    def get_file_metadata(self, doc_id: str, doc_type: str, file_ext: str) -> dict:
        try:
            head = self.s3_client.head_object(Bucket=self.bucket, Key=self._object_key(doc_id, doc_type, file_ext))
            return {
                'size': head.get('ContentLength', 0),
                'last_modified': head.get('LastModified'),
                'content_type': head.get('ContentType', self.content_type_for(file_ext)),
                'metadata': {
                    'doc_id': doc_id,
                    'doc_type': doc_type,
                    'original_extension': file_ext,
                },
            }
        except Exception as e:
            logger.error(f"❌ Failed to get S3 metadata: {e}")
            raise Exception(f"Failed to get file metadata: {str(e)}")

    def get_download_url(self, doc_id: str, doc_type: str, file_ext: str, expires_in: int = 3600) -> str:
        """Presigned URL for direct download (falls back to the API route)."""
        try:
            return self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": self._object_key(doc_id, doc_type, file_ext)},
                ExpiresIn=expires_in,
            )
        except Exception:
            return super().get_download_url(doc_id, doc_type, file_ext, expires_in)

    def health_check(self) -> dict:
        try:
            self.s3_client.head_bucket(Bucket=self.bucket)
            return {'service': 's3_storage', 'status': 'healthy', 'bucket': self.bucket}
        except Exception as e:
            return {'service': 's3_storage', 'status': 'unhealthy', 'error': str(e), 'bucket': self.bucket}

    # Local-path helpers used by a couple of legacy call sites; for S3 we
    # materialize to a temp file when a real path is needed.
    @property
    def base_dir(self) -> str:
        return tempfile.gettempdir()
