"""HTTP client for the embedding model server, shaped like the slice of SentenceTransformer the app uses.

`encode()` and `get_sentence_embedding_dimension()` are the only methods EmbeddingService calls, so this drops in
behind `_shared_model` with no other code changes. Large inputs are split into server-sized requests; transient
failures are retried with exponential backoff.
"""

from __future__ import annotations

import logging
import time
from typing import List, Optional, Union

import httpx
import numpy as np

from app.monitoring.recorder import timed

logger = logging.getLogger(__name__)


class RemoteEmbedder:
    def __init__(self, base_url: str, *, token: str = "", dim: int = 768, request_size: int = 128,
                 timeout_s: float = 120.0, retries: int = 3, model_name: str = "embedding-model"):
        self._dim = dim
        self._model_name = model_name
        self._request_size = max(1, request_size)
        self._retries = max(1, retries)
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        # One connection pool per process, shared by every thread (httpx.Client is thread-safe).
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"), headers=headers, timeout=httpx.Timeout(timeout_s, connect=5.0),
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        )

    def get_sentence_embedding_dimension(self) -> int:
        return self._dim

    def _post(self, texts: List[str]) -> np.ndarray:
        last: Optional[Exception] = None
        for attempt in range(1, self._retries + 1):
            try:
                with timed("embedder", "embed", self._model_name, texts=len(texts), attempt=attempt):
                    resp = self._client.post("/embed", json={"texts": texts})
                    resp.raise_for_status()
                    body = resp.json()
                self._dim = int(body.get("dim", self._dim))
                return np.asarray(body["embeddings"], dtype=np.float32)
            except httpx.HTTPStatusError as exc:
                last = exc
                if exc.response.status_code < 500:
                    break  # 4xx (bad token, too many texts): retrying cannot help
            except httpx.TransportError as exc:
                last = exc
            if attempt < self._retries:
                delay = 0.5 * (2 ** (attempt - 1))
                logger.warning(f"embedding request failed ({last}); retry {attempt}/{self._retries - 1} in {delay}s")
                time.sleep(delay)
        raise RuntimeError(f"embedding service request failed: {last}")

    def encode(self, sentences: Union[str, List[str]], batch_size: int = 0, **_ignored) -> np.ndarray:
        """SentenceTransformer-compatible: str -> 1-D vector, list -> 2-D array (extra kwargs are ignored)."""
        single = isinstance(sentences, str)
        texts = [sentences] if single else list(sentences)
        if not texts:
            return np.zeros((0, self._dim), dtype=np.float32)
        step = min(self._request_size, batch_size) if batch_size else self._request_size
        parts = [self._post(texts[i:i + step]) for i in range(0, len(texts), step)]
        out = np.concatenate(parts, axis=0)
        return out[0] if single else out

    def close(self) -> None:
        self._client.close()
