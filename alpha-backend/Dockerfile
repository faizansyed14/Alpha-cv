FROM python:3.12-slim

# Environment variables for Python runtime
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    HF_HOME=/opt/hf-cache

# Install minimal system dependencies for OCR + numpy/scipy
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      libtesseract5 \
      libgomp1 \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch (this system has no GPU). Installed before requirements.txt
# for better layer caching; only torch itself is needed (no torchvision/audio).
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir torch==2.3.1 --index-url https://download.pytorch.org/whl/cpu

# Install application dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip uninstall -y torchvision torchaudio 2>/dev/null || true

# Bake the embedding model into the image (HF_HOME above pins the cache path;
# it lives OUTSIDE /app because docker-compose.dev.yml bind-mounts ./alpha-backend
# over /app, which would hide a cache stored there and break HF_HUB_OFFLINE=1)
# instead of downloading it from huggingface.co on first use at runtime. This
# matters most for the match-worker: `--scale match-worker=N` or any redeploy
# would otherwise have every new replica hit the network for ~420MB before it
# could process its first job, and fail to start at all if huggingface.co is
# unreachable from the VPC at that moment. Must match EMBEDDING_MODEL_NAME in
# app/core/config.py — if you change that setting, update this line too.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-mpnet-base-v2')" \
    && chmod -R a+rX /opt/hf-cache

# Force huggingface_hub/transformers to use that baked cache directly instead
# of first doing a HEAD request per file to check for updates. Verified this
# matters: even with the model fully cached, sentence-transformers still
# tried to reach huggingface.co on every load (5 retries with backoff, ~30s)
# before falling back to disk — a real problem for a container with no
# outbound internet (the security-preferred setup) or just a slow/flaky NAT.
# Since the model is baked in above, "offline" here also means "fail fast and
# loud" if EMBEDDING_MODEL_NAME is ever changed without rebuilding the image,
# instead of a silent runtime download of a different model.
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

# Copy application code
COPY . .

# Run as a non-root user. The data dirs are also created + owned so the app can
# write uploads / LLM cache whether or not a named volume is mounted there.
RUN groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app appuser \
    && mkdir -p /data/uploads/cv /data/llm_cache \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

# Start uvicorn with configurable worker count (HOST/PORT from environment)
CMD uvicorn app.main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000} --workers ${UVICORN_WORKERS:-4}
