"""The "We are hiring" picture for a job, drawn with Pillow from a fixed template. No model and no network are involved: the same
title and city always give the same picture, in about a tenth of a second.

Layout (a 1080 x 1080 square, drawn at twice that size and scaled down so every edge is smooth): a blue slanted panel on the left with
"Join our Team" in white brush script, a white speech bubble reading "WE ARE HIRING", the role (and its city) in brand blue on the
right, and the Alpha Data Recruitment logo at the bottom. The fonts (Roboto Slab, Kaushan Script) and the logo are bundled in
``app/assets/hiring_image``; their licences sit next to them.
"""
from __future__ import annotations

import io
import re
from functools import lru_cache
from pathlib import Path
from typing import List, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "hiring_image"
TEMPLATE_VERSION = 1                       # bump when the design changes so cached pictures are redrawn

SIZE = 1080                                # the delivered picture
SS = 2                                     # drawn at SIZE * SS, then scaled down
REF = 1024.0                               # the layout below is written for a 1024 square and scaled to SIZE
PAPER = (247, 247, 247)
BLUE = (30, 67, 152)
INK = (20, 78, 140)                        # the role line
DARK = (24, 24, 27)                        # "WE ARE HIRING"

MAX_TITLE_CHARS = 110


def _k(v: float) -> int:
    return round(v * SIZE * SS / REF)


def _pt(x: float, y: float) -> Tuple[int, int]:
    return _k(x), _k(y)


def _slab(weight: int, px: float) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(ASSETS / "RobotoSlab-Variable.ttf"), _k(px))
    try:
        font.set_variation_by_axes([weight])
    except Exception:  # noqa: BLE001 - a build without variable-font support still draws, in the default weight
        pass
    return font


def _script(px: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(ASSETS / "KaushanScript-Regular.ttf"), _k(px))


def _fit(draw: ImageDraw.ImageDraw, text: str, make_font, target_w: float, start: float, floor: float = 10.0) -> ImageFont.FreeTypeFont:
    """The largest font (down to ``floor``) whose ``text`` is no wider than ``target_w`` reference units."""
    size = start
    while size > floor:
        font = make_font(size)
        if draw.textlength(text, font=font) <= _k(target_w):
            return font
        size -= 2
    return make_font(floor)


def _printable(text: str) -> str:
    """Keep what the bundled fonts can draw (Latin, Greek, Cyrillic, common punctuation and currency). Anything else would print as a box."""
    keep = []
    for ch in text:
        o = ord(ch)
        if ch in "\r\n\t":
            keep.append(" ")
        elif 0x20 <= o < 0x250 or 0x370 <= o <= 0x4FF or 0x2010 <= o <= 0x2027 or 0x20A0 <= o <= 0x20CF:
            keep.append(ch)
    return re.sub(r"\s+", " ", "".join(keep)).strip()


def role_line(title: str, location: str = "") -> str:
    """"Senior Network & Security Engineer - Sharjah": the title, and the first part of the location when there is one."""
    role = _printable(title)[:MAX_TITLE_CHARS].strip() or "New Opportunity"
    city = _printable((location or "").split(",")[0]).strip()
    return f"{role} - {city}" if city and city.lower() not in role.lower() else role


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: float) -> List[str]:
    lines: List[str] = []
    line = ""
    for word in text.split(" "):
        trial = f"{line} {word}".strip()
        if line and draw.textlength(trial, font=font) > _k(width):
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def _text_layer(size: Tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", size, (0, 0, 0, 0))


def _rotate_onto(base: Image.Image, layer: Image.Image, degrees: float, centre: Tuple[int, int]) -> None:
    turned = layer.rotate(degrees, resample=Image.BICUBIC, center=centre)
    base.alpha_composite(turned)


def render(title: str, location: str = "") -> bytes:
    """The JPEG bytes of the hiring picture for this role."""
    s = SIZE * SS
    img = Image.new("RGBA", (s, s), PAPER + (255,))
    d = ImageDraw.Draw(img)

    # ---- the blue panel
    d.polygon([_pt(0, 0), _pt(580, 0), _pt(405, 1024), _pt(0, 1024)], fill=BLUE + (255,))

    # ---- "Join our Team": white brush script, slightly tilted
    script = _text_layer((s, s))
    sd = ImageDraw.Draw(script)
    for text, target_w, cx, top, start in (("Join", 310, 235, 372, 230), ("our", 125, 290, 548, 130), ("Team", 280, 262, 640, 200)):
        font = _fit(sd, text, _script, target_w, start)
        w = sd.textlength(text, font=font)
        sd.text((_k(cx) - w / 2, _k(top)), text, font=font, fill=(255, 255, 255, 255))
    _rotate_onto(img, script, 5, _pt(250, 560))

    # ---- the speech bubble: a soft shadow, the white shape, then the words
    bubble = [_pt(447, 98), _pt(866, 60), _pt(842, 298), _pt(582, 318), _pt(574, 374), _pt(512, 322), _pt(388, 318)]
    shadow = _text_layer((s, s))
    ImageDraw.Draw(shadow).polygon([(x + _k(5), y + _k(9)) for x, y in bubble], fill=(0, 0, 0, 70))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(_k(9))))
    ImageDraw.Draw(img).polygon(bubble, fill=(255, 255, 255, 255))
    # a faint edge so the white bubble reads against the white paper
    ImageDraw.Draw(img).line(bubble + [bubble[0]], fill=(224, 224, 228, 255), width=max(2, _k(1.5)), joint="curve")

    words = _text_layer((s, s))
    wd = ImageDraw.Draw(words)
    we = _fit(wd, "WE ARE", lambda p: _slab(600, p), 232, 80)
    hiring = _fit(wd, "HIRING", lambda p: _slab(900, p), 392, 160)
    we_w = wd.textlength("WE ARE", font=we)
    hi_w = wd.textlength("HIRING", font=hiring)
    wd.text((_k(715) - we_w / 2, _k(102)), "WE ARE", font=we, fill=DARK + (255,))
    wd.text((_k(642) - hi_w / 2, _k(150)), "HIRING", font=hiring, fill=DARK + (255,))
    _rotate_onto(img, words, 4, _pt(650, 190))

    # ---- the role, in brand blue, wrapped to fit the white area beside the panel
    d = ImageDraw.Draw(img)
    line = role_line(title, location)
    width = 470
    chosen: List[str] = []
    font = _slab(500, 40)
    for size in range(58, 21, -2):      # a short role is set large, a long one is wrapped and shrunk until it fits
        font = _slab(500, size)
        chosen = _wrap(d, line, font, width)
        if len(chosen) <= 4 and all(d.textlength(t, font=font) <= _k(width) for t in chosen):
            break
    y = 438
    for t in chosen:
        d.text((_k(520), _k(y)), t, font=font, fill=INK + (255,))
        y += font.size / s * REF * 1.3

    # ---- the logo
    logo = Image.open(ASSETS / "alpha-data-logo.png").convert("RGBA")
    lw = _k(332)
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    img.alpha_composite(logo, (_k(672), _k(900)))

    out = img.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=93, optimize=True, progressive=True, subsampling=0)
    return buf.getvalue()


@lru_cache(maxsize=256)
def _cached(title: str, location: str, version: int) -> bytes:
    return render(title, location)


def hiring_image(title: str, location: str = "") -> bytes:
    """``render``, remembered for the process: the same role is asked for again each time the page is opened."""
    return _cached(title or "", location or "", TEMPLATE_VERSION)


def file_name(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", _printable(title).lower()).strip("-")[:60] or "job"
    return f"hiring-{slug}.jpg"
