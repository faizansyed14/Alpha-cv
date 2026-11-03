"""Page previews drawn from a CV's extracted text, for formats a browser cannot show itself.

PDF, images and DOCX keep their native viewers. Legacy Word (.doc), RTF, ODT, HTML and plain text are drawn here as
A4-style PNG pages, the same approach the Al-ain RAG viewer uses for Office formats. Pages are laid out lazily: only the
requested page is rasterised, so previewing a long document costs one page, not all of them.
"""

from __future__ import annotations

import io
import textwrap
from pathlib import Path
from typing import Any, List, Tuple

from PIL import Image, ImageDraw, ImageFont


_FONT_DIRS = (
    Path("/usr/share/fonts/truetype/dejavu"),
    Path("/usr/share/fonts/dejavu"),
    Path("/usr/share/fonts/truetype/liberation"),
    Path("C:/Windows/Fonts"),
)
_PAGE_W, _PAGE_H = 874, 1240          # A4 at ~96 dpi
_MARGIN = 56


def _font(size: int, bold: bool = False) -> Any:
    names = ("DejaVuSans-Bold.ttf", "arialbd.ttf") if bold else ("DejaVuSans.ttf", "arial.ttf")
    for root in _FONT_DIRS:
        for name in names:
            path = root / name
            if path.is_file():
                try:
                    return ImageFont.truetype(str(path), size)
                except OSError:
                    continue
    return ImageFont.load_default()


def _layout(text: str, font: Any, max_w: int, scale: float) -> List[Tuple[str, bool]]:
    """Wrap text to the page width. Returns (line, is_heading) pairs; blank lines are kept as paragraph gaps."""
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    sample = probe.textbbox((0, 0), "ABCDEFGHIJ", font=font)
    avg = max((sample[2] - sample[0]) / 10, 4)
    width_chars = max(20, int(max_w / avg))
    out: List[Tuple[str, bool]] = []
    for paragraph in (text or "").splitlines() or [""]:
        heading = paragraph.startswith("#")
        body = paragraph.lstrip("#").strip() if heading else paragraph.rstrip()
        if not body.strip():
            out.append(("", False))
            continue
        for line in textwrap.wrap(body, width=width_chars, replace_whitespace=False, drop_whitespace=True) or [""]:
            out.append((line, heading))
    return out


def _lines_per_page(scale: float) -> int:
    return max(10, int((_PAGE_H * scale - 2 * _MARGIN * scale) // (19 * scale)))


def page_count(text: str, scale: float = 1.0) -> int:
    lines = _layout(text, _font(int(13 * scale)), int((_PAGE_W - 2 * _MARGIN) * scale), scale)
    return max(1, -(-len(lines) // _lines_per_page(scale)))


def render_page_png(text: str, page: int = 1, *, label: str = "", scale: float = 1.0) -> Tuple[bytes, int]:
    """Draw page ``page`` (1-based) of ``text``. Returns (png bytes, total pages)."""
    scale = max(0.5, min(float(scale), 3.0))
    body_font, head_font, small = _font(int(13 * scale)), _font(int(15 * scale), bold=True), _font(int(11 * scale))
    margin = int(_MARGIN * scale)
    lines = _layout(text, body_font, int((_PAGE_W - 2 * _MARGIN) * scale), scale)
    per_page = _lines_per_page(scale)
    total = max(1, -(-len(lines) // per_page))
    page = max(1, min(page, total))

    image = Image.new("RGB", (int(_PAGE_W * scale), int(_PAGE_H * scale)), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, image.width - 1, image.height - 1), outline=(220, 220, 216))
    y = margin
    if label:
        draw.text((margin, y - int(26 * scale)), label[:90], fill=(110, 110, 105), font=small)
    step = int(19 * scale)
    for line, heading in lines[(page - 1) * per_page: page * per_page]:
        if line:
            draw.text((margin, y), line, fill=(15, 15, 14) if heading else (28, 28, 26),
                      font=head_font if heading else body_font)
        y += step
    draw.text((image.width - margin - int(60 * scale), image.height - int(28 * scale)),
              f"{page} / {total}", fill=(140, 140, 135), font=small)
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), total
