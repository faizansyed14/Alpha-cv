"""OCR for scanned CVs: RapidOCR (PP-OCR models on ONNX Runtime).

Same engine the Al-ain RAG stack uses. RapidOCR ships its detection/recognition models inside the wheel, so there is
no apt package, no model download and no subprocess to hang.

Safety for a shared host:
  * one engine per process, built lazily;
  * at most ``OCR_MAX_CONCURRENT`` recognitions at a time, so a burst of scanned uploads queues instead of
    oversubscribing the CPUs (ONNX Runtime threads are bounded by ``OCR_THREADS``);
  * results are cached by the image's SHA-256 (Redis, shared by every worker): re-saved PDFs and the same scan
    uploaded twice are read once.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import threading
from typing import Any, List, Optional, Tuple

from PIL import Image

from app.config.settings import settings
from app.monitoring.recorder import timed

logger = logging.getLogger(__name__)

_CACHE_NS = "ocr"
_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7

_engine: Any = None
_engine_lock = threading.Lock()
_slots = threading.BoundedSemaphore(max(1, settings.OCR_MAX_CONCURRENT))
_rapidocr_missing = False


def _get_engine() -> Any:
    global _engine, _rapidocr_missing
    if _engine is not None or _rapidocr_missing:
        return _engine
    with _engine_lock:
        if _engine is None and not _rapidocr_missing:
            try:
                from rapidocr_onnxruntime import RapidOCR

                threads = max(1, settings.OCR_THREADS)
                _engine = RapidOCR(intra_op_num_threads=threads, inter_op_num_threads=1)
            except Exception as exc:  # noqa: BLE001 - not installed / cannot initialise
                _rapidocr_missing = True
                logger.error(f"RapidOCR unavailable: {exc}")
    return _engine


def _group_lines(items: List[Tuple[Any, str, float]]) -> str:
    """Join recognised boxes into reading-order lines (top to bottom, left to right)."""
    boxes = []
    for points, text, _score in items:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        boxes.append((min(xs), min(ys), max(xs), max(ys), text))
    boxes.sort(key=lambda b: ((b[1] + b[3]) / 2, b[0]))
    lines: List[List[tuple]] = []
    for box in boxes:
        if lines:
            last = lines[-1]
            top, bottom = min(b[1] for b in last), max(b[3] for b in last)
            overlap = min(bottom, box[3]) - max(top, box[1])
            if overlap > 0.5 * min(bottom - top, box[3] - box[1]):
                last.append(box)
                continue
        lines.append([box])
    return "\n".join(" ".join(b[4] for b in sorted(line, key=lambda b: b[0])) for line in lines)


# PP-OCR sometimes puts a space around the '@' / dots of an e-mail address ("jane.smith @example .com"), which would
# defeat PII extraction downstream; glue those back together (never across ". " so sentence ends are untouched).
_EMAIL_GAPS = re.compile(r"([\w.+-]+)\s*@\s*([\w-]+(?:\s?\.[\w-]+)+)")


def tidy_text(text: str) -> str:
    return _EMAIL_GAPS.sub(lambda m: m.group(1) + "@" + re.sub(r"\s+", "", m.group(2)), text)


def _rapidocr(engine: Any, image: Image.Image) -> str:
    import numpy as np

    result, _ = engine(np.asarray(image.convert("RGB")))
    return _group_lines([r[:3] for r in result or []])


def _cache():
    try:
        from app.providers.cache.redis import get_redis_cache

        cache = get_redis_cache()
        return cache if cache.is_connected else None
    except Exception:  # noqa: BLE001
        return None


def ocr_image(image: Image.Image) -> str:
    """OCR one PIL image and return its text ('' when nothing readable)."""
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    return ocr_png(buf.getvalue())


def ocr_png(png_bytes: bytes) -> str:
    """OCR PNG bytes. Cached by content hash; bounded concurrency."""
    key = hashlib.sha256(png_bytes).hexdigest()
    cache = _cache()
    if cache is not None:
        hit: Optional[str] = cache.get(key, namespace=_CACHE_NS)
        if isinstance(hit, str):
            return hit

    image = Image.open(io.BytesIO(png_bytes))
    with _slots, timed("ocr", "page", "rapidocr", px=f"{image.width}x{image.height}"):
        engine = _get_engine()
        if engine is None:
            raise RuntimeError("OCR engine unavailable (rapidocr-onnxruntime is not installed)")
        text = _rapidocr(engine, image)
    text = tidy_text(text).strip()

    if cache is not None and text:
        try:
            cache.set(key, text, ttl_seconds=_CACHE_TTL_SECONDS, namespace=_CACHE_NS)
        except Exception:  # noqa: BLE001 - cache is best-effort
            pass
    return text
