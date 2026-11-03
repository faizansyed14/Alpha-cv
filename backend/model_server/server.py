"""Embedding model server: the only process that loads torch + the sentence-transformer.

The API and the workers call it over HTTP (see app/services/ai/remote_embedder.py), so the backend image carries no
ML runtime and N backend processes share ONE copy of the model instead of loading N copies.

Concurrency: inference is CPU-bound, so requests run one at a time in a worker thread (torch already uses
MODEL_THREADS cores per batch). The asyncio semaphore is FIFO, so concurrent callers (e.g. three recruiters matching
at once) are queued fairly while the event loop stays free to answer /health.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-mpnet-base-v2")
THREADS = max(1, int(os.getenv("MODEL_THREADS", "2")))
MAX_TEXTS = max(1, int(os.getenv("MODEL_MAX_INPUTS", "256")))
BATCH_SIZE = max(1, int(os.getenv("MODEL_BATCH_SIZE", "64")))
TOKEN = os.getenv("MODEL_SERVER_TOKEN", "")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("model-server")

_model: SentenceTransformer | None = None
_gate = asyncio.Semaphore(1)
_stats = {"requests": 0, "texts": 0, "busy_s": 0.0}


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _model
    torch.set_num_threads(THREADS)
    log.info("loading %s (threads=%d)", MODEL_NAME, THREADS)
    _model = SentenceTransformer(MODEL_NAME, device="cpu")
    log.info("model ready, dim=%d", _model.get_sentence_embedding_dimension())
    yield


app = FastAPI(title="embedding-model-server", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)


class EmbedResponse(BaseModel):
    model: str
    dim: int
    embeddings: list[list[float]]


def _check_token(authorization: str | None) -> None:
    if TOKEN and not hmac.compare_digest(authorization or "", f"Bearer {TOKEN}"):
        raise HTTPException(status_code=401, detail="invalid token")


def _encode(texts: list[str]) -> list[list[float]]:
    assert _model is not None
    out = _model.encode(texts, batch_size=BATCH_SIZE, convert_to_numpy=True, show_progress_bar=False)
    return out.astype("float32").tolist()


@app.post("/embed", response_model=EmbedResponse)
async def embed(body: EmbedRequest, authorization: str | None = Header(default=None)) -> EmbedResponse:
    _check_token(authorization)
    if _model is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    if len(body.texts) > MAX_TEXTS:
        raise HTTPException(status_code=413, detail=f"at most {MAX_TEXTS} texts per request")
    async with _gate:
        start = time.perf_counter()
        vectors = await asyncio.to_thread(_encode, body.texts)
        _stats["busy_s"] += time.perf_counter() - start
    _stats["requests"] += 1
    _stats["texts"] += len(body.texts)
    return EmbedResponse(model=MODEL_NAME, dim=len(vectors[0]), embeddings=vectors)


@app.get("/health")
async def health() -> dict:
    if _model is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    return {"status": "ok", "model": MODEL_NAME, "dim": _model.get_sentence_embedding_dimension(), **_stats}
