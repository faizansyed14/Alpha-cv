#!/usr/bin/env python3
"""One-off cleanup: strip the OLD per-JD match-score fields from cv_structured.

Before this change, every match run wrote a `match_scores` dict (one entry per
JD ever matched against that CV — grows forever) plus a top-level `match_score`
onto EVERY CV in the matched batch, not just the ones who actually applied to
that job. That top-level field could also be silently overwritten by an
unrelated exploratory match, so a CV's "current score" could reflect the wrong
job entirely.

Matching now writes a single flat `applied_job_match` field, and only for a
CV's own applied job (see app/utils/qdrant_utils.py
`store_applied_job_match_scores`). This script removes the old fields
(`match_scores`, `match_score`, `match_score_jd_id`) from every existing CV so
no stale/incorrect data lingers. It does NOT touch `applied_job_match` — CVs
just re-earn a fresh score the next time their job is matched.

Usage:
  python3 db/cleanup_stale_match_scores.py --dry-run     # report only
  python3 db/cleanup_stale_match_scores.py                # actually clean up
Env: QDRANT_HOST/QDRANT_PORT (default localhost:6333).
"""
import argparse
import os
import sys

from qdrant_client import QdrantClient

HOST = os.getenv("QDRANT_HOST", "localhost")
PORT = int(os.getenv("QDRANT_PORT", "6333"))
STALE_FIELDS = ("match_scores", "match_score", "match_score_jd_id")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing anything")
    args = parser.parse_args()

    client = QdrantClient(host=HOST, port=PORT, timeout=30)

    scanned = 0
    to_clean = 0
    offset = None
    ids_to_clean = []

    while True:
        points, next_offset = client.scroll(
            collection_name="cv_structured",
            limit=500,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        for p in points or []:
            scanned += 1
            payload = p.payload or {}
            if any(f in payload for f in STALE_FIELDS):
                to_clean += 1
                ids_to_clean.append(str(p.id))
        if not next_offset:
            break
        offset = next_offset

    print(f"Scanned {scanned} CVs; {to_clean} have stale match-score fields ({', '.join(STALE_FIELDS)}).")

    if args.dry_run:
        print("Dry run — nothing was changed. Re-run without --dry-run to clean up.")
        return 0

    if not ids_to_clean:
        print("Nothing to clean up.")
        return 0

    cleaned = 0
    for i in range(0, len(ids_to_clean), 200):
        batch = ids_to_clean[i : i + 200]
        try:
            client.delete_payload(
                collection_name="cv_structured",
                keys=list(STALE_FIELDS),
                points=batch,
            )
            cleaned += len(batch)
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  Failed to clean batch starting at {i}: {e}", file=sys.stderr)

    print(f"✅ Removed stale fields from {cleaned}/{to_clean} CVs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
