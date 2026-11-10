"""The vectors, and nothing else: Qdrant holds one point per candidate and one per job description, under the same id as the
row in PostgreSQL. Every fact about the person or the job lives in PostgreSQL (app/store/talent.py).

A point carries the 31 vectors a document is matched by, as native Qdrant vectors:

    skills            20 x EMBEDDING_DIM   (a multivector: position n = skill n of the document)
    responsibilities  10 x EMBEDDING_DIM
    title              1 x EMBEDDING_DIM

Matching reads them back in batches by id; nothing here runs a nearest-neighbour search, so the HNSW graph is switched off and
the vectors stay on disk. Over gRPC the vectors travel as binary, which is about 2.5x faster to read than the JSON number lists
the payload used to hold (and halves the CPU the client spends on them).
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, Iterable, List, Optional

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from app.config.settings import settings

logger = logging.getLogger(__name__)

CANDIDATE = "candidate"
JOB_DESCRIPTION = "job_description"
KINDS = (CANDIDATE, JOB_DESCRIPTION)

SKILL_SLOTS = 20
RESPONSIBILITY_SLOTS = 10


def collection_name(kind: str) -> str:
    if kind not in KINDS:
        raise ValueError(f"unknown vector kind: {kind}")
    return f"{kind}_vectors"


class VectorStore:
    def __init__(self, client: Optional[QdrantClient] = None, host: Optional[str] = None, port: Optional[int] = None) -> None:
        self._client = client
        self._lock = threading.Lock()
        self._ready = False
        self.host = host or settings.QDRANT_HOST
        self.port = port or settings.QDRANT_PORT

    # ------------------------------------------------------------------ connection
    @property
    def client(self) -> QdrantClient:
        if self._client is None:
            with self._lock:
                if self._client is None:
                    kwargs: Dict[str, Any] = dict(host=self.host, port=self.port, timeout=settings.QDRANT_TIMEOUT_SECONDS)
                    if settings.QDRANT_PREFER_GRPC:
                        kwargs.update(prefer_grpc=True, grpc_port=settings.QDRANT_GRPC_PORT)
                    if settings.QDRANT_API_KEY:
                        kwargs["api_key"] = settings.QDRANT_API_KEY
                    self._client = QdrantClient(**kwargs)
        self.ensure_collections()
        return self._client

    def ensure_collections(self) -> None:
        """Create the two collections if they are missing (idempotent, cheap after the first call)."""
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            client = self._client
            dim = settings.EMBEDDING_DIM
            multi = lambda: qm.VectorParams(size=dim, distance=qm.Distance.COSINE, on_disk=True,
                                            multivector_config=qm.MultiVectorConfig(comparator=qm.MultiVectorComparator.MAX_SIM))
            single = lambda: qm.VectorParams(size=dim, distance=qm.Distance.COSINE, on_disk=True)
            for kind in KINDS:
                name = collection_name(kind)
                if client.collection_exists(name):
                    continue
                try:
                    client.create_collection(
                        collection_name=name,
                        vectors_config={"skills": multi(), "responsibilities": multi(), "title": single()},
                        hnsw_config=qm.HnswConfigDiff(m=0),            # only ever read by id: no graph to build or keep in RAM
                    )
                    logger.info(f"Created vector collection {name} ({dim}-d)")
                except Exception:  # noqa: BLE001
                    # the backend and every worker start together: another one may have created it a moment ago
                    if not client.collection_exists(name):
                        raise
            self._ready = True

    def health_check(self) -> Dict[str, Any]:
        try:
            names = [c.name for c in self.client.get_collections().collections]
            return {"status": "healthy", "collections": names, "host": self.host, "port": self.port}
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Qdrant health check failed: {exc}")
            return {"status": "unhealthy", "error": str(exc), "host": self.host, "port": self.port}

    # ------------------------------------------------------------------ writing
    @staticmethod
    def _point(doc_id: str, emb: Dict[str, Any]) -> qm.PointStruct:
        skills = [list(map(float, v)) for v in (emb.get("skill_vectors") or [])][:SKILL_SLOTS]
        resps = [list(map(float, v)) for v in (emb.get("responsibility_vectors") or [])][:RESPONSIBILITY_SLOTS]
        title = (emb.get("job_title_vector") or [[]])[0]
        if not (skills and resps and len(title)):
            raise ValueError("the embeddings are incomplete: need skills, responsibilities and a title vector")
        return qm.PointStruct(id=str(doc_id), payload={}, vector={
            "skills": skills, "responsibilities": resps, "title": list(map(float, title))})

    def put(self, kind: str, doc_id: str, emb: Dict[str, Any]) -> bool:
        try:
            self.client.upsert(collection_name=collection_name(kind), points=[self._point(doc_id, emb)], wait=True)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error(f"put vectors {kind} {doc_id} failed: {exc}")
            return False

    def delete(self, kind: str, ids: Iterable[str]) -> None:
        ids = [str(i) for i in ids]
        if ids:
            self.client.delete(collection_name=collection_name(kind), points_selector=qm.PointIdsList(points=ids), wait=True)

    # ------------------------------------------------------------------ reading
    @staticmethod
    def _as_embeddings(vector: Dict[str, Any]) -> Dict[str, Any]:
        """Qdrant's named vectors back into the shape the matching code reads."""
        return {
            "skill_vectors": list(vector.get("skills") or []),
            "responsibility_vectors": list(vector.get("responsibilities") or []),
            "job_title_vector": [vector["title"]] if vector.get("title") is not None else [],
        }

    def get_many(self, kind: str, ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """{id: embeddings} for the ids that have vectors, in ONE request. Raises on a transport error so the caller can retry
        instead of mistaking a timeout for a missing document."""
        if not ids:
            return {}
        points = self.client.retrieve(collection_name=collection_name(kind), ids=[str(i) for i in ids], with_payload=False,
                                      with_vectors=True)
        return {str(p.id): self._as_embeddings(p.vector) for p in points or [] if isinstance(p.vector, dict)}

    def get(self, kind: str, doc_id: str) -> Optional[Dict[str, Any]]:
        try:
            return self.get_many(kind, [doc_id]).get(str(doc_id))
        except Exception as exc:  # noqa: BLE001
            logger.error(f"get vectors {kind} {doc_id} failed: {exc}")
            return None

    def info(self, kind: str, doc_id: str) -> Dict[str, Any]:
        """What is stored for a document, for the CV / JD detail pages."""
        emb = self.get(kind, doc_id)
        if not emb:
            return {"embeddings_found": False, "skills": 0, "responsibilities": 0, "has_title": False, "dimension": 0}
        return {"embeddings_found": True, "skills": len(emb["skill_vectors"]), "responsibilities": len(emb["responsibility_vectors"]),
                "has_title": bool(emb["job_title_vector"]),
                "dimension": len(emb["skill_vectors"][0]) if emb["skill_vectors"] else 0}

    def count(self, kind: str) -> int:
        return int(self.client.count(collection_name=collection_name(kind), exact=True).count)


_store: Optional[VectorStore] = None
_store_lock = threading.Lock()


def get_vector_store() -> VectorStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = VectorStore()
    return _store
