"""
Careers Schemas - Public Job Postings & Applications
Pydantic models for the careers page functionality where:
- HR posts jobs and gets public links
- Public users view jobs and apply without authentication
- Applications are processed through existing CV pipeline
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, List


class JobPostingResponse(BaseModel):
    """Response model after successful job posting creation"""
    job_id: str = Field(..., description="Unique identifier for the job posting")
    public_link: str = Field(..., description="Public URL where candidates can view and apply")
    public_token: str = Field(..., description="Public token for the job posting")  # Add this line
    job_title: Optional[str] = Field(None, description="Extracted job title from the job description")
    upload_date: str = Field(..., description="ISO timestamp when job was posted")
    filename: str = Field(..., description="Original filename of uploaded job description")
    is_active: bool = Field(True, description="Whether the job posting is currently accepting applications")
    company_name: Optional[str] = Field(None, description="Company name associated with posting")
    posted_by_user: Optional[str] = Field(None, description="Username of the user who posted this job")
    posted_by_role: Optional[str] = Field(None, description="Role of the user who posted this job (admin/user)")
    # Email integration fields
    email_subject_id: Optional[str] = Field(None, description="Unique ID for email subject matching (e.g., SE-2025-001)")
    email_subject_template: Optional[str] = Field(None, description="Full email subject template for Naukri (e.g., 'Software Engineer | SE-2025-001')")
    boolean_search_string: Optional[str] = Field(None, description="Naukri Gulf boolean search string generated for this job")

class PublicJobView(BaseModel):
    """Public-facing model for job postings (no sensitive data)"""
    job_id: str = Field(..., description="Unique identifier for the job posting")
    job_title: Optional[str] = Field("Position Available", description="Job title or position name")
    job_location: Optional[str] = Field(None, description="Job location (city, country, remote, etc.)")
    company_name: Optional[str] = Field("Alpha Data Recruitment", description="Company name for branding")
    job_description: str = Field(..., description="Full job description text")
    upload_date: str = Field(..., description="When this job was posted")
    requirements: Optional[List[str]] = Field([], description="List of required skills and qualifications")
    responsibilities: Optional[List[str]] = Field([], description="List of job responsibilities and duties")
    experience_required: Optional[str] = Field("Not specified", description="Required years of experience")
    is_active: bool = Field(True, description="Whether the job is currently accepting applications")


class JobApplicationResponse(BaseModel):
    """Response model after application submission"""
    success: bool = Field(..., description="Whether the application was successfully submitted")
    application_id: str = Field(..., description="Unique identifier for this application")
    message: str = Field(..., description="Confirmation message for the applicant")
    next_steps: Optional[str] = Field(None, description="Information about what happens next")
    job_id: Optional[str] = Field(None, description="Background job ID for tracking (if async processing)")


class JobApplicationSummary(BaseModel):
    """Summary model for applications (for HR dashboard)"""
    application_id: str = Field(..., description="Unique application identifier")
    job_id: str = Field(..., description="Job this application is for")
    applicant_name: str = Field(..., description="Name of the applicant")
    applicant_email: str = Field(..., description="Email of the applicant")
    application_date: str = Field(..., description="When the application was submitted")
    cv_filename: str = Field(..., description="Original filename of submitted CV")
    expected_salary: Optional[float] = Field(None, description="Expected salary in AED")
    years_of_experience: Optional[float] = Field(None, description="Years of experience")
    location: Optional[str] = Field(None, description="Candidate's current location")
    notice_period: Optional[str] = Field(None, description="Candidate's notice period")
    nationality: Optional[str] = Field(None, description="Candidate's nationality")
    match_score: Optional[float] = Field(None, description="AI-calculated match score if available")
    status: str = Field("pending", description="Application status (pending, reviewed, etc.)")
    source: Optional[str] = Field(None, description="Application source: 'email_application' for Naukri/email, 'website' for direct applications")
    
    @validator('applicant_name', pre=True)
    def validate_applicant_name(cls, v):
        """Ensure applicant_name is never null/empty to prevent API failures"""
        if v is None or v == "" or str(v).strip() == "":
            return "Applicant"
        
        # Clean up common invalid values
        v_str = str(v).strip()
        if v_str.lower() in ["not specified", "unknown", "null", "none"]:
            return "Applicant"
        
        return v_str


class JobPostingSummary(BaseModel):
    """Summary model for job postings (for HR dashboard)"""
    job_id: str = Field(..., description="Unique job identifier")
    job_title: Optional[str] = Field(None, description="Job title")
    job_location: Optional[str] = Field(None, description="Job location")
    # NOTE: These fields are intentionally lightweight for list endpoints.
    # Full job text remains available via the public job view + edit-data endpoints.
    job_summary: Optional[str] = Field(None, description="Short job summary preview (not full JD text)")
    key_responsibilities: Optional[str] = Field(None, description="Short responsibilities preview")
    qualifications: Optional[str] = Field(None, description="Short qualifications preview")
    company_name: Optional[str] = Field(None, description="Company name")
    upload_date: str = Field(..., description="When job was posted")
    filename: str = Field(..., description="Original filename")
    is_active: bool = Field(..., description="Whether job is active")
    application_count: int = Field(0, description="Number of applications received")
    public_token: str = Field(..., description="Public access token for the job")
    posted_by_user: Optional[str] = Field(None, description="Username of the user who posted this job")
    posted_by_role: Optional[str] = Field(None, description="Role of the user who posted this job (admin/user)")
    can_edit: bool = Field(False, description="Whether current user can edit this job")
    can_delete: bool = Field(False, description="Whether current user can delete this job")
    # Email integration fields
    email_subject_id: Optional[str] = Field(None, description="Unique ID for email subject matching (e.g., SE-2025-001)")
    email_subject_template: Optional[str] = Field(None, description="Full email subject template for Naukri (e.g., 'Software Engineer | SE-2025-001')")
    # Naukri Gulf Boolean recruiter search string (LLM-generated from the JD)
    boolean_search_string: Optional[str] = Field(None, description="Recruiter Boolean search string for Naukri Gulf / job portals")


class JobStatusUpdate(BaseModel):
    """Request model for updating job posting status"""
    is_active: bool = Field(..., description="New active status for the job")
    reason: Optional[str] = Field(None, max_length=500, description="Reason for status change")
