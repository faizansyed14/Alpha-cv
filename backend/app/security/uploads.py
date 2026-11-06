"""Safe handling of uploaded CV / job-description files.

Everything a visitor sends is hostile until proven otherwise. The extension and the Content-Type header are chosen by the
sender, so they decide nothing. Checks, in order (layered: no single one is enough, see the OWASP File Upload cheat sheet):

  1. size while reading   the body is read in chunks and refused the moment it passes the limit (no unbounded memory)
  2. type by CONTENT      magic bytes must match the extension, so a script or executable renamed ".pdf" is refused
  3. container limits     Office files (zip): member count, total size, compression ratio (zip bombs), unsafe paths,
                          nested archives, macros, embedded objects, remote templates
  4. active content       PDF JavaScript / launch actions / embedded files, legacy .doc macros, RTF embedded objects
  5. image limits         pixel count (decompression bombs)
  6. name hygiene         the stored/displayed name has no path parts or control characters (storage names are our own ids)
  7. antivirus (optional) ClamAV over INSTREAM when CLAMAV_URL is set; CLAMAV_REQUIRED makes an unreachable scanner fatal

A rejection carries a message that is safe to show the person who uploaded the file.
"""
from __future__ import annotations

import asyncio
import io
import logging
import re
import socket
import struct
import unicodedata
import zipfile
from pathlib import PurePosixPath
from typing import Iterable, Optional, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException, UploadFile

from app.config.settings import settings

logger = logging.getLogger(__name__)

READ_CHUNK = 1024 * 1024
MAX_ZIP_MEMBERS = 2_000
MAX_ZIP_EXPANDED = 200 * 1024 * 1024
MAX_ZIP_RATIO = 100                    # OWASP's starting point for the decompression ratio
MAX_PDF_PAGES = 300
MAX_PDF_OBJECTS = 100_000
MAX_IMAGE_PIXELS = 40_000_000

# extension -> the kinds of content it may legitimately hold ("doc" is often really RTF or a docx saved under the old name)
EXT_KINDS = {
    ".pdf": {"pdf"}, ".docx": {"docx"}, ".doc": {"doc", "rtf", "docx"}, ".rtf": {"rtf"}, ".odt": {"odt"},
    ".txt": {"text"}, ".html": {"html", "text"}, ".htm": {"html", "text"},
    ".png": {"png"}, ".jpg": {"jpg"}, ".jpeg": {"jpg"}, ".tiff": {"tiff"}, ".bmp": {"bmp"},
}
PUBLIC_CV_EXTENSIONS = (".pdf", ".docx", ".doc", ".txt")          # what a visitor may send on the job page
CV_EXTENSIONS = tuple(EXT_KINDS)                                  # everything the parsers read
JD_EXTENSIONS = (".pdf", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg")

_BAD_MEMBER_NAME = re.compile(r"(?:^|/)(?:vbaProject\.bin|.*\.(?:exe|dll|scr|bat|cmd|ps1|vbs|js|jar|sh|msi|com|lnk|hta|class))$", re.I)
_EXTERNAL_TARGET = re.compile(
    r'<Relationship\b[^>]*Type="[^"]*(?:attachedTemplate|oleObject|frame|subDocument|externalLink|externalLinkPath|package)[^"]*"[^>]*TargetMode="External"'
    r'|<Relationship\b[^>]*TargetMode="External"[^>]*Type="[^"]*(?:attachedTemplate|oleObject|frame|subDocument|externalLink|externalLinkPath|package)[^"]*"', re.I)
_PDF_ACTIVE = re.compile(rb"/(?:JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z])")
_PDF_NAME_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")


class UploadRejected(Exception):
    """The file was refused. ``str(exc)`` is safe to show to the uploader."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ------------------------------------------------------------------------------------------------------- names
def safe_filename(name: Optional[str]) -> str:
    """A display name with no path, control characters or markup characters (never used to build a storage path)."""
    name = unicodedata.normalize("NFC", PurePosixPath((name or "").replace("\\", "/")).name)
    name = re.sub(r"[\x00-\x1f\x7f<>:\"|?*]", "_", name).strip(" .")
    if not name:
        return "upload"
    if len(name) > 180:
        stem, dot, ext = name.rpartition(".")
        name = (stem[:170] + dot + ext[:8]) if dot else name[:180]
    return name


def extension_of(name: Optional[str]) -> str:
    base = safe_filename(name)
    return "." + base.rsplit(".", 1)[1].lower() if "." in base else ""


# ------------------------------------------------------------------------------------------------------ sniffing
def sniff(data: bytes) -> Optional[str]:
    """What the bytes really are, by signature. None when it is not a format we accept."""
    head = data[:1024]
    if b"%PDF-" in head:
        return "pdf"
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "doc"
    if data[:5] == b"{\\rtf":
        return "rtf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if data[:2] == b"BM":
        return "bmp"
    if data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
        except zipfile.BadZipFile:
            return None
        if "[Content_Types].xml" in names and any(n.startswith("word/") for n in names):
            return "docx"
        if "content.xml" in names and "mimetype" in names:
            return "odt"
        return None
    sample = data[:8192]
    if b"\x00" in sample:
        return None
    printable = sum(1 for b in sample if b in (9, 10, 13) or 32 <= b < 127 or b >= 128)
    if sample and printable / len(sample) < 0.95:
        return None
    lowered = sample.lower()
    return "html" if (b"<html" in lowered or b"<!doctype html" in lowered or b"<body" in lowered) else "text"


# -------------------------------------------------------------------------------------------- container checks
def _check_zip(data: bytes, kind: str) -> None:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise UploadRejected("The document is damaged and cannot be opened.") from exc
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ZIP_MEMBERS:
            raise UploadRejected("The document contains too many parts.")
        expanded = sum(i.file_size for i in infos)
        if expanded > MAX_ZIP_EXPANDED or expanded > max(len(data), 1) * MAX_ZIP_RATIO:
            raise UploadRejected("The document expands to an unsafe size.")
        for info in infos:
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts:
                raise UploadRejected("The document contains unsafe file paths.")
            if _BAD_MEMBER_NAME.search(info.filename):
                raise UploadRejected("The document contains macros or executable content, which is not allowed.")
            if re.search(r"(?:^|/)(?:embeddings|activeX|ObjectPool)/", info.filename, re.I) or info.filename.lower().endswith(
                    (".zip", ".docx", ".docm", ".xlsm", ".7z", ".rar", ".gz")):
                raise UploadRejected("The document contains embedded objects or archives, which is not allowed.")
            if info.filename.endswith(".rels") and info.file_size <= 1_000_000:
                if _EXTERNAL_TARGET.search(zf.read(info).decode("utf-8", errors="ignore")):
                    raise UploadRejected("The document loads content from another location, which is not allowed.")
        if kind == "docx" and "word/document.xml" not in {i.filename for i in infos}:
            raise UploadRejected("The file is not a valid Word document.")


def _check_pdf(data: bytes) -> None:
    flat = _PDF_NAME_ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), data)   # "/Java#53cript" is "/JavaScript"
    if _PDF_ACTIVE.search(flat):
        raise UploadRejected("The PDF contains scripts, launch actions or embedded files, which is not allowed. "
                             "Please save or print it as a plain PDF and upload it again.")
    try:
        import fitz  # PyMuPDF: also sees objects hidden inside compressed object streams
    except Exception:  # noqa: BLE001
        return
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise UploadRejected("The PDF is damaged and cannot be opened.") from exc
    try:
        if doc.needs_pass:
            raise UploadRejected("The PDF is password protected. Please upload an unprotected copy.")
        if doc.page_count > MAX_PDF_PAGES:
            raise UploadRejected(f"The PDF has more than {MAX_PDF_PAGES} pages.")
        count = doc.xref_length()
        if count > MAX_PDF_OBJECTS:
            raise UploadRejected("The PDF is too complex.")
        for xref in range(1, count):
            try:
                body = doc.xref_object(xref, compressed=False).encode("latin-1", errors="ignore")
            except Exception:  # noqa: BLE001
                continue
            if _PDF_ACTIVE.search(_PDF_NAME_ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), body)):
                raise UploadRejected("The PDF contains scripts, launch actions or embedded files, which is not allowed.")
    finally:
        doc.close()


def _check_ole(data: bytes) -> None:
    """A legacy .doc holds macros in a "_VBA_PROJECT" storage and embedded objects in an "ObjectPool"."""
    for name in ("_VBA_PROJECT", "ObjectPool"):
        if name.encode() in data or name.encode("utf-16le") in data:
            raise UploadRejected("The Word document contains macros or embedded objects, which is not allowed.")


def _check_rtf(data: bytes) -> None:
    if re.search(rb"\\(?:objdata|objemb|objupdate|objautlink|\*\\template)", data, re.I):
        raise UploadRejected("The document contains embedded objects, which is not allowed.")


def _check_image(data: bytes) -> None:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as img:
            width, height = img.size
            if width * height > MAX_IMAGE_PIXELS:
                raise UploadRejected("The image is too large.")
            img.verify()
    except UploadRejected:
        raise
    except Exception as exc:  # noqa: BLE001
        raise UploadRejected("The image is damaged and cannot be opened.") from exc


# ----------------------------------------------------------------------------------------------------- the check
def validate_upload(data: bytes, filename: Optional[str], allowed: Iterable[str], *, max_bytes: Optional[int] = None) -> str:
    """The detected kind of a safe file, or UploadRejected. ``allowed`` lists the extensions this form accepts."""
    limit = max_bytes or settings.max_file_size_bytes
    if not data:
        raise UploadRejected("The file is empty.")
    if len(data) > limit:
        raise UploadRejected(f"The file is larger than {limit // (1024 * 1024)} MB.", 413)
    ext = extension_of(filename)
    allowed = tuple(allowed)
    if ext not in allowed:
        raise UploadRejected(f"{ext or 'This'} files are not accepted. Please upload: {', '.join(allowed)}.")
    kind = sniff(data)
    if kind is None or kind not in EXT_KINDS.get(ext, set()):
        raise UploadRejected(f"The file does not look like a real {ext} document. Please upload the original file.")
    if kind in ("docx", "odt"):
        _check_zip(data, kind)
    elif kind == "pdf":
        _check_pdf(data)
    elif kind == "doc":
        _check_ole(data)
    elif kind == "rtf":
        _check_rtf(data)
    elif kind in ("png", "jpg", "tiff", "bmp"):
        _check_image(data)
    return kind


def clamav_scan(data: bytes, url: str, timeout_s: float = 30.0) -> None:
    """Scan with clamd's INSTREAM command (tcp://host:3310). Raises UploadRejected when a virus is found."""
    parsed = urlparse(url)
    with socket.create_connection((parsed.hostname or "localhost", parsed.port or 3310), timeout=timeout_s) as sock:
        sock.sendall(b"zINSTREAM\0")
        view = memoryview(data)
        for start in range(0, len(view), READ_CHUNK):
            chunk = view[start: start + READ_CHUNK]
            sock.sendall(struct.pack("!L", len(chunk)) + chunk)
        sock.sendall(struct.pack("!L", 0))
        reply = sock.recv(4096).decode(errors="replace").strip("\0 \n")
    if "FOUND" in reply:
        raise UploadRejected("The file was rejected by the virus scanner.")
    if not reply.endswith("OK"):
        raise RuntimeError(f"virus scanner replied: {reply[:200]}")


def scan_for_viruses(data: bytes) -> None:
    """ClamAV when CLAMAV_URL is set. An unreachable scanner is fatal only when CLAMAV_REQUIRED is on."""
    url = getattr(settings, "CLAMAV_URL", "") or ""
    if not url:
        return
    try:
        clamav_scan(data, url)
    except UploadRejected:
        raise
    except Exception as exc:  # noqa: BLE001
        if getattr(settings, "CLAMAV_REQUIRED", False):
            logger.error(f"Virus scanner unavailable and required: {exc}")
            raise UploadRejected("Files cannot be checked right now. Please try again shortly.", 503) from exc
        logger.warning(f"Virus scanner unavailable, continuing without it: {exc}")


# ------------------------------------------------------------------------------------------- for the routes
async def read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    """The upload body, read in chunks and refused as soon as it passes ``max_bytes``."""
    buf = bytearray()
    while True:
        chunk = await upload.read(READ_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise UploadRejected(f"The file is larger than {max_bytes // (1024 * 1024)} MB.", 413)
    await upload.seek(0)
    return bytes(buf)


async def secure_upload(upload: UploadFile, allowed: Iterable[str], max_bytes: Optional[int] = None) -> Tuple[bytes, str, str]:
    """(bytes, safe display name, detected kind) for an uploaded file, or an HTTPException with a message for the user."""
    limit = max_bytes or settings.max_file_size_bytes
    try:
        if not upload.filename:
            raise UploadRejected("A file name is required.")
        data = await read_limited(upload, limit)
        kind = await asyncio.to_thread(validate_upload, data, upload.filename, allowed, max_bytes=limit)
        await asyncio.to_thread(scan_for_viruses, data)
    except UploadRejected as exc:
        logger.warning(f"Upload refused ({safe_filename(upload.filename)}): {exc}")
        raise HTTPException(status_code=exc.status, detail=str(exc))
    upload.filename = safe_filename(upload.filename)   # everything downstream sees the cleaned name
    return data, upload.filename, kind
