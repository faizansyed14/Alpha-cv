"""OCR CV test: render a CV as an image, run it through the real parsing
service OCR path, and confirm the text (incl. contact details) is extracted.

Requires the tesseract binary (installed in the backend Docker image).
Run:  cd alpha-backend && PYTHONPATH=. python3 tests/test_ocr_cv.py
"""
import os
import sys
import tempfile

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("OPENAI_API_KEY", "stub")

from PIL import Image, ImageDraw, ImageFont

from app.services.ai.parsing_service import get_parsing_service

CV_LINES = [
    "Jane Smith",
    "Senior Python Developer",
    "Email: jane.smith@example.com",
    "Phone: +971 50 123 4567",
    "",
    "SKILLS",
    "Python, FastAPI, PostgreSQL, Docker, Redis, AWS",
    "",
    "EXPERIENCE",
    "7 years building backend REST services and microservices.",
]


def render_cv_image(path: str) -> None:
    img = Image.new("RGB", (900, 500), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    y = 24
    for line in CV_LINES:
        draw.text((30, y), line, fill="black", font=font)
        y += 38
    img.save(path)


def main() -> int:
    failures = []

    def check(name, cond, extra=""):
        print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
        if not cond:
            failures.append(name)

    parsing = get_parsing_service()

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img_path = tmp.name
    render_cv_image(img_path)

    try:
        # 1. Direct OCR extraction
        text = parsing.extract_with_ocr(img_path)
        check("ocr returns text", bool(text and text.strip()), f"chars={len(text)}")
        low = text.lower()
        check("ocr captured candidate name", "jane" in low and "smith" in low)
        check("ocr captured email", "jane.smith@example.com" in low.replace(" ", ""))
        check("ocr captured skills", "python" in low and "fastapi" in low)

        # 2. Full document pipeline (process_document → clean_text + PII)
        parsed = parsing.process_document(img_path, "cv")
        clean = (parsed.get("clean_text") or "").lower()
        check("process_document extracted text", len(clean) > 40, f"chars={len(clean)}")
        pii = parsed.get("extracted_pii", {})
        emails = [e.lower() for e in (pii.get("email") or [])]
        check("PII email extracted", any("jane.smith@example.com" in e for e in emails),
              f"emails={emails}")
    finally:
        try:
            os.unlink(img_path)
        except OSError:
            pass

    print()
    if failures:
        print(f"❌ {len(failures)} OCR checks failed: {failures}")
        return 1
    print("✅ All OCR CV checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
