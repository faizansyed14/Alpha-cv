"""The LinkedIn Job Post Agent: what it is and what the gate treats as its job."""
import re

from app.agents.base import AgentSpec
from app.agents.linkedin.parser import parse_linkedin
from app.agents.linkedin.prompt import SYSTEM_PROMPT

LINKEDIN_AGENT = AgentSpec(
    id="linkedin",
    name="LinkedIn Job Post Agent",
    tagline="A ready-to-publish LinkedIn post for any job description.",
    system_prompt=SYSTEM_PROMPT,
    parse=parse_linkedin,
    examples=["Write the LinkedIn post", "A shorter, friendlier version", "Make it more punchy and add a call to action"],
    default_request="Write a LinkedIn post for this job.",
    other_agent_name="Interview Question Agent",
    own_terms=re.compile(
        r"\b(?:post|linkedin|hashtag|caption|announcement|announce|hiring|shorter|longer|tone|friendly|formal|punchy|casual|"
        r"professional|emoji|headline|hook|version|rewrite|rephrase|bullet|apply)\b", re.I),
    other_wants=re.compile(r"\b(?:interview\s+questions?|screening\s+questions?|questions?\s+to\s+ask|scorecard)\b", re.I),
    keep_if=re.compile(r"\b(?:post|linkedin)\b", re.I),
)
