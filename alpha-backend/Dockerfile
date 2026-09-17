FROM python:3.12-slim

# Environment variables for Python runtime
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

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
