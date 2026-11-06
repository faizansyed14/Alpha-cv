from sqlmodel import SQLModel


class TrackerSQLModel(SQLModel):
    """Base class for Candidate Tracker tables. They live in the application's single database and share its metadata."""

    __abstract__ = True


# Kept as a name for code that imports it; there is one metadata for the whole database.
tracker_metadata = SQLModel.metadata
