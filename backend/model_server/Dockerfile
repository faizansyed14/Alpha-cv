# syntax=docker/dockerfile:1.7
# Embedding model server (torch CPU + sentence-transformers). Internal only: compose does not publish its port.
# Built rarely (requirements and the model almost never change), so the backend image never pays for torch.
# Build from backend/model_server/:  docker build -t alpha-model-server .

FROM python:3.12-slim AS build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# CPU-only torch first (own cacheable layer), then the rest.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch==2.3.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt \
    && pip uninstall -y torchvision torchaudio 2>/dev/null || true
# Bake the model into the image (must match EMBEDDING_MODEL_NAME). HF_HOME is outside any bind-mounted path.
ENV HF_HOME=/opt/hf-cache
ARG EMBEDDING_MODEL_NAME=all-mpnet-base-v2
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL_NAME}')" \
    && chmod -R a+rX /opt/hf-cache

FROM python:3.12-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app app
COPY --from=build /opt/venv /opt/venv
COPY --from=build /opt/hf-cache /opt/hf-cache
ARG EMBEDDING_MODEL_NAME=all-mpnet-base-v2
ENV PATH="/opt/venv/bin:$PATH" \
    HF_HOME=/opt/hf-cache HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    EMBEDDING_MODEL_NAME=${EMBEDDING_MODEL_NAME}
WORKDIR /app
COPY server.py .
USER app
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4).status == 200 else 1)"]
# One process on purpose: a single copy of the model in RAM; requests are serialised by the FIFO gate in server.py.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
