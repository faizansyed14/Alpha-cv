"""The 31 vectors of a CV or JD survive the vector store exactly (up to the unit-length scaling a cosine collection applies)."""
import uuid

import numpy as np

from app.config.settings import settings
from app.store import get_store

DIM = settings.EMBEDDING_DIM


def embeddings(seed=42):
    rng = np.random.default_rng(seed)
    return {
        "skill_vectors": rng.random((20, DIM)).tolist(),
        "responsibility_vectors": rng.random((10, DIM)).tolist(),
        "job_title_vector": rng.random((1, DIM)).tolist(),
    }


def unit(rows):
    a = np.array(rows, dtype=np.float64)
    return a / np.linalg.norm(a, axis=1, keepdims=True)


def test_storage_and_retrieval_keep_the_vector_structure_and_values():
    store, doc_id, emb = get_store(), str(uuid.uuid4()), embeddings()
    assert store.store_embeddings("cv", doc_id, emb)
    got = store.retrieve_embeddings(doc_id, "cv")
    assert got is not None
    for key, count in (("skill_vectors", 20), ("responsibility_vectors", 10), ("job_title_vector", 1)):
        assert len(got[key]) == count, key
        assert np.allclose(unit(emb[key]), np.array(got[key]), atol=1e-5), key      # same direction, which is all cosine matching reads


def test_cvs_and_jds_are_kept_apart_and_deleting_removes_the_vectors():
    store, doc_id = get_store(), str(uuid.uuid4())
    store.store_embeddings("jd", doc_id, embeddings())
    assert store.retrieve_embeddings(doc_id, "jd") and store.retrieve_embeddings(doc_id, "cv") is None
    store.vectors.delete("job_description", [doc_id])
    assert store.retrieve_embeddings(doc_id, "jd") is None


def test_many_cvs_are_read_in_one_request():
    store = get_store()
    ids = [str(uuid.uuid4()) for _ in range(7)]
    for i, cid in enumerate(ids):
        store.store_embeddings("cv", cid, embeddings(i))
    got = store.retrieve_embeddings_batch(ids, "cv")
    assert set(got) == set(ids) and all(len(v["skill_vectors"]) == 20 for v in got.values())
