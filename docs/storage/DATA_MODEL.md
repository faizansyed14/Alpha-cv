# Data model

One rule: **Postgres holds every fact, Qdrant holds only vectors.** A fact lives in exactly one place.

## Postgres (schema owned by Alembic, `backend/migrations`, models in `backend/app/models/talent.py`)

Eight tables hold candidates, jobs and applications:

| Table | One row is | Notes |
|---|---|---|
| `candidate` | a person's CV (one per distinct file, found by `content_sha256`) | name, e-mail, phone, links, location, nationality, notice period, expected salary, job title, years, category, raw text, file path, which LLM and embedding model produced it. The five lists are **array columns of this row**: `skills`, `responsibilities`, `keywords`, `languages`, `certifications` (`text[]`) |
| `candidate_search` | the search index of a candidate (derived) | rebuilt on every save. PostgreSQL stores only full-text vectors (`literal_tsv` = the CV's own words, `extra_tsv` = what the AI added: title, skills, keywords, certifications, `location_tsv`, `nationality_tsv`), each with a GIN index; the plain `text` / `literal` columns are empty there. SQLite (tests) keeps the plain `text`, `literal`, `location`, `nationality` and searches them with LIKE |
| `candidate_note` | an HR user's note on a candidate | one per (candidate, user) |
| `job_description` | an uploaded or posted JD | title, years required, category, raw text, file path, and `skills` and `responsibilities` as array columns |
| `job_requirement` | a required language or certification of a JD | `kind` = language or certification, `mandatory` |
| `job_posting` | a public job page for a JD | its own id, public token, active flag, the text candidates read, boolean search string, e-mail subject id, soft delete; the JD link is `SET NULL` when a JD is deleted |
| `job_application` | a candidate applying to a posting | key = (posting, candidate); source, status, applied time |
| `email_subject_counter` | the next number for an e-mail subject prefix and year | updated atomically |

The app also keeps its users and AI agent conversations in the same database (a few more tables, not described here). Bug reports have their own table, `bug_report`: one row per report from the "Report a bug" page with the reporter, area, severity, status (`open`, `in_progress`, `resolved`, `closed`) and the admin's note; only the admin reads all of them, everyone else reads their own. The tracker has one set of five tables (`tracker_option`, `tracker_job_opening`, `tracker_candidate`, `tracker_application`, `tracker_follow_up`) for both teams: every row has a `team` (`dubai` or `abudhabi`), and a request only sees and changes its own team's rows.

What the applicant typed on the job page and what was read from the CV go into the **same columns** of `candidate`; the typed
value wins. The upload page and the job page both go through `ingest_cv` (`backend/app/ingestion/pipeline.py`), so a CV looks
the same whichever door it came in by. Applying twice to one job is refused; the same file applying to another job adds an
application row and does not add a second candidate.

Why arrays: a candidate's lists are always written and read together with the candidate, and the order of skills and
responsibilities matters (item `n` is vector `n` in Qdrant). One row with array columns stores the id once instead of once per
item, and matching reads a whole CV in one query. `languages` and `keywords` have GIN indexes for filters and facets
(`backend/app/store/arrays.py` holds the few queries that look inside an array).

Deleting a candidate removes its notes, search text and applications (foreign keys cascade) and its vector point.

Not stored on purpose: match scores (a match is computed when you run it), cover letters, company names.

## Many records: how the APIs behave

Every list and search is decided by the database over all rows and returns one page; nothing is filtered in the browser from rows it happened to load.

- `GET /api/cv/cvs` (list and search box): pages of at most 200, newest first; the search box matches whole words anywhere in the CV. A search counts its matches only up to 100,000 and says so (`total_is_estimate`), and the page is still reachable all the way through.
- `POST /api/cv/search/advanced`: keywords, boolean string, experience, location, nationality, language, category, notes, freshness. Cursor paging (`next_cursor`), at most 100 per call; the first page carries the total (capped as above). The Candidates page fetches the next page whenever the reader reaches the end of what is loaded, so every match can be reached.
- Facet lists (locations, nationalities, notice periods, languages, keywords) are cached for five minutes; on a table of more than 200,000 candidates the keyword and language lists are computed from a sample of about 100,000 rows (counts scaled).
- Job descriptions (`GET /api/jd/jds`), postings (`GET /api/careers/admin/jobs`, with `q`, `scope` and `status`) and the public openings (`GET /api/careers/jobs/open`, with `q`, `skills`, `region`, `areas`) are searched and paged by the database. Application lists are capped per call; a posting closes itself at 250 applications.
- The admin statistics and the weekly report are single aggregate queries; the statistics are cached for a minute.
- Indexes behind this: `(uploaded_at, id)` and `(category, uploaded_at, id)` on `candidate` for the newest-first order, GIN on `languages` and `keywords`, and GIN indexes on the four `candidate_search` full-text vectors for the word, phrase and boolean searches (job description titles and file names keep trigram GIN indexes). Storing the vectors only (not the text as well) makes the search table about a third of what it was; after migration 0013 run `VACUUM FULL candidate_search;` once to give the freed space back to the disk (it locks that table while it runs).

## Qdrant (`backend/app/store/vectors.py`)

Two collections, `candidate_vectors` and `job_description_vectors`. One point per CV or JD, whose id is the row's id, with **no payload**.
Named vectors: `skills` and `responsibilities` (multivectors, MAX_SIM, up to 20 and 10) and `title` (one): 31 vectors a document.
Years of experience are compared as numbers, so there is no experience vector.
Cosine distance, no HNSW graph (`m=0`: points are only ever read by id), vectors on disk, read over gRPC.
Matching reads many candidates' vectors in one request (`retrieve_embeddings_batch`) and everything else from Postgres.

## Code

`app.store.get_store()` is the one entry point: `CandidateStore`, `JobStore` and `StatsStore` (Postgres) plus `store.vectors` (Qdrant).
Tests run it on SQLite (the array columns become JSON there) and in-memory Qdrant (`backend/tests/conftest.py`). To run
`tests/test_store.py` on real PostgreSQL, set `TEST_STORE_PG_URL` to a **throwaway** database (its tables are dropped and recreated).

## Repair and reset

- `python scripts/db/init_qdrant.py` recreates missing collections (the backend also does this at startup).
- `python scripts/db/reembed.py` drops the two collections and rebuilds every vector from the rows (no LLM call, only the embedding model).
- `./scripts/db/reset_data.sh dev|prod` empties every data table except users and the migration history, and the Qdrant collections.
