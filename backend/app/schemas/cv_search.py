"""Advanced CV search, the modal on the database page (keywords, experience
range, location, nationality), searching the whole cv_structured collection
server-side with cursor-based pagination for infinite scroll. Matching rules:
QdrantUtils.search_cvs_advanced.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class CVAdvancedSearchRequest(BaseModel):
    keywords: Optional[List[str]] = Field(
        None, max_length=50, description="Words or phrases searched across the whole CV, ignoring case"
    )
    match_all: bool = Field(True, description="True: every keyword must match. False: any keyword, best matches first")
    experience_min: Optional[float] = Field(None, ge=0, description="Minimum years of experience")
    experience_max: Optional[float] = Field(None, ge=0, description="Maximum years of experience")
    locations: Optional[List[str]] = Field(None, max_length=50, description="Any of these locations (matched by words)")
    nationalities: Optional[List[str]] = Field(None, max_length=50, description="Any of these nationalities (matched by words)")
    languages: Optional[List[str]] = Field(None, max_length=50, description="Any of these languages (exact match on CV languages)")
    boolean_query: Optional[str] = Field(
        None, max_length=4000,
        description='A pasted boolean string, e.g. ("Cloud Engineer") AND ("Azure" OR "AWS") NOT intern. Narrows with the other filters.'
    )
    added_within_days: Optional[int] = Field(None, ge=1, le=3650, description="Freshness: only CVs added to the system in the last N days")
    added_from: Optional[str] = Field(None, max_length=10, description="Freshness: added on or after this date (YYYY-MM-DD)")
    added_to: Optional[str] = Field(None, max_length=10, description="Freshness: added on or before this date (YYYY-MM-DD)")
    limit: int = Field(50, ge=1, le=100, description="Page size (max 100)")
    cursor: Optional[str] = Field(None, description="Opaque pagination cursor from the previous response's next_cursor")


class CVSearchResultItem(BaseModel):
    id: str
    filename: str
    upload_date: str
    full_name: str
    job_title: str
    years_of_experience: object = None
    category: Optional[str] = None
    skills: List[str] = []
    skill_keywords: List[str] = []
    location: Optional[str] = None
    nationality: Optional[str] = None
    notice_period: Optional[str] = None
    gender: Optional[str] = None
    languages: List[str] = []
    certifications: List[str] = []
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    is_job_application: bool = False
    applied_job_id: Optional[str] = None
    applied_job_title: Optional[str] = None
    match_score: Optional[float] = None
    matched_keywords: List[str] = []


class CVAdvancedSearchResponse(BaseModel):
    results: List[CVSearchResultItem]
    next_cursor: Optional[str] = None
    count: int
    total: Optional[int] = Field(None, description="CVs matching the search (first page only)")
    total_is_estimate: bool = Field(False, description="True when a phrase keyword makes total an upper bound")
