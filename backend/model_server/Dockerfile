# syntax=docker/dockerfile:1.7
# Embedding model server: multilingual-e5-small on ONNX Runtime (no torch). Internal only: compose does not publish its port.
# Built rarely (requirements and the model almost never change), so the backend image never pays for an ML runtime.
# Build from backend/model_server/:  docker build -t alpha-model-server .

# Stage 1: download the ONNX model and its tokenizer once, from ONE pinned revision of the original publisher's repo, and
# refuse to build unless both files match the SHA-256 recorded here (a moved tag, a hijacked repo or a corrupted download
# fails the build instead of shipping unverified weights). To move to a new model version: change REVISION and both hashes.
# huggingface-hub is only needed here and is not copied to the runtime image.
FROM python:3.12-slim AS model
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
RUN --mount=type=cache,target=/root/.cache/pip pip install huggingface-hub==0.26.2
WORKDIR /opt/model
RUN python - <<'PY'
import hashlib, shutil
from huggingface_hub import hf_hub_download

REPO = "intfloat/multilingual-e5-small"
REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
FILES = {
    "onnx/model.onnx": ("model.onnx", "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665"),
    "tokenizer.json": ("tokenizer.json", "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"),
}
for remote, (local, want) in FILES.items():
    path = hf_hub_download(REPO, remote, revision=REVISION)
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    if digest.hexdigest() != want:
        raise SystemExit(f"{remote}: SHA-256 {digest.hexdigest()} does not match the pinned {want}")
    shutil.copyfile(path, f"/opt/model/{local}")
print("model verified:", REPO, REVISION)
PY

# Stage 2: the Python environment (versions match backend/requirements.txt where they overlap).
FROM python:3.12-slim AS build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install fastapi==0.135.1 uvicorn==0.32.0 pydantic==2.8.2 numpy==1.26.4 onnxruntime==1.20.1 tokenizers==0.22.2

FROM python:3.12-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app app
COPY --from=build /opt/venv /opt/venv
COPY --from=model /opt/model /opt/model
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    MODEL_DIR=/opt/model \
    EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small
WORKDIR /app
COPY server.py .
USER app
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4).status == 200 else 1)"]
# One process on purpose: a single copy of the model in RAM; requests are serialised by the FIFO gate in server.py.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
