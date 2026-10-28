#!/usr/bin/env python3
"""Rebuild alpha-backend/app/data/cities.json — the city/country autocomplete
dataset behind the careers apply form's "current location" field and the
resulting Location filter on the applicants/database pages.

Source: GeoNames' cities15000 dump (public domain / CC-BY 4.0,
https://www.geonames.org/ — credit: GeoNames). Free, no API key, no rate
limit; downloaded once here at build time, not called at runtime.

Curated down from "every populated place with population >= 15,000" to
"recognizable city/state names" using GeoNames' own feature codes
(https://www.geonames.org/export/codes.html):
  PPLC          country capital          -> always kept, any population
  PPLA..PPLA5   seat of an admin division -> always kept (already has
                                             official city/town status,
                                             e.g. Fujairah, Khobar's
                                             neighbours, Indian state
                                             capitals)
  PPL           generic populated place   -> kept ONLY above PPL_MIN_POPULATION,
                                             because this bucket mixes real
                                             standalone towns (Khobar, Jeddah)
                                             with large *districts inside* a
                                             bigger city that GeoNames also
                                             tags PPL (e.g. Bur Dubai, 18.7k)
  anything else (PPLX = "section of a      -> always dropped. PPLX is
  populated place", PPLL/PPLQ/PPLH/...)       GeoNames' own code for a
                                             neighbourhood/suburb (Dubai
                                             Marina, Dubai Investments Park,
                                             Dubai Silicon Oasis are all
                                             PPLX); the rest are rare
                                             edge-case codes not worth
                                             keeping for this use case.

Run:  python scripts/utils/build_cities_dataset.py
Re-run whenever you want to pick up GeoNames' latest population figures, or
after changing PPL_MIN_POPULATION below.
"""
import csv
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip"
COUNTRY_INFO_URL = "https://download.geonames.org/export/dump/countryInfo.txt"
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "alpha-backend" / "app" / "data" / "cities.json"

# See the module docstring above for why PPL (generic populated place) needs
# a much higher bar than PPLA/PPLC — this is the one knob you're likely to
# want to tune (raise it to trim the list further, lower it to include more
# mid-size towns).
PPL_MIN_POPULATION = 100_000


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return resp.read()


def main() -> None:
    print(f"Downloading {COUNTRY_INFO_URL} ...", file=sys.stderr)
    country_info_raw = _fetch(COUNTRY_INFO_URL).decode("utf-8")
    countries = {}
    for line in country_info_raw.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        cols = line.split("\t")
        countries[cols[0]] = cols[4]

    print(f"Downloading {CITIES_URL} ...", file=sys.stderr)
    zip_bytes = _fetch(CITIES_URL)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        cities_raw = zf.read("cities15000.txt").decode("utf-8")

    rows = []
    reader = csv.reader(io.StringIO(cities_raw), delimiter="\t")
    total = 0
    for cols in reader:
        total += 1
        name = cols[2] or cols[1]  # ascii name preferred
        feature_code = cols[7]
        country_code = cols[8]
        population = int(cols[14]) if cols[14] else 0

        if feature_code == "PPLC":
            pass
        elif feature_code.startswith("PPLA"):
            pass
        elif feature_code == "PPL":
            if population < PPL_MIN_POPULATION:
                continue
        else:
            continue

        rows.append({
            "city": name,
            "country": countries.get(country_code, country_code),
            "population": population,
        })

    # Sort by population desc so a naive top-N prefix search naturally
    # surfaces the better-known city first among same-prefix matches.
    rows.sort(key=lambda r: -r["population"])

    seen = set()
    out = []
    for r in rows:
        key = (r["city"].lower(), r["country"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Kept {len(out)} of {total} raw GeoNames rows -> {OUTPUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
