"""Files a person attaches in Agentic mode (a job description to post).

An attached file is first validated like every other upload (content, size, bombs, macros: ``security/uploads.py``), read into text
so the assistant can draft from it, and kept in a small private staging area for at most two hours. It is only POSTED, exactly like
the Careers page does it, when the person confirms the draft. Until then it belongs to nobody else: every read checks the owner.

Staged copies are temporary working files. They expire on their own and are removed once the job is posted; nothing else is ever
removed by this feature.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

from app.config.settings import settings

TTL_SECONDS = 2 * 3600
_REF = re.compile(r"^[0-9a-f]{32}$")


@dataclass
class Staged:
    ref: str
    filename: str
    text: str

    @property
    def chars(self) -> int:
        return len(self.text)


def _dir() -> Path:
    path = Path(os.getenv("AGENTIC_UPLOAD_DIR") or Path(tempfile.gettempdir()) / "alpha_agentic_uploads")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _extract_text(data: bytes, filename: str) -> str:
    from app.ingestion.cv_parser import get_parsing_service

    ext = os.path.splitext(filename)[1].lower() or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        return str(get_parsing_service().process_document(path, "jd").get("raw_text") or "").strip()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def expire_old() -> None:
    """Remove staged files older than the time limit (they are working copies; the person was never promised they would stay)."""
    cutoff = time.time() - TTL_SECONDS
    for item in _dir().glob("*.json"):
        try:
            if item.stat().st_mtime < cutoff:
                item.with_suffix(".bin").unlink(missing_ok=True)
                item.unlink(missing_ok=True)
        except OSError:
            continue


def stage(username: str, data: bytes, filename: str) -> Staged:
    """Keep the file for this person and return what the assistant needs. Raises ValueError with a message safe to show."""
    text = _extract_text(data, filename)
    if len(text) < 100:
        raise ValueError("Not enough text could be read from that file. Try another file, or paste the job description.")
    expire_old()
    ref = uuid.uuid4().hex
    base = _dir() / ref
    base.with_suffix(".bin").write_bytes(data)
    base.with_suffix(".json").write_text(json.dumps({"username": username, "filename": filename[:200], "text": text[: settings.AGENT_MAX_JD_CHARS]}), encoding="utf-8")
    return Staged(ref=ref, filename=filename[:200], text=text[: settings.AGENT_MAX_JD_CHARS])


def _meta(username: str, ref: str) -> Optional[dict]:
    if not _REF.match(ref or ""):
        return None
    meta_file = _dir() / f"{ref}.json"
    try:
        if time.time() - meta_file.stat().st_mtime > TTL_SECONDS:
            return None
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return meta if meta.get("username") == username else None


def load(username: str, ref: str) -> Optional[Staged]:
    meta = _meta(username, ref)
    return Staged(ref=ref, filename=meta["filename"], text=meta["text"]) if meta else None


def read_bytes(username: str, ref: str) -> Optional[Tuple[bytes, str, str]]:
    """(file bytes, file name, mime type) for the owner, or None when it expired or is not theirs."""
    meta = _meta(username, ref)
    if not meta:
        return None
    try:
        data = (_dir() / f"{ref}.bin").read_bytes()
    except OSError:
        return None
    return data, meta["filename"], mimetypes.guess_type(meta["filename"])[0] or "application/octet-stream"


def release(username: str, ref: str) -> None:
    """The job was posted: the staged working copy is no longer needed."""
    if _meta(username, ref):
        for suffix in (".bin", ".json"):
            (_dir() / f"{ref}{suffix}").unlink(missing_ok=True)
