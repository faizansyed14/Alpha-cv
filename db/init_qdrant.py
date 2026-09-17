#!/usr/bin/env python3
"""Create/repair the Qdrant collections used by AlphaCV.

The backend auto-creates these collections at startup; this script is a
standalone convenience/repair tool (e.g. after a manual Qdrant wipe).

Env: QDRANT_HOST (default localhost), QDRANT_PORT (default 6333),
     EMBEDDING_DIM (default 768).
"""

import os

from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams

HOST = os.getenv("QDRANT_HOST", "localhost")
PORT = int(os.getenv("QDRANT_PORT", "6333"))
DIM = int(os.getenv("EMBEDDING_DIM", "768"))

# Mirrors QdrantUtils._ensure_collections_exist in the backend.
COLLECTIONS = [
    "cv_documents",
    "jd_documents",
    "cv_structured",
    "jd_structured",
    "cv_embeddings",
    "jd_embeddings",
    "job_postings_structured",
]


def main() -> None:
    client = QdrantClient(host=HOST, port=PORT, timeout=30)
    for name in COLLECTIONS:
        if client.collection_exists(name):
            print(f"exists:  {name}")
        else:
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=DIM, distance=Distance.COSINE),
            )
            print(f"created: {name}")
    print("Qdrant collections ready")


if __name__ == "__main__":
    main()
