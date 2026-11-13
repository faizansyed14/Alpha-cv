"""Candidates, job descriptions, job postings and applications: the relational data of the ATS.

PostgreSQL is the single source of truth for everything a person reads or filters on. Qdrant keeps only the vectors (one
point per candidate / job description, see app/store/vectors.py), under the same id, so no fact is stored twice. Rules:

* one fact, one place. A person's name, e-mail and phone are on ``candidate`` only; an application points at the candidate
  instead of copying them. Whatever the person typed on the job page replaces what was read from the CV, in the same columns.
* a candidate is one row: its skills, responsibilities, keywords, languages and certifications are array columns of that row
  (the id is stored once, not once per item). Skills and responsibilities keep their order: item n is vector n in Qdrant.
  The arrays are real columns (text[] in PostgreSQL), filterable with an index, never JSON blobs.
* the foreign keys cascade, so removing a candidate removes its notes, search text and applications together.
* a job posting is the public wrapper of a job description (one description can have several postings); the description is not
  copied into it, and the posting keeps its own text for what was edited on the job page.
* ``candidate_search`` is the one derived table: the normalised text the search box matches against, rebuilt from the
  rows above whenever they change (it is an index, not a second copy to keep in step by hand).
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (JSON, BigInteger, Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger,
                        String, Text, func, text)
from sqlalchemy.dialects.postgresql import ARRAY, TSVECTOR
from sqlmodel import Field, SQLModel


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


def _ts(**kw):
    return Column(DateTime(timezone=False), **kw)


def _list():
    """An ordered list of text values in one column: text[] in PostgreSQL (JSON in the SQLite used by the tests)."""
    return Column(ARRAY(Text).with_variant(JSON(), "sqlite"), nullable=False)


def _fk(table: str, **kw):
    return Column(String(36), ForeignKey(f"{table}.id", ondelete="CASCADE"), **kw)


SOURCES = ("upload", "website", "email")
APPLICATION_STATUSES = ("pending", "reviewed", "shortlisted", "interview", "offered", "rejected", "hired", "withdrawn", "archived_job_deleted")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


# --------------------------------------------------------------------------------------------------------------------
# Candidates (CVs)
# --------------------------------------------------------------------------------------------------------------------
class Candidate(SQLModel, table=True):
    """One CV / person, with its lists (skills, responsibilities, keywords, languages, certifications) as array columns."""

    __tablename__ = "candidate"
    __table_args__ = (
        CheckConstraint(_in("source", SOURCES), name="ck_candidate_source"),
        CheckConstraint("years_of_experience IS NULL OR years_of_experience >= 0", name="ck_candidate_years"),
        Index("ix_candidate_uploaded_at", "uploaded_at", "id"),                                # the newest-first order every list and search pages by
        Index("ix_candidate_category_uploaded", "category", "uploaded_at", "id"),
        Index("ix_candidate_email_lower", text("lower(email)")),
        Index("ix_candidate_location", "location"),
        Index("ix_candidate_nationality", "nationality"),
        Index("ix_candidate_languages", "languages", postgresql_using="gin"),
        Index("ix_candidate_keywords", "keywords", postgresql_using="gin"),
    )

    id: str = Field(default_factory=_id, sa_column=Column(String(36), primary_key=True))

    # the file
    content_sha256: str = Field(sa_column=Column(String(64), nullable=False, unique=True))        # the same file is never stored twice
    original_filename: str = Field(sa_column=Column(String(512), nullable=False))
    file_format: Optional[str] = Field(default=None, sa_column=Column(String(16)))                # pdf | docx | txt | png ...
    mime_type: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    file_path: Optional[str] = Field(default=None, sa_column=Column(Text))                        # where the original lives in storage
    source: str = Field(default="upload", sa_column=Column(String(16), nullable=False, server_default="upload"))   # the door it first came through
    raw_text: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))  # the CV text with contact details masked (what the LLM saw)

    # who (what the applicant typed on the job page replaces what was read from the CV)
    full_name: Optional[str] = Field(default=None, sa_column=Column(String(256)))
    email: Optional[str] = Field(default=None, sa_column=Column(String(320)))
    phone: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    linkedin_url: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    github_url: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    gender: Optional[str] = Field(default=None, sa_column=Column(String(16)))
    location: Optional[str] = Field(default=None, sa_column=Column(String(256)))
    nationality: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    notice_period: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    expected_salary: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(12, 2)))

    # what they do
    job_title: Optional[str] = Field(default=None, sa_column=Column(String(256)))
    years_of_experience: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(4, 1)))
    category: str = Field(default="Other", sa_column=Column(String(96), nullable=False, server_default="Other"))

    # the lists, one array column each: skills[n] and responsibilities[n] are vector n in Qdrant (at most 20 and 10)
    skills: List[str] = Field(default_factory=list, sa_column=_list())
    responsibilities: List[str] = Field(default_factory=list, sa_column=_list())
    keywords: List[str] = Field(default_factory=list, sa_column=_list())
    languages: List[str] = Field(default_factory=list, sa_column=_list())
    certifications: List[str] = Field(default_factory=list, sa_column=_list())

    # bookkeeping
    uploaded_at: datetime = Field(default_factory=_now, sa_column=_ts(nullable=False, server_default=func.now()))
    llm_model: Optional[str] = Field(default=None, sa_column=Column(String(128)))               # the model that read the CV
    extraction_ms: Optional[int] = Field(default=None, sa_column=Column(Integer))
    embedding_model: Optional[str] = Field(default=None, sa_column=Column(String(128)))          # null until its vectors are in Qdrant
    embedded_at: Optional[datetime] = Field(default=None, sa_column=_ts())


class CandidateSearch(SQLModel, table=True):
    """The search index of a candidate (derived, see the module note): ``text`` is everything about the CV, ``literal`` only what the
    document itself says (no AI-written skills), ``location`` / ``nationality`` the place words; all as lower-case tokens joined by single spaces."""

    __tablename__ = "candidate_search"
    __table_args__ = (
        # PostgreSQL full-text indexes: a word or an exact phrase is found through the index, whatever the number of CVs
        Index("ix_candidate_search_literal_fts", "literal_tsv", postgresql_using="gin"),
        Index("ix_candidate_search_extra_fts", "extra_tsv", postgresql_using="gin"),
        Index("ix_candidate_search_location_fts", "location_tsv", postgresql_using="gin"),
        Index("ix_candidate_search_nationality_fts", "nationality_tsv", postgresql_using="gin"),
    )
    candidate_id: str = Field(sa_column=_fk("candidate", primary_key=True))
    text: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    literal: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    location: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    nationality: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    # PostgreSQL searches these tsvectors (literal_tsv and extra_tsv in the cv_english configuration: word forms are one word, no stop words;
    # location_tsv and nationality_tsv 'simple'), written with the row, and does not keep
    # ``text`` and ``literal`` at all (empty there, they are what SQLite searches):
    #   literal_tsv = the CV's own words,  extra_tsv = what the AI added (title, skills, keywords ...).  A plain word is found in either.
    extra_tsv: Optional[str] = Field(default=None, sa_column=Column(TSVECTOR().with_variant(Text(), "sqlite")))
    literal_tsv: Optional[str] = Field(default=None, sa_column=Column(TSVECTOR().with_variant(Text(), "sqlite")))
    location_tsv: Optional[str] = Field(default=None, sa_column=Column(TSVECTOR().with_variant(Text(), "sqlite")))
    nationality_tsv: Optional[str] = Field(default=None, sa_column=Column(TSVECTOR().with_variant(Text(), "sqlite")))


class CandidateNote(SQLModel, table=True):
    """A recruiter's private note on a candidate: one per recruiter."""

    __tablename__ = "candidate_note"
    candidate_id: str = Field(sa_column=_fk("candidate", primary_key=True))
    hr_user: str = Field(sa_column=Column(String(128), primary_key=True))
    note: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(default_factory=_now, sa_column=_ts(nullable=False, server_default=func.now()))
    updated_at: datetime = Field(default_factory=_now, sa_column=_ts(nullable=False, server_default=func.now()))


# --------------------------------------------------------------------------------------------------------------------
# Job descriptions
# --------------------------------------------------------------------------------------------------------------------
class JobDescription(SQLModel, table=True):
    """One job description (the thing candidates are matched against)."""

    __tablename__ = "job_description"
    __table_args__ = (
        CheckConstraint("years_required IS NULL OR years_required >= 0", name="ck_jd_years"),
        Index("ix_job_description_uploaded_at", "uploaded_at"),
        Index("ix_job_description_category", "category"),
    )

    id: str = Field(default_factory=_id, sa_column=Column(String(36), primary_key=True))
    original_filename: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    file_format: Optional[str] = Field(default=None, sa_column=Column(String(16)))
    mime_type: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    file_path: Optional[str] = Field(default=None, sa_column=Column(Text))
    raw_text: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    job_title: Optional[str] = Field(default=None, sa_column=Column(String(256)))
    years_required: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(4, 1)))
    category: str = Field(default="Other", sa_column=Column(String(96), nullable=False, server_default="Other"))
    boolean_search_string: Optional[str] = Field(default=None, sa_column=Column(Text))             # recruiter-style search for job portals
    skills: List[str] = Field(default_factory=list, sa_column=_list())                            # skills[n] / responsibilities[n] are vector n in Qdrant
    responsibilities: List[str] = Field(default_factory=list, sa_column=_list())
    uploaded_at: datetime = Field(default_factory=_now, sa_column=_ts(nullable=False, server_default=func.now()))
    llm_model: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    embedding_model: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    embedded_at: Optional[datetime] = Field(default=None, sa_column=_ts())
    deleted_at: Optional[datetime] = Field(default=None, sa_column=_ts())                         # set when its posting is deleted
    deleted_by: Optional[str] = Field(default=None, sa_column=Column(String(128)))


class JobRequirement(SQLModel, table=True):
    """A language or certification the job asks for (see app/matching/requirements.py). ``mandatory`` false = preferred."""

    __tablename__ = "job_requirement"
    __table_args__ = (CheckConstraint("kind IN ('language', 'certification')", name="ck_job_requirement_kind"),)
    job_description_id: str = Field(sa_column=_fk("job_description", primary_key=True))
    kind: str = Field(sa_column=Column(String(16), primary_key=True))
    name: str = Field(sa_column=Column(String(256), primary_key=True))
    mandatory: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default=text("true")))


# --------------------------------------------------------------------------------------------------------------------
# Careers: public job postings and the applications to them
# --------------------------------------------------------------------------------------------------------------------
class JobPosting(SQLModel, table=True):
    """The public face of a job description: the link candidates open, who posted it, and whether it is open."""

    __tablename__ = "job_posting"
    __table_args__ = (
        Index("ix_job_posting_active_created", "is_active", "created_at"),
        Index("ix_job_posting_posted_by", "posted_by_user"),
    )

    id: str = Field(default_factory=_id, sa_column=Column(String(36), primary_key=True))
    job_description_id: Optional[str] = Field(
        default=None, sa_column=Column(String(36), ForeignKey("job_description.id", ondelete="SET NULL"), index=True))
    public_token: str = Field(sa_column=Column(String(128), nullable=False, unique=True))
    is_active: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default=text("true")))
    posted_by_user: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    posted_by_role: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    # what candidates read on the public page, when it differs from the description (edited on the job page)
    display_title: Optional[str] = Field(default=None, sa_column=Column(String(256)))
    job_location: Optional[str] = Field(default=None, sa_column=Column(String(256)))
    job_summary: Optional[str] = Field(default=None, sa_column=Column(Text))
    key_responsibilities: Optional[str] = Field(default=None, sa_column=Column(Text))
    qualifications: Optional[str] = Field(default=None, sa_column=Column(Text))
    boolean_search_string: Optional[str] = Field(default=None, sa_column=Column(Text))             # when it differs from the description's
    # the subject line applicants use when they apply by e-mail
    email_subject_id: Optional[str] = Field(default=None, sa_column=Column(String(64), unique=True))
    email_subject_template: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    created_at: datetime = Field(default_factory=_now, sa_column=_ts(nullable=False, server_default=func.now()))
    updated_at: Optional[datetime] = Field(default=None, sa_column=_ts())
    deleted_at: Optional[datetime] = Field(default=None, sa_column=_ts())
    deleted_by: Optional[str] = Field(default=None, sa_column=Column(String(128)))


class JobApplication(SQLModel, table=True):
    """A candidate applying to a job posting (one application per pair). The person's own details stay on ``candidate``; this is only what is
    about the application."""

    __tablename__ = "job_application"
    __table_args__ = (
        CheckConstraint(_in("status", APPLICATION_STATUSES), name="ck_job_application_status"),
        CheckConstraint(_in("source", SOURCES), name="ck_job_application_source"),
        Index("ix_job_application_applied_at", "applied_at"),
        Index("ix_job_application_candidate", "candidate_id"),
    )

    job_posting_id: str = Field(sa_column=_fk("job_posting", primary_key=True))
    candidate_id: str = Field(sa_column=_fk("candidate", primary_key=True))
    source: str = Field(default="website", sa_column=Column(String(16), nullable=False, server_default="website"))   # which door this application came through
    status: str = Field(default="pending", sa_column=Column(String(24), nullable=False, server_default="pending"))
    applied_at: datetime = Field(default_factory=_now, sa_column=_ts(nullable=False, server_default=func.now()))


class EmailSubjectCounter(SQLModel, table=True):
    """Running number per job-title abbreviation and year, for the e-mail subject ids (incremented atomically)."""

    __tablename__ = "email_subject_counter"
    abbreviation: str = Field(sa_column=Column(String(16), primary_key=True))
    year: int = Field(sa_column=Column(SmallInteger, primary_key=True))
    counter: int = Field(default=0, sa_column=Column(BigInteger, nullable=False, server_default="0"))
