"""The categories a CV or a job can be filed under (the "folders" of the Candidates and Jobs pages, and what category-based
matching compares). One list, used by both extraction prompts and by the check on what the LLM answers, so a category can never
appear that is not in it.

The nine IT categories are unchanged. The non-IT part used to be a single "Non IT" bucket, which put accountants, HR, sales,
nurses and marketers in one folder; it is now split by function. "Non IT" is still accepted so records saved earlier stay valid.
"""
from __future__ import annotations

from typing import List

IT_CATEGORIES: List[str] = [
    "Cloud & Infrastructure Engineering",
    "Software & Application Development",
    "Data & Analytics",
    "Cybersecurity & Governance",
    "Project & Program Management",
    "Business Applications & Functional Consulting",
    "IT Operations & Support",
    "Networking & Systems",
    "Specialized Technical Roles",
]
NON_IT_CATEGORIES: List[str] = [
    "Finance & Accounting",
    "Sales & Business Development",
    "Marketing & Communications",
    "Human Resources & Administration",
    "Operations, Supply Chain & Logistics",
    "Engineering (Non-IT)",
    "Healthcare & Life Sciences",
    "Education & Training",
    "Legal & Compliance",
    "Customer Service & Hospitality",
    "Executive & General Management",
    "Other",
]
CATEGORIES: List[str] = IT_CATEGORIES + NON_IT_CATEGORIES
LEGACY_CATEGORIES: List[str] = ["Non IT", "General"]       # saved before the split / the reader default: still valid, no longer offered

_BY_LOWER = {c.lower(): c for c in CATEGORIES + LEGACY_CATEGORIES}
_ALIASES = {
    "finance": "Finance & Accounting", "accounting": "Finance & Accounting", "accountancy": "Finance & Accounting",
    "finance and accounting": "Finance & Accounting", "audit": "Finance & Accounting", "banking": "Finance & Accounting",
    "sales": "Sales & Business Development", "business development": "Sales & Business Development",
    "sales and business development": "Sales & Business Development",
    "marketing": "Marketing & Communications", "marketing and communications": "Marketing & Communications",
    "hr": "Human Resources & Administration", "human resources": "Human Resources & Administration",
    "human resources and administration": "Human Resources & Administration", "administration": "Human Resources & Administration",
    "operations": "Operations, Supply Chain & Logistics", "supply chain": "Operations, Supply Chain & Logistics",
    "logistics": "Operations, Supply Chain & Logistics", "procurement": "Operations, Supply Chain & Logistics",
    "engineering": "Engineering (Non-IT)", "civil engineering": "Engineering (Non-IT)", "mechanical engineering": "Engineering (Non-IT)",
    "electrical engineering": "Engineering (Non-IT)", "engineering (non it)": "Engineering (Non-IT)",
    "healthcare": "Healthcare & Life Sciences", "medical": "Healthcare & Life Sciences", "nursing": "Healthcare & Life Sciences",
    "education": "Education & Training", "teaching": "Education & Training", "training": "Education & Training",
    "legal": "Legal & Compliance", "compliance": "Legal & Compliance", "law": "Legal & Compliance",
    "customer service": "Customer Service & Hospitality", "hospitality": "Customer Service & Hospitality",
    "management": "Executive & General Management", "executive": "Executive & General Management",
    "general management": "Executive & General Management",
    "cloud engineering": "Cloud & Infrastructure Engineering", "infrastructure": "Cloud & Infrastructure Engineering",
    "software development": "Software & Application Development", "software engineering": "Software & Application Development",
    "data": "Data & Analytics", "data science": "Data & Analytics", "analytics": "Data & Analytics",
    "cybersecurity": "Cybersecurity & Governance", "security": "Cybersecurity & Governance",
    "project management": "Project & Program Management", "it support": "IT Operations & Support", "networking": "Networking & Systems",
}


def prompt_list() -> str:
    """The categories as the prompts write them: 'A/B/C'."""
    return "/".join(CATEGORIES)


def normalize_category(value: object) -> str:
    """The category exactly as listed, whatever case or wording the LLM used; anything it cannot place becomes 'Other'
    (never a new category). A missing answer is also 'Other'."""
    text = " ".join(str(value or "").split())
    if not text:
        return "Other"
    key = text.lower()
    return _BY_LOWER.get(key) or _ALIASES.get(key) or _ALIASES.get(key.replace("&", "and")) or "Other"
