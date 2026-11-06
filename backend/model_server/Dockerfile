# syntax=docker/dockerfile:1.7
# Embedding model server: multilingual-e5-small on ONNX Runtime (no torch). Internal only: compose does not publish its port.
# Built rarely (requirements and the model almost never change), so the backend image never pays for an ML runtime.
# Build from backend/model_server/:  docker build -t alpha-model-server .

# Stage 1: download the ONNX model and its tokenizer once (the original publisher's export first, a community export of the
# same weights as fallback). huggingface-hub is only needed here and is not copied to the runtime image.
FROM python:3.12-slim AS model
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
RUN --mount=type=cache,target=/root/.cache/pip pip install huggingface-hub==0.26.2
WORKDIR /opt/model
RUN python - <<'PY'
import shutil
from huggingface_hub import hf_hub_download

for repo in ("intfloat/multilingual-e5-small", "Xenova/multilingual-e5-small"):
    try:
        onnx = hf_hub_download(repo, "onnx/model.onnx")
        tokenizer = hf_hub_download(repo, "tokenizer.json")
    except Exception as exc:  # try the next source
        print(f"{repo} unavailable ({type(exc).__name__}); trying the next source")
        continue
    shutil.copyfile(onnx, "/opt/model/model.onnx")
    shutil.copyfile(tokenizer, "/opt/model/tokenizer.json")
    print(f"model downloaded from {repo}")
    break
else:
    raise SystemExit("could not download multilingual-e5-small from any source")
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
