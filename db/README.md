# db/ — database initialization & maintenance

| File | Purpose |
|------|---------|
| `init/rds-bootstrap.sql` | Manual one-time script for an AWS RDS instance: creates the application role and its grants. (The local Postgres container needs no init script: it creates the one database itself.) |
| `init_qdrant.py` | Standalone tool to create/repair the Qdrant collections. The backend also auto-creates them at startup, so this is only needed for manual repair. |
| `reset_data.sh` | **Dangerous, interactive.** Wipes application data (Qdrant collections, tracker/email tables, Redis) while keeping users and the migration history. Never deletes docker volumes. Usage: `./db/reset_data.sh dev\|prod` |

Notes:

- There is ONE relational database (users, tracker, AI agents). Its schema is owned by Alembic: a single
  migration history in `backend/migrations`, applied automatically at startup (`alembic upgrade head`).
  To change a table: edit the model in `backend/app/models`, then
  `cd backend && alembic revision --autogenerate -m "describe the change"` and commit the new file.
