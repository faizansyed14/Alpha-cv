"""RemoteEmbedder: SentenceTransformer-compatible shape, request splitting, retries (no real server needed)."""

import httpx
import numpy as np
import pytest

from app.providers.embeddings.remote import RemoteEmbedder


def _embedder(handler, **kwargs) -> RemoteEmbedder:
    emb = RemoteEmbedder("http://model-server:8080", dim=4, **kwargs)
    emb._client = httpx.Client(base_url="http://model-server:8080", transport=httpx.MockTransport(handler))
    return emb


def _ok(request: httpx.Request) -> httpx.Response:
    texts = request.read().decode()
    n = texts.count('"') // 2 - 1  # the "texts" key plus its values
    return httpx.Response(200, json={"model": "m", "dim": 4, "embeddings": [[1.0, 2.0, 3.0, 4.0]] * n})


def test_single_string_returns_1d_vector_and_list_returns_2d():
    emb = _embedder(_ok)
    assert emb.encode("hello").shape == (4,)
    assert emb.encode(["a", "b", "c"]).shape == (3, 4)
    assert emb.encode([]).shape == (0, 4)


def test_large_inputs_are_split_into_server_sized_requests():
    calls = []

    def handler(request):
        calls.append(request)
        return _ok(request)

    emb = _embedder(handler, request_size=2)
    out = emb.encode(["a", "b", "c", "d", "e"])
    assert out.shape == (5, 4) and len(calls) == 3
    assert out.dtype == np.float32


def test_transient_server_errors_are_retried(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda _s: None)
    attempts = {"n": 0}

    def handler(request):
        attempts["n"] += 1
        return httpx.Response(503) if attempts["n"] < 3 else _ok(request)

    assert _embedder(handler, retries=3).encode(["a"]).shape == (1, 4)
    assert attempts["n"] == 3


def test_client_errors_are_not_retried():
    attempts = {"n": 0}

    def handler(request):
        attempts["n"] += 1
        return httpx.Response(401)

    with pytest.raises(RuntimeError):
        _embedder(handler, retries=3).encode(["a"])
    assert attempts["n"] == 1
