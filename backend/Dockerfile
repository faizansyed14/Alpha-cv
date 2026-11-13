# syntax=docker/dockerfile:1.7
# One image for the API, the match worker and the background worker; the compose `command:` picks the role:
#   uvicorn app.main:app | python -m app.jobs.match_worker | python -m app.jobs.background_worker
# There is no ML runtime here: embeddings come from the model-server container (see model_server/).
# Build from backend/:  docker build -t backend .

ARG PYTHON_IMAGE=python:3.12-slim

# ---- build: resolve the pinned dependencies into /opt/venv ---------------------------------------------------------
FROM ${PYTHON_IMAGE} AS build
# A dropped connection during the long install used to end the build with "No matching distribution ... (from versions: none)":
# retry more often and wait longer before giving up on the package index.
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_RETRIES=10 PIP_DEFAULT_TIMEOUT=100
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /src
# Dependencies first so this layer is cached until requirements.txt changes; the pip cache mount keeps downloaded
# wheels between builds, so even a changed requirements.txt only fetches what is new.
COPY requirements.txt ./
# rapidocr-onnxruntime declares the GUI "opencv-python" (needs libGL, clashes with the headless build pinned in
# requirements.txt): drop it and put the headless build back.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt \
    && pip uninstall -y opencv-python \
    && pip install --force-reinstall --no-deps "$(grep -i '^opencv-python-headless' requirements.txt | cut -d' ' -f1)"

# ---- runtime -------------------------------------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PATH="/opt/venv/bin:$PATH" \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2
# One BLAS thread per process. NumPy's OpenBLAS otherwise starts one thread per HOST core (it ignores the container's
# CPU limit), which makes the tiny similarity matmuls spin: measured 374 ms vs 17 ms of CPU per CV scored (3x slower
# wall time) on a 2-CPU worker, with bit-identical scores. Parallelism comes from the runner/thread-pool/replica counts.
# MALLOC_ARENA_MAX=2: glibc otherwise keeps a separate memory arena per thread, each holding its own high-water mark;
# a 6,000-CV match peaked at 344 MiB without it and 237 MiB with it, at the same speed.

# OpenMP for numpy/scipy/onnxruntime (OCR is RapidOCR from the venv), antiword reads legacy .doc, DejaVu draws previews.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 antiword fonts-dejavu-core curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/venv /opt/venv

WORKDIR /app
COPY . .

# Non-root user. The data dir is created and owned so the app can write uploads whether or not a named volume is
# mounted there.
RUN groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app appuser \
    && mkdir -p /data/uploads/cv \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

# API: HOST/PORT/UVICORN_WORKERS come from the environment. Workers override this with their own command.
CMD uvicorn app.main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000} --workers ${UVICORN_WORKERS:-4}
