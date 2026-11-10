#!/usr/bin/env python3
"""Create/repair the two Qdrant collections used by AlphaCV.

Qdrant holds only vectors (one point per CV or JD, named vectors, no payload); every fact lives in Postgres. The backend creates
the collections at startup; this is a standalone repair tool (e.g. after a manual Qdrant wipe). Run it inside the backend container:

    python scripts/db/init_qdrant.py        # with the backend's environment (QDRANT_HOST ...) set

Env: QDRANT_HOST, QDRANT_PORT, QDRANT_GRPC_PORT, EMBEDDING_DIM (the backend's settings).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

from app.store.vectors import KINDS, collection_name, get_vector_store  # noqa: E402


def main() -> None:
    store = get_vector_store()
    store.ensure_collections()
    for kind in KINDS:
        print(f"ready: {collection_name(kind)} ({store.count(kind)} points)")


if __name__ == "__main__":
    main()
