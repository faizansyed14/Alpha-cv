#!/usr/bin/env python3
"""Rebuild every vector in Qdrant from the rows in Postgres (no LLM call, only the embedding model).

Use it after the embedding model or the vector layout changes, or after a Qdrant wipe. The two collections are dropped and recreated
empty, then each candidate and each job description is embedded again from its stored skills, responsibilities and title.

    python scripts/db/reembed.py             # run where the backend's environment (DATABASE_URL, QDRANT_HOST, EMBEDDING_SERVICE_URL) is set
    python scripts/db/reembed.py --keep      # do not drop the collections first (just overwrite every point)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))
sys.path.insert(0, "/app")

from app.providers.embeddings.service import get_embedding_service  # noqa: E402
from app.store import get_store  # noqa: E402
from app.store.vectors import KINDS, collection_name  # noqa: E402


def main() -> None:
    store = get_store()
    client = store.vectors.client
    if "--keep" not in sys.argv:
        for kind in KINDS:
            if client.collection_exists(collection_name(kind)):
                client.delete_collection(collection_name(kind))
        store.vectors._ready = False
        store.vectors.ensure_collections()
        print("collections recreated empty")

    embedder = get_embedding_service()
    done = failed = 0
    for doc_type, ids, read in (("cv", store.list_candidate_ids(0, 1_000_000), store.get_structured_cv),
                                ("jd", store.list_job_description_ids(), store.get_structured_jd)):
        for doc_id in ids:
            structured = read(doc_id)
            try:
                if not structured or not store.store_embeddings(doc_type, doc_id, embedder.generate_document_embeddings(structured)):
                    raise RuntimeError("could not store the vectors")
                done += 1
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"failed {doc_type} {doc_id}: {exc}")
    print(f"re-embedded {done} documents, {failed} failed")
    for kind in KINDS:
        print(f"{collection_name(kind)}: {store.vectors.count(kind)} points")


if __name__ == "__main__":
    main()
