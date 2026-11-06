"""The Interview Question Agent: what it is and what the gate treats as its job."""
import re

from app.agents.base import AgentSpec
from app.agents.interview.parser import parse_interview
from app.agents.interview.prompt import CV_RULES, SYSTEM_PROMPT

INTERVIEW_AGENT = AgentSpec(
    id="interview",
    name="Interview Question Agent",
    tagline="Job-specific interview questions with what a strong answer looks like.",
    system_prompt=SYSTEM_PROMPT,
    parse=parse_interview,
    examples=["Generate 10 interview questions", "5 hard technical questions for a senior hire", "More behavioural questions"],
    default_request="Generate interview questions for this role.",
    other_agent_name="LinkedIn Job Post Agent",
    own_terms=re.compile(
        r"\b(?:interview|question|questions|screening|assess|assessment|technical|behaviou?ral|situational|competenc\w*|candidate|"
        r"follow[- ]?up|harder|easier|difficulty|seniority|junior|senior|mid[- ]?level|culture|scorecard|panel|round)\b", re.I),
    other_wants=re.compile(
        r"\b(?:linkedin|job\s+post(?:ing)?|social\s+media|hashtags?|vacancy\s+ad|advert(?:ise|isement)?|announce)\b", re.I),
    keep_if=re.compile(r"\binterview\b", re.I),
    accepts_cv=True,
    cv_rules=CV_RULES,
)
