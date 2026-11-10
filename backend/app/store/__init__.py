"""The data layer: PostgreSQL holds every fact (app/models/talent.py), Qdrant holds only the vectors (app/store/vectors.py).

    from app.store import get_store
    store = get_store()
    store.save_candidate({...}); store.candidate_rows(ids); store.get_structured_cvs_batch(ids) ...
    store.vectors            # the vector store; store.retrieve_embeddings_batch(ids) reads many candidates' vectors in one request
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

from app.store.candidates import CandidateStore
from app.store.jobs import JobStore
from app.store.stats import StatsStore
from app.store.vectors import CANDIDATE, JOB_DESCRIPTION, VectorStore, get_vector_store

logger = logging.getLogger(__name__)

_KINDS = {"cv": CANDIDATE, "candidate": CANDIDATE, "jd": JOB_DESCRIPTION, "job_description": JOB_DESCRIPTION}


class TalentStore(CandidateStore, JobStore, StatsStore):
    def __init__(self, engine: Any = None, vectors: Optional[VectorStore] = None) -> None:
        self._engine = engine
        self._vectors = vectors

    @property
    def engine(self) -> Any:
        if self._engine is None:
            from app.db.database import engine

            self._engine = engine
        return self._engine

    @property
    def vectors(self) -> VectorStore:
        if self._vectors is None:
            self._vectors = get_vector_store()
        return self._vectors

    # ------------------------------------------------------------------ vectors (stored by id, in Qdrant)
    def store_embeddings(self, doc_type: str, doc_id: str, embeddings: Dict[str, Any]) -> bool:
        """Save a document's 31 vectors and note on its row which model produced them."""
        kind = _KINDS[doc_type]
        if not self.vectors.put(kind, doc_id, embeddings):
            return False
        from app.config.settings import settings

        self.mark_embedded(doc_id, settings.EMBEDDING_MODEL_NAME, kind)
        return True

    def retrieve_embeddings(self, doc_id: str, doc_type: str = "cv") -> Optional[Dict[str, Any]]:
        return self.vectors.get(_KINDS[doc_type], doc_id)

    def retrieve_embeddings_batch(self, doc_ids: List[str], doc_type: str = "cv") -> Dict[str, Dict[str, Any]]:
        """{id: vectors} for many documents in one request (raises on a transport error so the caller can retry)."""
        return self.vectors.get_many(_KINDS[doc_type], doc_ids)

    def embeddings_info(self, doc_id: str, doc_type: str = "cv") -> Dict[str, Any]:
        return self.vectors.info(_KINDS[doc_type], doc_id)

    def health_check(self) -> Dict[str, Any]:
        return self.vectors.health_check()


_store: Optional[TalentStore] = None
_lock = threading.Lock()


def get_store() -> TalentStore:
    global _store
    if _store is None:
        with _lock:
            if _store is None:
                _store = TalentStore()
    return _store


__all__ = ["TalentStore", "get_store", "get_vector_store", "VectorStore"]
