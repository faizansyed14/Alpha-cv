# db/ — database initialization & maintenance

| File | Purpose |
|------|---------|
| `init/01-create-databases.sh` | Runs automatically inside the Postgres container on **first** init (mounted at `/docker-entrypoint-initdb.d`). Creates `auth_db` alongside the default `cv_database`. |
| `init_qdrant.py` | Standalone tool to create/repair the Qdrant collections. The backend also auto-creates them at startup, so this is only needed for manual repair. |
| `reset_data.sh` | **Dangerous, interactive.** Wipes application data (Qdrant collections, tracker/email tables, Redis) while keeping auth users. Never deletes docker volumes. Usage: `./db/reset_data.sh dev\|prod` |

Notes:

- Postgres only runs `init/` scripts when its data volume is empty (first boot).
  For an existing deployment, create `auth_db` manually:
  `docker compose -f docker-compose.prod.yml exec postgres psql -U cv_user -d cv_database -c 'CREATE DATABASE auth_db'`
- Relational schema (users, tracker, email tables) is created by the backend at
  startup via SQLModel `create_all` + best-effort migrations.
