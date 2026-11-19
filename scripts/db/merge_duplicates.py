#!/usr/bin/env python3
"""Find candidates that are the same person (same e-mail AND same phone) and, when asked, join each group into its newest CV.

Read app/services/duplicates.py for exactly what a merge does. By default this only REPORTS: nothing is changed.

    python scripts/db/merge_duplicates.py                       # report: every group, which candidate is kept, which would be removed
    python scripts/db/merge_duplicates.py --csv groups.csv      # the same report as a spreadsheet, to review
    python scripts/db/merge_duplicates.py --apply               # merge every group (take a backup first: ./scripts/backup.sh prod)
    python scripts/db/merge_duplicates.py --apply --limit 20    # merge only the first 20 groups (a careful first run)

Run it inside the backend container (it has the database and storage settings); the script is piped in, from the project folder:
    docker compose -f docker-compose.prod.yml exec -T backend python - < scripts/db/merge_duplicates.py
    docker compose -f docker-compose.prod.yml exec -T backend python - --apply --limit 20 < scripts/db/merge_duplicates.py
"""
import argparse
import csv
import os
import sys

if "__file__" in globals():                       # run from the project folder; when piped into the container, /app is the backend
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))
sys.path.insert(0, "/app")

from app.services.duplicates import find_groups, merge_group  # noqa: E402
from app.store import get_store  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="merge the groups (without it nothing is changed)")
    parser.add_argument("--limit", type=int, default=0, help="merge at most this many groups")
    parser.add_argument("--csv", help="write the report to this CSV file")
    args = parser.parse_args()

    store = get_store()
    groups = find_groups(store)
    extra = sum(len(g.others) for g in groups)
    print(f"{len(groups)} people have more than one candidate: {extra} candidates would be joined into the newest CV of each.")
    for g in groups:
        print(f"\n{g.email} / ...{g.phone_key}")
        print(f"  keep    {g.keep.id}  {g.keep.uploaded_at:%Y-%m-%d}  {g.keep.name or '-'}  ({g.keep.filename})")
        for m in g.others:
            print(f"  remove  {m.id}  {m.uploaded_at:%Y-%m-%d}  {m.name or '-'}  ({m.filename})")
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["email", "phone_last_9", "action", "candidate_id", "cv_date", "name", "file"])
            for g in groups:
                for action, m in [("keep", g.keep)] + [("remove", m) for m in g.others]:
                    w.writerow([g.email, g.phone_key, action, m.id, f"{m.uploaded_at:%Y-%m-%d}", m.name or "", m.filename])
        print(f"\nreport written to {args.csv}")

    if not args.apply:
        print("\nNothing was changed. Run again with --apply to merge (after a backup).")
        return
    todo = groups[: args.limit] if args.limit else groups
    done = failed = 0
    for g in todo:
        try:
            result = merge_group(store, g.keep.id, [m.id for m in g.others])
            done += 1
            print(f"merged {g.email}: kept {result['kept']}, removed {len(result['removed'])}, "
                  f"{result['applications_moved']} applications and {result['notes_moved']} notes moved")
        except Exception as exc:  # noqa: BLE001 - one failed group does not stop the others; its database part was rolled back
            failed += 1
            print(f"FAILED {g.email}: {exc}")
    print(f"\n{done} groups merged, {failed} failed.")


if __name__ == "__main__":
    main()
