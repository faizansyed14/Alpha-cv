#!/usr/bin/env python3
"""Retention cleanup: purge RAW data of old CVs while keeping searchable data.

For every CV older than --days (or CV_RETENTION_DAYS from the environment):
  - deletes the original file from storage (local dir or S3)
  - deletes the raw text payload in `cv_documents`
  - deletes the 32 vectors in `cv_embeddings`

It KEEPS, always:
  - `cv_structured` (name, title, skills, notes, application info,
    content_sha256 for email duplicate detection)
  - tracker / auth / email-processing data in Postgres

If a purged CV is matched again later, the matching service automatically
regenerates its embeddings from the structured data (built-in fallback), so
nothing breaks — old CVs just stop consuming file/vector storage.

Usage:
  python3 db/cleanup_old_cvs.py --days 365 --dry-run     # report only
  python3 db/cleanup_old_cvs.py --days 365               # actually purge
Env: QDRANT_HOST/QDRANT_PORT (default localhost:6333), LOCAL_STORAGE_DIR.
Run it from cron or manually, e.g. monthly.
"""
import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

from qdrant_client import QdrantClient
from qdrant_client.http.models import FieldCondition, Filter, MatchValue

HOST = os.getenv("QDRANT_HOST", "localhost")
PORT = int(os.getenv("QDRANT_PORT", "6333"))
STORAGE_DIR = os.getenv("LOCAL_STORAGE_DIR", "/data/uploads")


def parse_date(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def delete_local_file(cv_id: str) -> bool:
    cvs_dir = os.path.join(STORAGE_DIR, "cvs")
    if not os.path.isdir(cvs_dir):
        return False
    deleted = False
    for fname in os.listdir(cvs_dir):
        if fname.startswith(cv_id):
            os.remove(os.path.join(cvs_dir, fname))
            deleted = True
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=int(os.getenv("CV_RETENTION_DAYS", "0")),
                        help="purge raw data of CVs older than this many days")
    parser.add_argument("--dry-run", action="store_true", help="report what would be purged, change nothing")
    args = parser.parse_args()

    if args.days <= 0:
        print("Retention disabled (--days/CV_RETENTION_DAYS not set or 0). Nothing to do.")
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    client = QdrantClient(host=HOST, port=PORT, timeout=30)
    print(f"Purging raw data of CVs uploaded before {cutoff:%Y-%m-%d} "
          f"({'DRY RUN' if args.dry_run else 'LIVE'})")

    purged = scanned = 0
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name="cv_documents", limit=200, offset=offset,
            with_payload=True, with_vectors=False,
        )
        if not points:
            break
        for point in points:
            scanned += 1
            payload = point.payload or {}
            uploaded = parse_date(payload.get("upload_date") or payload.get("created_at"))
            if uploaded is None or uploaded >= cutoff:
                continue
            cv_id = str(point.id)
            has_raw = bool(payload.get("raw_content") or payload.get("raw_content_gzip") or payload.get("file_path"))
            print(f"  purge {cv_id}  uploaded={uploaded:%Y-%m-%d}  file={payload.get('filename', '?')}"
                  f"{'' if has_raw else '  (no raw data)'}")
            purged += 1
            if args.dry_run:
                continue

            # 1. original file (local storage; for S3 use lifecycle rules or aws cli)
            delete_local_file(cv_id)

            # 2. raw text: strip heavy payload fields but keep the document row
            #    (filename/upload_date remain so the UI still lists the CV).
            slim = {k: v for k, v in payload.items()
                    if k not in ("raw_content", "raw_content_gzip", "raw_content_b64")}
            slim["raw_purged_at"] = datetime.now(timezone.utc).isoformat()
            client.set_payload(collection_name="cv_documents", payload=slim, points=[point.id])
            for heavy in ("raw_content", "raw_content_gzip", "raw_content_b64"):
                try:
                    client.delete_payload(collection_name="cv_documents", keys=[heavy], points=[point.id])
                except Exception:
                    pass

            # 3. embeddings (regenerated on demand from cv_structured if needed)
            emb_points, _ = client.scroll(
                collection_name="cv_embeddings",
                scroll_filter=Filter(must=[FieldCondition(key="document_id", match=MatchValue(value=cv_id))]),
                limit=2000, with_payload=False, with_vectors=False,
            )
            ids = [p.id for p in emb_points]
            # newer storage layout: single point with id == cv_id
            try:
                direct = client.retrieve("cv_embeddings", ids=[cv_id], with_payload=False)
                ids.extend(p.id for p in direct)
            except Exception:
                pass
            if ids:
                client.delete(collection_name="cv_embeddings", points_selector=list(set(ids)))

        if offset is None:
            break

    print(f"\nScanned {scanned} CVs; {'would purge' if args.dry_run else 'purged'} {purged}.")
    print("Kept: cv_structured (searchable data, notes, dedup hashes), tracker/auth/email data.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
