"""
Helper functions and utilities for careers routes.
Extracted from careers_routes.py to improve code organization.
"""

import logging
import secrets
import re
import os
from datetime import datetime
from typing import Optional
from fastapi import UploadFile, HTTPException
from app.core.config import settings
from app.utils.qdrant_utils import get_qdrant_utils

logger = logging.getLogger(__name__)

# Constants
MAX_FILE_SIZE = settings.max_file_size_bytes
SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt']
STORAGE_DIR = settings.CV_UPLOAD_DIR
os.makedirs(STORAGE_DIR, exist_ok=True)


def generate_public_token() -> str:
    """Generate secure random token for public job links"""
    return secrets.token_urlsafe(32)


def validate_file_upload(file: UploadFile) -> None:
    """Validate uploaded file meets requirements"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    
    # Check file extension
    file_ext = '.' + file.filename.split('.')[-1].lower() if '.' in file.filename else ''
    if file_ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400, 
            detail=f"File type {file_ext} not supported. Supported types: {SUPPORTED_EXTENSIONS}"
        )
    
    # Note: File size validation happens during read if needed
    logger.info(f"✅ File validation passed: {file.filename}")


def now_iso() -> str:
    """Get current timestamp in ISO format"""
    return datetime.utcnow().isoformat()


def get_safe_applicant_name(app_data: dict) -> str:
    """
    Get applicant name with fallback logic to prevent API failures.
    This ensures the API never breaks due to null/empty applicant names.
    """
    # Try to get applicant_name first
    name = app_data.get("applicant_name")
    if name and name.strip() and name.lower() not in ["not specified", "unknown", "null"]:
        return name.strip()
    
    # Fallback 1: Try candidate.full_name from structured data
    candidate = app_data.get("candidate", {})
    if isinstance(candidate, dict):
        candidate_name = candidate.get("full_name")
        if candidate_name and candidate_name.strip() and candidate_name.lower() not in ["not specified", "unknown", "null"]:
            return candidate_name.strip()
    
    # Fallback 2: Try structured_info.name
    structured_info = app_data.get("structured_info", {})
    if isinstance(structured_info, dict):
        structured_name = structured_info.get("name")
        if structured_name and structured_name.strip() and structured_name.lower() not in ["not specified", "unknown", "null"]:
            return structured_name.strip()
    
    # Fallback 3: Derive from email
    email = app_data.get("applicant_email") or app_data.get("email", "")
    if email and "@" in email:
        # Extract name from email (part before @)
        name_part = email.split("@")[0]
        # Clean up the name: replace dots/underscores with spaces and title case
        derived_name = name_part.replace(".", " ").replace("_", " ").replace("-", " ").title()
        # Remove extra spaces
        derived_name = " ".join(derived_name.split())
        if derived_name:
            logger.info(f"🔄 Derived applicant name from email {email}: {derived_name}")
            return derived_name
    
    # Final fallback: Generic name
    logger.warning(f"⚠️ No valid applicant name found for application {app_data.get('id', 'unknown')}, using fallback")
    return "Applicant"


def generate_email_subject_id(job_title: str) -> str:
    """
    Generate unique email subject ID from job title
    Format: {JobTitleAbbreviation}-{Year}-{Counter}
    Example: "Software Engineer" -> "SE-2025-001"
    """
    # Extract meaningful words from job title (skip common words)
    common_words = {'and', 'or', 'the', 'a', 'an', 'in', 'at', 'for', 'with', 'by', 'to', 'of', 'as'}
    words = [word.strip() for word in re.split(r'[^\w]+', job_title.upper()) if word.strip() and word.lower() not in common_words]
    
    # Create abbreviation from first letters of meaningful words
    if len(words) >= 2:
        # Take first letter of first 2-3 words
        abbreviation = ''.join([word[0] for word in words[:3]])
    elif len(words) == 1:
        # Single word - take first 2-3 letters
        abbreviation = words[0][:3]
    else:
        # Fallback
        abbreviation = "JOB"
    
    # Ensure abbreviation is 2-4 characters
    if len(abbreviation) < 2:
        abbreviation = abbreviation + "J"
    elif len(abbreviation) > 4:
        abbreviation = abbreviation[:4]
    
    # Get current year
    current_year = datetime.utcnow().year
    
    # Get next counter for this year and abbreviation
    qdrant = get_qdrant_utils()
    counter = qdrant.get_next_email_subject_counter(abbreviation, current_year)
    
    return f"{abbreviation}-{current_year}-{counter:03d}"


def generate_email_subject_template(job_title: str, subject_id: str) -> str:
    """
    Generate full email subject template for Naukri
    Format: "{Job Title} | {Subject ID}"
    Example: "Software Engineer | SE-2025-001"
    """
    return f"{job_title.strip()} | {subject_id}"


_BOOLEAN_STOPWORDS = {
    'and', 'or', 'the', 'a', 'an', 'in', 'at', 'for', 'with', 'by', 'to', 'of', 'as',
    'on', 'is', 'are', 'be', 'will', 'we', 'you', 'your', 'our', 'role', 'job',
    'experience', 'years', 'year', 'work', 'working', 'strong', 'good', 'excellent',
    'ability', 'skills', 'skill', 'knowledge', 'understanding', 'including', 'etc',
    'team', 'support', 'using', 'use', 'must', 'should', 'have', 'has',
}


def _boolean_keywords(skills, limit: int = 8):
    """Pick distinct, meaningful keyword phrases from a list of skill sentences."""
    seen = set()
    keywords = []
    for raw in (skills or []):
        phrase = re.sub(r'[^\w\s+#.-]', ' ', str(raw)).strip()
        # Keep short phrases as-is; reduce long sentences to their leading meaningful words.
        words = [w for w in phrase.split() if w]
        if not words:
            continue
        if len(words) <= 3:
            candidate = ' '.join(words)
        else:
            picked = [w for w in words if w.lower() not in _BOOLEAN_STOPWORDS][:2]
            candidate = ' '.join(picked) if picked else ' '.join(words[:2])
        candidate = candidate.strip()
        key = candidate.lower()
        if not candidate or len(candidate) < 2 or key in seen or key in _BOOLEAN_STOPWORDS:
            continue
        seen.add(key)
        keywords.append(candidate)
        if len(keywords) >= limit:
            break
    return keywords


def generate_boolean_search_string(job_title: str, skills=None) -> str:
    """
    Build a Naukri-Gulf style boolean search string from a job title and skills.

    Example: ("Cloud Engineer", ["Azure", "Terraform", "Kubernetes"]) ->
      ("Cloud Engineer") AND ("Azure" OR "Terraform" OR "Kubernetes")

    This is deterministic so the same job always yields the same string, and it does
    not depend on the LLM returning a boolean field.
    """
    title = (job_title or "").strip()
    parts = []
    if title:
        parts.append(f'("{title}")')
    keywords = _boolean_keywords(skills, limit=8)
    if keywords:
        quoted = " OR ".join(f'"{k}"' for k in keywords)
        parts.append(f"({quoted})")
    return " AND ".join(parts)


def parse_email_subject(subject: str) -> tuple[Optional[str], Optional[str]]:
    """
    Parse email subject to extract job title and subject ID
    Handles Re:/Fwd: prefixes automatically
    Returns: (job_title, subject_id) or (None, None) if parsing fails
    """
    # Remove Re:/Fwd: prefixes (case insensitive, multiple possible)
    cleaned_subject = re.sub(r'^(re|fwd|fw):\s*', '', subject.strip(), flags=re.IGNORECASE)
    cleaned_subject = re.sub(r'^(re|fwd|fw):\s*', '', cleaned_subject, flags=re.IGNORECASE)  # Handle multiple prefixes
    
    # Look for pattern: "Job Title | ID-YYYY-NNN"
    match = re.match(r'^(.+?)\s*\|\s*([A-Z]{2,4}-\d{4}-\d{3})$', cleaned_subject.strip())
    
    if match:
        job_title = match.group(1).strip()
        subject_id = match.group(2).strip()
        return job_title, subject_id
    
    return None, None
