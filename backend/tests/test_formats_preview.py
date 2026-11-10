"""CV formats (legacy .doc, RTF, ODT, HTML) are extracted, and any CV can be previewed as drawn pages."""

import zipfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import docx
import pytest
from fastapi.testclient import TestClient

from app.api.deps import require_core_app
from app.ingestion.cv_parser import ParsingService
from app.ingestion.preview import page_count, render_page_png
from app.main import app

BODY = ("Jane Smith - Senior Python Developer. Email jane.smith@example.com. "
        "Seven years building FastAPI services with PostgreSQL, Redis and Docker.")


@pytest.fixture
def parser():
    return ParsingService()


def _process(parser, path):
    return parser.process_document(str(path), "cv")


def test_rtf_is_extracted(parser, tmp_path):
    f = tmp_path / "cv.rtf"
    f.write_text(r"{\rtf1\ansi{\b Jane Smith}\par " + BODY + r"\par}")
    assert "Senior Python Developer" in _process(parser, f)["raw_text"]


def test_odt_is_extracted(parser, tmp_path):
    f = tmp_path / "cv.odt"
    xml = ('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
           'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
           f'<text:h>Jane Smith</text:h><text:p>{BODY}</text:p></office:text></office:body></office:document-content>')
    with zipfile.ZipFile(f, "w") as zf:
        zf.writestr("content.xml", xml)
    text = _process(parser, f)["raw_text"]
    assert "Jane Smith" in text and "FastAPI" in text


@pytest.mark.parametrize("bomb", [
    '<!DOCTYPE bomb [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>',          # entity expansion ("billion laughs")
    '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>',                                     # an external entity
    '<!doctype x [<!entity e "v">]>',                                                                   # the same in lower case
])
def test_an_odt_whose_xml_declares_entities_is_refused(parser, tmp_path, bomb):
    f = tmp_path / "bomb.odt"
    xml = (bomb + '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
           'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
           '<text:p>&a;</text:p></office:text></office:body></office:document-content>')
    with zipfile.ZipFile(f, "w") as zf:
        zf.writestr("content.xml", xml)
    with pytest.raises(Exception, match="entities"):
        parser.extract_text_from_odt(str(f))


def test_html_is_extracted_without_scripts_or_tags(parser, tmp_path):
    f = tmp_path / "cv.html"
    f.write_text(f"<html><head><style>p{{color:red}}</style><script>alert(1)</script></head>"
                 f"<body><h1>Jane Smith</h1><p>{BODY}</p></body></html>")
    text = _process(parser, f)["raw_text"]
    assert "FastAPI" in text and "alert" not in text and "<" not in text and "color:red" not in text


def test_docx_saved_with_a_doc_extension_is_still_read(parser, tmp_path):
    f = tmp_path / "cv.doc"
    d = docx.Document()
    d.add_paragraph(BODY)
    d.save(str(f))                       # a zip container under a .doc name
    assert "FastAPI" in _process(parser, f)["raw_text"]


def test_genuine_legacy_doc_is_read_with_antiword(parser, tmp_path):
    f = tmp_path / "cv.doc"
    f.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64)     # OLE2 header
    done = SimpleNamespace(returncode=0, stdout=BODY.encode(), stderr=b"")
    with patch("app.ingestion.cv_parser.subprocess.run", return_value=done) as run:
        assert "FastAPI" in _process(parser, f)["raw_text"]
    assert run.call_args.args[0][0] == "antiword"


def test_legacy_doc_without_antiword_gives_a_clear_error(parser, tmp_path):
    f = tmp_path / "cv.doc"
    f.write_bytes(b"\xd0\xcf\x11\xe0" + b"\x00" * 64)
    with patch("app.ingestion.cv_parser.subprocess.run", side_effect=FileNotFoundError):
        with pytest.raises(Exception, match="antiword"):
            _process(parser, f)


def test_all_listed_formats_are_accepted_by_the_upload_route():
    from app.api.routers.cvs import SUPPORTED_EXTENSIONS

    assert {".doc", ".rtf", ".odt", ".html", ".htm", ".pdf", ".docx", ".txt"} <= set(SUPPORTED_EXTENSIONS)


# ---------------------------------------------------------------- preview rendering
def test_preview_page_is_a_png_and_long_text_paginates():
    long_text = "\n".join(f"Line {i}: experience with distributed systems and cloud platforms" for i in range(400))
    png, total = render_page_png(long_text, 1)
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and total > 1
    assert page_count(long_text) == total
    last, _ = render_page_png(long_text, total)
    assert last != png                                    # different page, different pixels


def test_preview_page_number_is_clamped_and_short_text_is_one_page():
    png, total = render_page_png("Short CV", 99)
    assert total == 1 and png[:4] == b"\x89PNG"


# ---------------------------------------------------------------- endpoint
@pytest.fixture
def client(mock_user):
    app.dependency_overrides[require_core_app] = lambda: mock_user
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_preview_endpoint_returns_png_with_page_count(client):
    from app.store import get_store

    cid = get_store().save_candidate({"id": "00000000-0000-0000-0000-000000000001", "content_sha256": "a" * 64, "filename": "cv.doc",
                                      "raw_text": BODY * 80, "facts": {"full_name": "Sam"}})
    resp = client.get(f"/api/cv/{cid}/preview?page=1")
    assert resp.status_code == 200 and resp.headers["content-type"] == "image/png"
    assert int(resp.headers["X-Preview-Pages"]) >= 1 and resp.content[:4] == b"\x89PNG"


def test_preview_endpoint_404s_for_unknown_cv(client):
    assert client.get("/api/cv/missing/preview").status_code == 404
