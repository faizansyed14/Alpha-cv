# Backup and recovery

Two scripts, for all three stacks (`local`, `dev`, `prod`):

```bash
./scripts/backup.sh  prod [--keep 14] [--out DIR] [--include-env] [--skip postgres,qdrant,files]
./scripts/restore.sh prod BACKUP_DIR [--check] [--yes] [--only postgres,qdrant,files] [--no-safety-backup]
```

(`bash scripts/backup.sh prod` works too, if the files are not marked executable on your machine.)

## What is saved, and where each stack keeps it

| Data | local | dev / prod | In the backup |
|---|---|---|---|
| Database (users, candidates, job descriptions, postings, applications, bug reports, saved CVs) | `postgres-local` container | AWS RDS | `postgres.dump` (pg_dump custom format) |
| Vectors (what matching reads) | Qdrant volume | Qdrant volume | `qdrant/<collection>.snapshot`, taken while the app runs |
| Raw CV / JD files | `uploads-local-data` volume | S3 bucket | local: `files.tar.gz`. dev / prod: they stay in S3 (see below) |
| Redis (caches, one-time codes, the match queue) | volume | volume | not saved: a restart rebuilds it |
| Secrets (`.env.*`) | the env file | the env file | only with `--include-env`; otherwise keep them in your secret store |

A backup is one folder, `backups/<stack>/<UTC time>/`, with `manifest.txt` (schema version, row and point counts) and `SHA256SUMS`. Backing up only **reads** the running stack; it changes nothing in it. The folder is created private (mode 700) and `backups/` is git-ignored.

## Dev and prod: S3 and RDS

- **Files in S3.** Turn on **bucket versioning** (the safety net for overwritten or deleted CVs) and default encryption. `backup.sh` warns when versioning is off. For a second copy, set `BACKUP_S3_URI=s3://another-bucket/alphacv-backups` and the files are synced there on every backup (the AWS CLI must be installed, with access to both buckets). `restore.sh` copies them back from that location. A lifecycle rule on the versioned bucket keeps the cost down, for example:
  `aws s3api put-bucket-lifecycle-configuration --bucket BUCKET --lifecycle-configuration '{"Rules":[{"ID":"expire-old-versions","Status":"Enabled","Filter":{"Prefix":""},"NoncurrentVersionExpiration":{"NoncurrentDays":90}}]}'`
- **Database on RDS.** Keep RDS's own automated backups on (and Multi-AZ). `backup.sh` adds a logical dump you can restore into any Postgres. It reaches RDS with a throwaway `postgres:15` container and the address in `DATABASE_URL`, so the machine running it needs outbound access to RDS. If your RDS server is newer than 15, run with `PG_IMAGE=postgres:16` (pg_dump must be at least as new as the server).

## Schedule it (prod)

```cron
# every night at 02:10; keep the 14 newest
10 2 * * *  cd /opt/alpha-cv && ./scripts/backup.sh prod --keep 14 >> /var/log/alphacv-backup.log 2>&1
# then copy the folder OFF this machine (a backup on the same disk is not a backup)
40 2 * * *  aws s3 sync /opt/alpha-cv/backups/prod s3://YOUR-BACKUP-BUCKET/alphacv/prod --only-show-errors
```

## Recover

1. **Look first:** `./scripts/restore.sh prod backups/prod/20261110T021001Z --check` verifies every checksum and that the database dump is readable. It changes nothing.
2. **Restore:** `./scripts/restore.sh prod backups/prod/20261110T021001Z`. It asks you to type `RESTORE prod`, then:
   saves the CURRENT database first (`backups/prod/pre-restore-<time>/`), stops the app, replaces the database (one transaction: a failure leaves nothing half-restored) and each Qdrant collection, restores the files, starts the app again, and compares the row and point counts with the manifest. A mismatch makes it exit with an error.
3. A backup **older** than the code is fine: the app migrates it forward when it starts. A backup **newer** than the code is not: update the code first.
4. `--only postgres` (or `qdrant`, `files`) restores one part. A backup from one stack cannot be restored into another by this script.

**A lost server (prod):** install Docker, check out the code, put `.env.prod` back, `./scripts/start.sh prod`, then restore the newest backup. The database is on RDS and the files in S3, so only the vectors need the backup (or `./scripts/restore.sh prod DIR --only qdrant`; if no backup exists, rebuild them from the stored CVs with `python scripts/db/reembed.py`).

## Practise it

A backup nobody has restored is a hope. Before you rely on one, restore it into a copy: the same compose file under another project name (`COMPOSE_PROJECT_NAME`) or a spare machine. Both scripts accept `COMPOSE_FILE`, `ENV_FILE` and `BACKEND_SVC` in the environment to point at another stack. The scripts were exercised this way: a backup of the running local stack restored into an empty throwaway Postgres, Qdrant and uploads volume, with the dev-style (managed database) path checked against a database reached through a throwaway client, and a damaged backup and a wrong stack refused.

## Limits

- Qdrant snapshots pass through memory on import: fine for the current size (hundreds of MB); for several GB, restore by copying the Qdrant volume instead.
- The files of a local stack are restored by extraction: files that exist now but are not in the backup are left in place.
- `--include-env` puts secrets in the backup folder; treat that folder like the env file.
