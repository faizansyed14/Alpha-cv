"""Advanced CV search — the modal on the database page (keywords, experience
range, location, nationality), searching the whole cv_structured collection
server-side with cursor-based pagination for infinite scroll.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class CVAdvancedSearchRequest(BaseModel):
    keywords: Optional[List[str]] = Field(
        None, max_length=50, description="ANY-match against each CV's LLM-extracted keywords"
    )
    experience_min: Optional[float] = Field(None, ge=0, description="Minimum years of experience")
    experience_max: Optional[float] = Field(None, ge=0, description="Maximum years of experience")
    locations: Optional[List[str]] = Field(None, max_length=50, description="ANY-match against candidate location")
    nationalities: Optional[List[str]] = Field(None, max_length=50, description="ANY-match against candidate nationality")
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
    email: Optional[str] = None
    phone: Optional[str] = None
    is_job_application: bool = False
    applied_job_id: Optional[str] = None
    applied_job_title: Optional[str] = None
    match_score: Optional[float] = None


class CVAdvancedSearchResponse(BaseModel):
    results: List[CVSearchResultItem]
    next_cursor: Optional[str] = None
    count: int
