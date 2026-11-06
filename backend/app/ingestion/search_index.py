"""Search fields on every cv_structured point, read by the advanced CV search.

  search_text         every word of the CV (its text, title, skills, keywords, name, contact, location ...) as
                      lower-case tokens joined by single spaces. Full-text indexed, so a keyword is an index lookup
                      over the whole collection, and a phrase can be confirmed with a plain substring test.
  search_literal      only what the CV literally says (its text, name, contact, location, nationality): no AI-written
                      skill/responsibility sentences or keywords. Boolean search is decided on this field, so a term the
                      CV does not contain never matches. Not indexed; read back and checked exactly.
  search_location     location tokens ("Dubai, UAE" -> "dubai uae")
  search_nationality  nationality tokens
  search_experience   years of experience as a number (null when unknown), range indexed
  search_version      SEARCH_VERSION, so the backfill knows which records still need the fields
  uploaded_at         when the CV was uploaded, as a number (seconds since 1970), range indexed. The Candidates list
                      is paged newest-first by Qdrant on this field instead of sorting every CV in Python.

The query side normalises what the recruiter types with the same `normalize`, so both sides always agree.
"""
from __future__ import annotations

import hashlib
import logging
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

SEARCH_VERSION = 3   # 2: adds uploaded_at; 3: adds search_literal
SEARCH_FIELDS = ("search_text", "search_literal", "search_location", "search_nationality", "search_experience", "search_version",
                 "uploaded_at")

# Technology names a word tokenizer would otherwise destroy ("C#" -> "c", ".NET" -> "net").
_TECH = (
    (re.compile(r"(?<![a-z0-9])c\s*\+\+"), " cplusplus "),
    (re.compile(r"(?<![a-z0-9])c\s*#"), " csharp "),
    (re.compile(r"(?<![a-z0-9])f\s*#"), " fsharp "),
    (re.compile(r"\.net\b"), " dotnet "),
)
_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def tokens(text: Any) -> List[str]:
    s = unicodedata.normalize("NFKC", str(text or "")).lower()
    for rx, replacement in _TECH:
        s = rx.sub(replacement, s)
    return _TOKEN.findall(s)


def normalize(text: Any) -> str:
    return " ".join(tokens(text))


def experience_years(value: Any) -> Optional[float]:
    """5 / 5.5 / "5" / "5+ years" -> a number; anything unreadable or implausible -> None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        years = float(value)
    else:
        m = _NUMBER.search(str(value))
        if not m:
            return None
        years = float(m.group())
    return years if 0 <= years <= 70 else None


def _strings(values: Any) -> Iterable[str]:
    if isinstance(values, (list, tuple)):
        return [str(v) for v in values if v]
    return [str(values)] if values else []


def uploaded_at_value(upload_date: Any, cv_id: str) -> float:
    """Upload time as seconds since 1970, made unique per CV.

    Old uploads only know their date to the second, and bulk uploads put thousands of CVs in the same second; a
    stable sub-second offset taken from the id gives each its own value, so paging by this field never repeats or
    skips a CV. Unknown dates sort last (0).
    """
    try:
        dt = datetime.fromisoformat(str(upload_date).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        base = dt.timestamp()
    except (ValueError, TypeError, OverflowError):
        base = 0.0
    offset = int(hashlib.md5(str(cv_id).encode("utf-8")).hexdigest()[:7], 16) / float(16 ** 7)   # [0, 1)
    return (base if base > 0 else 0.0) + offset * 0.999


def build_search_fields(payload: Dict[str, Any], text: str, uploaded_at: Optional[float] = None) -> Dict[str, Any]:
    """The search fields for one CV, from its cv_structured payload and its extracted text."""
    info = payload.get("structured_info") or {}

    def pick(key: str) -> Any:   # the record's own value (the door's facts) wins over the LLM reading
        value = payload.get(key)
        return value if value not in (None, "") else info.get(key)

    phone = str(pick("phone") or "")
    parts: List[str] = [text or ""]
    for key in ("name", "job_title", "category", "email", "phone", "location", "nationality", "notice_period"):
        parts.extend(_strings(pick(key)))
    parts.append(re.sub(r"\D", "", phone))   # so a number typed without spaces or "+" still matches
    for key in ("keywords", "skills_sentences", "skills", "responsibility_sentences", "responsibilities", "languages"):
        parts.extend(_strings(info.get(key)))

    literal = [text or ""]
    for key in ("name", "email", "phone", "location", "nationality", "notice_period"):
        literal.extend(_strings(pick(key)))
    literal.append(re.sub(r"\D", "", phone))

    fields = {
        "search_text": normalize(" \n ".join(parts)),
        "search_literal": normalize(" \n ".join(literal)),
        "search_location": normalize(pick("location")),
        "search_nationality": normalize(pick("nationality")),
        "search_experience": experience_years(pick("years_of_experience")),
        "search_version": SEARCH_VERSION,
    }
    if uploaded_at is not None:
        fields["uploaded_at"] = uploaded_at
    return fields


def matched_terms(search_text: str, terms: List[str]) -> List[str]:
    """Which normalised terms appear in the text as whole words (a multi-word term as an exact phrase)."""
    padded = f" {search_text or ''} "
    return [t for t in terms if f" {t} " in padded]


# ---------------------------------------------------------------------------------------------------------------------
# writing the fields
# ---------------------------------------------------------------------------------------------------------------------
def _cv_docs(qdrant, ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """{cv_id: {"text": extracted text, "uploaded_at": float}} from cv_documents, in one request."""
    from app.providers.vectorstore.qdrant import get_decompressed_content

    points = qdrant.client.retrieve("cv_documents", ids=ids, with_vectors=False,
                                    with_payload=["raw_content", "raw_content_compressed", "upload_date"])
    return {
        str(p.id): {"text": get_decompressed_content(p.payload or {}),
                    "uploaded_at": uploaded_at_value((p.payload or {}).get("upload_date"), str(p.id))}
        for p in points
    }


def _cv_texts(qdrant, ids: List[str]) -> Dict[str, str]:
    return {k: v["text"] for k, v in _cv_docs(qdrant, ids).items()}


def index_cv(qdrant, cv_id: str, text: Optional[str] = None) -> bool:
    """(Re)write one CV's search fields from what is stored now. Never raises: search must not break ingestion."""
    try:
        from qdrant_client.models import PayloadSelectorExclude

        points = qdrant.client.retrieve("cv_structured", ids=[cv_id], with_vectors=False,
                                        with_payload=PayloadSelectorExclude(exclude=["search_text", "search_literal"]))
        if not points:
            return False
        doc = _cv_docs(qdrant, [cv_id]).get(str(cv_id), {})
        if text is None:
            text = doc.get("text", "")
        uploaded = doc.get("uploaded_at", uploaded_at_value(None, cv_id))
        qdrant.client.set_payload("cv_structured", payload=build_search_fields(points[0].payload or {}, text, uploaded),
                                  points=[cv_id])
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Search fields for CV {cv_id} not written: {e}")
        return False


def backfill(qdrant, batch_size: int = 128, on_batch=None) -> int:
    """Write the search fields on every CV that lacks the current version. Idempotent; returns how many it wrote."""
    from qdrant_client.models import FieldCondition, Filter, MatchValue, PayloadSelectorExclude, SetPayload, SetPayloadOperation

    pending = Filter(must_not=[FieldCondition(key="search_version", match=MatchValue(value=SEARCH_VERSION))])
    done = 0
    previous: Optional[set] = None
    while True:
        points, _ = qdrant.client.scroll("cv_structured", scroll_filter=pending, limit=batch_size, with_vectors=False,
                                         with_payload=PayloadSelectorExclude(exclude=["search_text", "search_literal"]))
        if not points:
            return done
        ids = [str(p.id) for p in points]
        if previous == set(ids):   # the writes did not take; stop instead of spinning
            logger.error("Search backfill made no progress; stopping")
            return done
        previous = set(ids)
        docs = _cv_docs(qdrant, ids)
        qdrant.client.batch_update_points("cv_structured", update_operations=[
            SetPayloadOperation(set_payload=SetPayload(
                payload=build_search_fields(p.payload or {}, docs.get(str(p.id), {}).get("text", ""),
                                            docs.get(str(p.id), {}).get("uploaded_at", uploaded_at_value(None, str(p.id)))),
                points=[p.id]))
            for p in points
        ])
        done += len(points)
        if on_batch:
            on_batch(done)


_LOCK_KEY = "search_index:backfill_lock"


def start_backfill_in_background() -> None:
    """Index CVs stored before the search fields existed, without delaying startup. One process at a time."""
    def run() -> None:
        from app.providers.cache.redis import get_redis_cache
        from app.providers.vectorstore.qdrant import get_qdrant_utils

        redis = get_redis_cache()
        client = redis.redis_client if redis.is_connected else None
        try:
            if client is not None and not client.set(_LOCK_KEY, "1", nx=True, ex=600):
                client = None   # another process is on it; leave its lock alone
                return
            started = time.time()

            def renew(done: int) -> None:
                if client is not None:
                    client.expire(_LOCK_KEY, 600)
                logger.info(f"Search backfill: {done} CVs indexed")

            done = backfill(get_qdrant_utils(), on_batch=renew)
            if done:
                logger.info(f"Search backfill finished: {done} CVs in {time.time() - started:.0f}s")
        except Exception as e:  # noqa: BLE001
            logger.error(f"Search backfill failed (will retry on next start): {e}")
        finally:
            if client is not None:
                try:
                    client.delete(_LOCK_KEY)
                except Exception:  # noqa: BLE001
                    pass

    threading.Thread(target=run, name="search-backfill", daemon=True).start()


if __name__ == "__main__":   # python -m app.ingestion.search_index  -> index every CV that still needs it, now
    from app.config.logging import configure_logging
    from app.providers.vectorstore.qdrant import get_qdrant_utils

    configure_logging()
    total = backfill(get_qdrant_utils(), on_batch=lambda n: print(f"{n} CVs indexed", flush=True))
    print(f"Done: {total} CVs indexed")
