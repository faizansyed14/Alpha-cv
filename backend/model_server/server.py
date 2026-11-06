"""Embedding model server: multilingual-e5-small on ONNX Runtime (no torch, no sentence-transformers).

The API and the workers call it over HTTP (see app/providers/embeddings/remote.py), so the backend image carries no ML
runtime and N backend processes share ONE copy of the model instead of loading N copies.

The model is used the way the e5 models are meant to be: tokenize (max 512 tokens), run the encoder, mean-pool the token
vectors over the attention mask, L2-normalise. The "query: " task prefix is added by the caller (EmbeddingService), not here.

Concurrency: inference is CPU-bound, so requests run one at a time in a worker thread (ONNX Runtime uses MODEL_THREADS
cores per batch). The asyncio semaphore is FIFO, so concurrent callers (e.g. three recruiters matching at once) are queued
fairly while the event loop stays free to answer /health.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from tokenizers import Tokenizer

MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-small")
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/opt/model"))  # model.onnx + tokenizer.json, baked into the image
MAX_TOKENS = max(8, int(os.getenv("MODEL_MAX_TOKENS", "512")))
THREADS = max(1, int(os.getenv("MODEL_THREADS", "2")))
MAX_TEXTS = max(1, int(os.getenv("MODEL_MAX_INPUTS", "256")))
BATCH_SIZE = max(1, int(os.getenv("MODEL_BATCH_SIZE", "32")))
TOKEN = os.getenv("MODEL_SERVER_TOKEN", "")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("model-server")


class Embedder:
    """The ONNX encoder plus its tokenizer; ``encode`` returns one L2-normalised float32 vector per text."""

    def __init__(self, model_dir: Path, threads: int, max_tokens: int, batch_size: int) -> None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(model_dir / "model.onnx"), sess_options=options,
                                            providers=["CPUExecutionProvider"])
        # Text lengths change with every request; ONNX Runtime's CPU arena keeps the largest block it ever needed and never
        # returns it, so hand the memory back after each run (same speed, much lower resident memory).
        self.run_options = ort.RunOptions()
        self.run_options.add_run_config_entry("memory.enable_memory_arena_shrinkage", "cpu:0")
        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=max_tokens)
        pad_id = self.tokenizer.token_to_id("<pad>")
        self.tokenizer.enable_padding(pad_id=1 if pad_id is None else pad_id, pad_token="<pad>")
        self.input_names = {i.name for i in self.session.get_inputs()}
        self.batch_size = batch_size
        self.dim = int(self.encode([" "]).shape[1])

    def encode(self, texts: list[str]) -> np.ndarray:
        inputs = [t if t and t.strip() else " " for t in texts]
        # Sort by length so each batch pads to similar lengths, then restore the caller's order.
        order = sorted(range(len(inputs)), key=lambda i: len(inputs[i]))
        rows: dict[int, np.ndarray] = {}
        for start in range(0, len(order), self.batch_size):
            idx = order[start:start + self.batch_size]
            enc = self.tokenizer.encode_batch([inputs[i] for i in idx])
            feed = {
                "input_ids": np.array([e.ids for e in enc], dtype=np.int64),
                "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64),
            }
            if "token_type_ids" in self.input_names:
                feed["token_type_ids"] = np.array([e.type_ids for e in enc], dtype=np.int64)
            feed = {k: v for k, v in feed.items() if k in self.input_names}
            hidden = self.session.run(None, feed, self.run_options)[0]               # (batch, tokens, dim)
            mask = feed["attention_mask"][..., None].astype(np.float32)
            pooled = (hidden * mask).sum(axis=1) / np.clip(mask.sum(axis=1), 1e-9, None)
            pooled = pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)
            for row, i in enumerate(idx):
                rows[i] = pooled[row].astype(np.float32)
        return np.stack([rows[i] for i in range(len(inputs))])


_embedder: Embedder | None = None
_gate = asyncio.Semaphore(1)
_stats = {"requests": 0, "texts": 0, "busy_s": 0.0}


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _embedder
    log.info("loading %s from %s (threads=%d)", MODEL_NAME, MODEL_DIR, THREADS)
    _embedder = await asyncio.to_thread(Embedder, MODEL_DIR, THREADS, MAX_TOKENS, BATCH_SIZE)
    log.info("model ready, dim=%d", _embedder.dim)
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


@app.post("/embed", response_model=EmbedResponse)
async def embed(body: EmbedRequest, authorization: str | None = Header(default=None)) -> EmbedResponse:
    _check_token(authorization)
    if _embedder is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    if len(body.texts) > MAX_TEXTS:
        raise HTTPException(status_code=413, detail=f"at most {MAX_TEXTS} texts per request")
    async with _gate:
        start = time.perf_counter()
        vectors = await asyncio.to_thread(_embedder.encode, body.texts)
        _stats["busy_s"] += time.perf_counter() - start
    _stats["requests"] += 1
    _stats["texts"] += len(body.texts)
    return EmbedResponse(model=MODEL_NAME, dim=int(vectors.shape[1]), embeddings=vectors.tolist())


@app.get("/health")
async def health() -> dict:
    if _embedder is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    return {"status": "ok", "model": MODEL_NAME, "dim": _embedder.dim, **_stats}
