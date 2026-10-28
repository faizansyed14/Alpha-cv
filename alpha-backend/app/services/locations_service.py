"""City/country autocomplete for the "current location" field on the public
careers apply form (and any future location filter).

Data comes from GeoNames' cities15000 dump (public domain / CC-BY 4.0 —
https://www.geonames.org/, credit: GeoNames), pre-processed at build time
into app/data/cities.json (~15k entries, <1MB). Deliberately curated down
to major cities/state-capitals rather than every populated place >=15,000:
kept are country capitals (feature code PPLC) and admin-division seats
(PPLA*) at any size, plus generic populated places (PPL) only above 100k
population. Dropped entirely: PPLX ("section of a populated place" — i.e.
GeoNames' own code for a neighbourhood/district, e.g. Dubai Marina, Dubai
Investments Park, Bur Dubai) and other rare/edge-case codes. This is what
keeps the list to recognizable city/state names instead of every district
within a city. See alpha-backend's build note for the exact script.

Loaded once into memory; no network calls, no API key, no rate limit — this
runs entirely locally so autocomplete works even with public visitors and
never depends on a third-party service being up.

Kept as a flat "city, country" list rather than a nested country->city tree
because the whole point is that whatever a candidate picks becomes the exact
string stored on their application, so it can be used as a clean, low-cardinality
filter value later (see FilterSidebar / ApplicationsList).
"""
import json
import logging
import os
import threading
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "cities.json")

_cities: List[Dict[str, Any]] = []
_lock = threading.Lock()
_loaded = False


def _ensure_loaded() -> None:
    global _cities, _loaded
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        try:
            with open(_DATA_PATH, "r", encoding="utf-8") as f:
                _cities = json.load(f)
            logger.info(f"✅ Loaded {len(_cities)} cities for location autocomplete")
        except Exception as e:
            logger.error(f"❌ Failed to load cities.json: {e}")
            _cities = []
        _loaded = True


def search_locations(query: str, limit: int = 10) -> List[Dict[str, str]]:
    """Return up to `limit` "City, Country" matches for `query`.

    Cities whose name starts with the query rank above cities that merely
    contain it; within each group, the (pre-sorted-by-population) input
    order is preserved so the better-known city of a same-prefix pair
    (e.g. "San" -> San Francisco before San Marino) shows first.
    """
    _ensure_loaded()
    q = (query or "").strip().lower()
    if len(q) < 2:
        return []

    starts_with: List[Dict[str, Any]] = []
    contains: List[Dict[str, Any]] = []
    for c in _cities:
        name = c["city"].lower()
        if name.startswith(q):
            starts_with.append(c)
        elif q in name:
            contains.append(c)
        if len(starts_with) >= limit:
            break

    results = (starts_with + contains)[:limit]
    return [{"city": c["city"], "country": c["country"], "label": f"{c['city']}, {c['country']}"} for c in results]
