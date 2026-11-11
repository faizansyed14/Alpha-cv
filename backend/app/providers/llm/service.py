
"""
LLM Service - Deterministic, Cached, Structured Extraction
----------------------------------------------------------
- Pinned model snapshot + seed + temp=0, top_p=1, penalties=0
- response_format JSON (or JSON Schema strict mode via env)
- Normalizes source text; caches by (kind, model, seed, prompt, text) SHA256
- Stable, deterministic ordering of phrases by first source occurrence
- JD prompt updated to NOT invent extra phrases (pads with "")
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests

from app.config.settings import settings
from app.security.llm_guard import sanitize_untrusted
from app.monitoring.recorder import get_recorder
from app.ingestion.categories import CATEGORIES, normalize_category, prompt_list as category_prompt_list

logger = logging.getLogger(__name__)

# =========================
# ---- Prompts (final) ----
# =========================

DEFAULT_CV_PROMPT = """You are an information-extraction engine. You will receive the full plain text of ONE resume/CV.
Your job is to output STRICT JSON with the following schema, extracting:
Candidate NAME: the person's actual full name, a human being's given name and family name (e.g. "Ahmed Al Mansoori", "Priya Sharma"). It is almost always the most prominent line at the very top of the document, often directly above or beside the contact details (email/phone/address).
  NEVER return any of the following as the name, even if they appear in a prominent position: a city, country, or address (e.g. "Riyadh", "Dubai, UAE"), a job title or role (e.g. "Senior Accountant"), a company/employer name, a document heading (e.g. "Curriculum Vitae", "Resume"), or a section header.
  If OCR/extraction noise makes the top of the document garbled or you cannot find a clear person's name anywhere in the text, return null, do not guess, and do not substitute a location, title, or any other field's value just to fill this one in.
Exactly 20 SKILL PHRASES (by reviewing the full CV and understanding the skills possessed by this candidate; if fewer than 20 exist, leave the remaining slots as "").
Exactly 10 RESPONSIBILITY PHRASES (from WORK EXPERIENCE / PROFESSIONAL EXPERIENCE sections; if fewer than 10, derive the remaining from CERTIFICATIONS or other professional sections, but never from skills).
The most recent JOB TITLE.
YEARS OF EXPERIENCE (total professional experience by seeing the date the candidate started working and taking a general calculation from start to present; you may infer from phrases like "15 years of experience").
JOB CATEGORY: Classify the candidate's role as one of (Technical/Management/Sales/Finance/HR/Marketing/Operations/Specialized).
SENIORITY LEVEL: Determine the seniority as one of (Entry/Junior/Mid/Senior/Lead/Manager/Director/VP/C-Level).
ROLE FAMILY: Identify the role family such as (Engineering/Management/Sales/Finance/HR/Marketing/Operations/Healthcare/Education/etc).
CATEGORY: Classify the candidate's primary domain as EXACTLY one of (<<CATEGORIES>>). Copy the name exactly as written; never invent a new category. Choose by the candidate's main function: accountants, auditors and finance staff are "Finance & Accounting"; sales and account managers "Sales & Business Development"; HR "Human Resources & Administration"; nurses and doctors "Healthcare & Life Sciences"; and so on. Only IT roles get an IT category. Use "Other" only when nothing fits. Base this on their primary skills, experience, and job titles.
Exactly 20 SEARCH KEYWORDS: short, precise keyword tags (1-3 words each, e.g. "Python", "AWS", "Financial Modeling", "Salesforce CRM", "Project Management") that a recruiter would type into a search box to find this exact candidate. These are NOT the same as the skill phrases above: a skill phrase can be a longer descriptive sentence fragment, a keyword must be the bare searchable term itself (the specific technology, tool, certification, methodology, or domain expertise named in the CV, not a paraphrase, not a generic word like "communication" or "teamwork" unless the CV gives no more specific skills at all). Pick the 20 terms that most precisely and distinctively describe THIS candidate, ranked by how central they are to their profile. This field is used to power exact-match candidate search, so precision matters more than creativity: only use terms that actually appear (or are unambiguously implied, e.g. "AWS" implying "Amazon Web Services") in the CV. If fewer than 20 genuinely distinct, specific keywords exist, leave the remaining slots as "" rather than inventing or repeating ones.
GENDER: Infer only when the CV explicitly states gender/sex OR uses unambiguous gendered pronouns referring to the candidate (he/him/his → "Male", she/her/hers → "Female"), or an explicit label like "Gender: Male". If unclear, ambiguous, or not mentioned, return null. NEVER invent gender from the name alone.
CERTIFICATIONS: Professional certifications and licences the candidate holds, ONLY if the CV states them (e.g. a Certifications/Licences section, or "ACCA qualified", "PMP certified"). Give each as its full official name with the acronym in parentheses, e.g. "Association of Chartered Certified Accountants (ACCA)", "Project Management Professional (PMP)", "Amazon Web Services Certified Developer Associate". Do NOT list degrees, university courses, training attendance or skills. Return a de-duplicated array (max 20); return [] if none are stated.
LANGUAGES: Extract spoken/written languages ONLY if the CV explicitly lists them (e.g. Languages, Language proficiency, Mother tongue sections, or phrases like "Fluent in English and Arabic"). Return a de-duplicated array of language names (e.g. ["English", "Arabic"]). If none are mentioned, return []. Do not invent languages from location or nationality.
General Rules:
Output valid JSON only. No markdown, no comments, no trailing commas.
Use English only.
Do not invent facts. If something is missing, leave empty strings "" or null.
Arrays must be fixed length: skills_sentences = 20, responsibility_sentences = 10.
De-duplicate near-duplicates (case-insensitive). Keep the most informative version.
Each skill/responsibility must be a concise, descriptive phrase (not a full sentence).
Example: "active directory security assessments to strengthen authentication and access controls"
Avoid: "Performs active directory security assessments to strengthen authentication and access controls."
Remove filler verbs such as performs, provides, carries out, responsible for, manages, oversees.
Skills must be derived by reviewing the full document and understanding what skills the candidate possesses.
Responsibilities must come only from EXPERIENCE/WORK HISTORY sections (and CERTIFICATIONS if needed).
Expand acronyms into their full professional terms (e.g., AWS → Amazon Web Services, SQL → Structured Query Language). Apply consistently.
Ensure skill and responsibility lists are domain-specific phrases only without generic wording.
No duplication across skills and responsibilities.
Output Format:
{
  "doc_type": "resume",
  "name": string | null,
  "job_title": string | null,
  "years_of_experience": number | null,
  "job_category": string | null,
  "seniority_level": string | null,
  "role_family": string | null,
  "category": string | null,
  "gender": "Male" | "Female" | null,
  "languages": ["English", "..."] | [],
  "certifications": ["Project Management Professional (PMP)", "..."] | [],
  "skills_sentences": [
    "<Skill phrase 1>",
    "... (total 20 items)",
    ""
  ],
  "responsibility_sentences": [
    "<Responsibility phrase 1>",
    "... (total 10 items)",
    ""
  ],
  "keywords": [
    "<Search keyword 1>",
    "... (total 20 items)",
    ""
  ],
  "contact_info": {"name": string | null}
}
"""

# CV / JD extraction answers are long (20 skills, 10 responsibilities, keywords ...). A 1500-token cap cut them off mid-JSON.
EXTRACTION_MAX_TOKENS = 4000

DEFAULT_JD_PROMPT = """You are an information-extraction engine. You will receive the full plain text of ONE job description (JD).
Your job is to output STRICT JSON with the following schema, extracting:
Exactly 20 SKILL PHRASES (prefer SKILLS, REQUIREMENTS, QUALIFICATIONS, TECHNOLOGY STACK sections; read the full document. If fewer than 20 exist, leave remaining slots as "").
Exactly 10 RESPONSIBILITY PHRASES (from RESPONSIBILITIES, DUTIES, WHAT YOU'LL DO sections; if fewer than 10 exist, leave remaining slots as "").
The JOB TITLE of the role. IMPORTANT: Look for explicit job titles in the document first. If no explicit title is found, intelligently infer based on the primary technologies and skills:
  - SharePoint + .NET/C# skills → "SharePoint Developer" or "SharePoint/.NET Developer"
  - React/Angular + Node.js/ASP.NET → "Full Stack Developer"
  - Python + Data analysis → "Data Analyst" or "Python Developer"
  - Azure + DevOps → "DevOps Engineer"
  - If multiple senior technologies → Add "Senior" prefix
  - NEVER return null - always provide a reasonable job title.
YEARS OF EXPERIENCE (minimum required). Look for explicit mentions like "5+ years", "minimum 3 years". If not found, infer:
  - Junior/Entry skills → 1-2 years
  - Multiple frameworks + integration → 3-5 years  
  - Architecture/DevOps/Leadership indicators → 5+ years
  - NEVER return null - always provide a number.
JOB CATEGORY: Classify the role as one of (Technical/Management/Sales/Finance/HR/Marketing/Operations/Specialized).
SENIORITY LEVEL: Determine the seniority as one of (Entry/Junior/Mid/Senior/Lead/Manager/Director/VP/C-Level).
ROLE FAMILY: Identify the role family such as (Engineering/Management/Sales/Finance/HR/Marketing/Operations/Healthcare/Education/etc).
CATEGORY: Classify the job's primary domain as EXACTLY one of (<<CATEGORIES>>). Copy the name exactly as written; never invent a new category. Choose by the job's main function: an accountant or auditor role is "Finance & Accounting", a sales role "Sales & Business Development", an HR role "Human Resources & Administration", and so on. Only IT roles get an IT category. Use "Other" only when nothing fits. Base this on the required skills, technologies, and job responsibilities.
REQUIRED LANGUAGES: languages the job asks for, each as {"name": "English", "mandatory": true|false}. mandatory is true ONLY when the text makes it a requirement ("must", "required", "mandatory", "essential", "fluent X is a must", or it is listed under requirements/qualifications); false when it is a plus ("preferred", "advantage", "desirable", "nice to have"). Language names only (e.g. "Arabic", "English"), no levels. [] if the job states none; never infer a language from the country or company.
REQUIRED CERTIFICATIONS: professional certifications or licences the job asks for, each as {"name": "...", "mandatory": true|false}, with the same rule for mandatory. Use the full official name with the acronym in parentheses, e.g. "Association of Chartered Certified Accountants (ACCA)". When the job accepts alternatives (e.g. "ACCA or CPA"), put them in ONE entry joined with " OR ". Do NOT list degrees or experience. [] if the job states none.
BOOLEAN SEARCH STRING: Build ONE SHORT recruiter Boolean search string for Naukri Gulf / job portals. Keep it SMALL and LOOSE so it returns more candidates (not a strict filter).
  - Pattern: ("Job Title") AND (skill1 OR skill2 OR skill3 OR skill4 OR skill5) — title once, then up to 5 core skills joined with OR.
  - Prefer OR over AND. Do NOT stack many AND groups (that makes the search too strict and long).
  - Max ~1 title + 5 skills. No synonyms lists, no seniority words, no certifications, no location, no soft skills.
  - Wrap multi-word phrases in double quotes. Use only real title/skills from the JD; do not invent terms.
  - Example (good, short): ("DevOps Engineer") AND (Kubernetes OR Terraform OR Azure OR Docker OR Ansible)
  - Example (bad, too long/strict): ("DevOps Engineer" OR "SRE") AND (Kubernetes OR Docker) AND (Terraform OR Ansible) AND (AWS OR Azure)
General Rules:
Output valid JSON only. No markdown, no comments, no trailing commas.
Use English only.
Do not invent facts. If something is missing, leave empty strings "" or null.
Arrays must be fixed length: skills_sentences = 20, responsibility_sentences = 10.
De-duplicate near-duplicates (case-insensitive). Keep the most informative version.
Each skill/responsibility must be a concise, descriptive phrase (not a full sentence).
Example: "structured query language database administration"
Avoid: "Uses Structured Query Language to administer relational databases."
Remove filler verbs such as develops, implements, provides, generates, manages, responsible for.
Skills should come from SKILLS/REQUIREMENTS/QUALIFICATIONS sections; also review the full document.
Responsibilities should come from RESPONSIBILITIES/DUTIES/WHAT YOU'LL DO sections.
Expand acronyms into their full professional terms (e.g., CRM → Customer Relationship Management, API → Application Programming Interface). Apply consistently.
Ensure skills and responsibilities remain short, embedding-friendly phrases with no generic filler wording.
Skills and responsibilities must remain distinct, with no overlap.
Output Format:
{
  "doc_type": "job_description",
  "job_title": string | null,
  "years_of_experience": number | null,
  "job_category": string | null,
  "seniority_level": string | null,
  "role_family": string | null,
  "category": string | null,
  "boolean_search_string": string | null,
  "required_languages": [{"name": "English", "mandatory": true}] | [],
  "required_certifications": [{"name": "Project Management Professional (PMP)", "mandatory": false}] | [],
  "skills_sentences": [
    "<Skill phrase 1>",
    "... (total 20 items)",
    ""
  ],
  "responsibility_sentences": [
    "<Responsibility phrase 1>",
    "... (total 10 items)",
    ""
  ]
}
"""

DEFAULT_CV_PROMPT = DEFAULT_CV_PROMPT.replace("<<CATEGORIES>>", category_prompt_list())
DEFAULT_JD_PROMPT = DEFAULT_JD_PROMPT.replace("<<CATEGORIES>>", category_prompt_list())

# ===================================
# ---- Optional JSON Schema lock ----
# ===================================

STRICT_SCHEMA_ENABLED = os.getenv("LLM_JSON_SCHEMA_STRICT", "0") not in {"0", "false", "False", ""}

CV_JSON_SCHEMA: Dict[str, Any] = {
    "name": "cv_schema",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "doc_type", "name", "job_title", "years_of_experience",
            "skills_sentences", "responsibility_sentences", "keywords", "contact_info",
            "gender", "languages", "certifications"
        ],
        "properties": {
            "doc_type": {"type": "string", "const": "resume"},
            "name": {"type": ["string", "null"]},
            "job_title": {"type": ["string", "null"]},
            "years_of_experience": {"type": ["number", "integer", "null"]},
            "category": {"type": ["string", "null"], "enum": CATEGORIES + [None]},
            "gender": {"type": ["string", "null"]},
            "languages": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 20
            },
            "certifications": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 20
            },
            "skills_sentences": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 20,
                "maxItems": 20
            },
            "responsibility_sentences": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 10,
                "maxItems": 10
            },
            "keywords": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 20,
                "maxItems": 20
            },
            "contact_info": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name"],
                "properties": {"name": {"type": ["string", "null"]}}
            }
        }
    }
}

JD_JSON_SCHEMA: Dict[str, Any] = {
    "name": "jd_schema",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "doc_type", "job_title", "years_of_experience",
            "skills_sentences", "responsibility_sentences", "required_languages", "required_certifications"
        ],
        "properties": {
            "doc_type": {"type": "string", "const": "job_description"},
            "job_title": {"type": ["string", "null"]},
            "years_of_experience": {"type": ["number", "integer", "null"]},
            "category": {"type": ["string", "null"], "enum": CATEGORIES + [None]},
            "boolean_search_string": {"type": ["string", "null"]},
            "required_languages": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name", "mandatory"],
                    "properties": {"name": {"type": "string"}, "mandatory": {"type": "boolean"}}
                },
                "maxItems": 10
            },
            "required_certifications": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name", "mandatory"],
                    "properties": {"name": {"type": "string"}, "mandatory": {"type": "boolean"}}
                },
                "maxItems": 10
            },
            "skills_sentences": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 20,
                "maxItems": 20
            },
            "responsibility_sentences": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 10,
                "maxItems": 10
            }
        }
    }
}

# ============================
# ---- Data structures ----
# ============================

@dataclass
class LLMResponse:
    success: bool
    data: Dict[str, Any]
    processing_time: float
    model_used: str
    error_message: Optional[str] = None
    system_fingerprint: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    attempts: int = 1
    cost_usd: Optional[float] = None
    truncated: bool = False                # the model stopped because it ran out of output tokens, not because it was finished
    tokens_cached: int = 0                 # prompt tokens read from the provider's prompt cache (billed at a fraction)
    tokens_cache_write: int = 0            # prompt tokens written to it by this call


# ============================
# ---- Main service class ----
# ============================

class LLMService:
    """
    Deterministic LLM extraction through OpenRouter (OpenAI-style Chat Completions).
    """

    # Disk cache is pruned (oldest first) once it exceeds this many entries.

    def __init__(self):
        self.api_key = settings.OPENROUTER_API_KEY or os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")

        # The model comes from LLM_MODEL (an OpenRouter id such as anthropic/claude-haiku-5.5).
        self.default_model = settings.LLM_MODEL

        self.max_retries = settings.LLM_MAX_RETRIES
        self.base_delay = settings.LLM_RETRY_BASE_DELAY

        # Endpoint & session (API key lives only in session headers; never logged)
        self.base_url = settings.OPENROUTER_BASE_URL.rstrip("/") + "/chat/completions"
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Title": settings.OPENROUTER_APP_NAME,
        })
        if settings.OPENROUTER_SITE_URL:
            self.session.headers["HTTP-Referer"] = settings.OPENROUTER_SITE_URL

        logger.info(f"LLMService initialized (model={self.default_model}, deterministic)")

    # ------------- Public APIs -------------

    def standardize_cv(self, raw_text: str, filename: str = "cv.txt") -> Dict[str, Any]:
        """
        Extract & standardize CV → normalized, stable JSON.
        """
        try:
            # Normalize + guard size
            norm = self._normalize_text(sanitize_untrusted(raw_text))
            if len(norm) > 50000:
                logger.warning(f"Large CV detected ({len(norm):,}); truncating to 50k")
                norm = norm[:50000] + "\n\n[TRUNCATED FOR PROCESSING]"

            messages = self._build_cv_prompt(norm)
            self._log_llm_outbound("CV", filename, norm, messages)

            response = self._call_openai_api(messages, json_schema=CV_JSON_SCHEMA if STRICT_SCHEMA_ENABLED else None,
                                             role="cv_extract", max_tokens=EXTRACTION_MAX_TOKENS)
            self._log_llm_inbound("CV", response)

            if not response.success:
                raise Exception(response.error_message or "Unknown LLM error")

            normalized = self._validate_cv_response(response.data, source_text=norm)
            normalized["processing_metadata"] = {
                "filename": filename,
                "processing_time": response.processing_time,
                "model_used": response.model_used,
                "system_fingerprint": response.system_fingerprint,
                "text_length": len(norm),
            }

            return normalized

        except Exception as e:
            logger.error(f"CV standardization failed: {e}")
            raise

    def standardize_jd(self, raw_text: str, filename: str = "jd.txt") -> Dict[str, Any]:
        """
        Extract & standardize JD → normalized, stable JSON.
        """
        try:
            norm = self._normalize_text(sanitize_untrusted(raw_text))
            if len(norm) > 30000:
                logger.warning(f"Large JD detected ({len(norm):,}); truncating to 30k")
                norm = norm[:30000] + "\n\n[TRUNCATED FOR PROCESSING]"

            messages = self._build_jd_prompt(norm)
            self._log_llm_outbound("JD", filename, norm, messages)

            response = self._call_openai_api(messages, json_schema=JD_JSON_SCHEMA if STRICT_SCHEMA_ENABLED else None,
                                             role="jd_extract", max_tokens=EXTRACTION_MAX_TOKENS)
            self._log_llm_inbound("JD", response)

            if not response.success:
                raise Exception(response.error_message or "Unknown LLM error")

            normalized = self._validate_jd_response(response.data, source_text=norm)
            normalized["processing_metadata"] = {
                "filename": filename,
                "processing_time": response.processing_time,
                "model_used": response.model_used,
                "system_fingerprint": response.system_fingerprint,
                "text_length": len(norm),
            }

            return normalized

        except Exception as e:
            logger.error(f"JD standardization failed: {e}")
            raise

    # ------------- OpenAI call -------------

    def _call_openai_api(
        self,
        messages: List[Dict[str, str]],
        *,
        model: Optional[str] = None,
        max_tokens: int = 1500,
        json_schema: Optional[Dict[str, Any]] = None,
        timeout: Optional[int] = None,
        role: str = "llm",
        detail: Optional[Dict[str, Any]] = None,
        raw: bool = False,
        tools: Optional[List[Dict[str, Any]]] = None,
        cache: str = "blocks",
    ) -> LLMResponse:
        """Call OpenAI and record the call (latency, tokens, estimated cost, errors, retries) for the Monitor page.

        ``role`` names what the call is for (cv_extract, jd_extract, match_analysis) so the page can split usage.
        ``cache`` is the prompt-cache plan, see ``_prepare_messages``.
        """
        started = time.perf_counter()
        response: Optional[LLMResponse] = None
        try:
            response = self._send_openai_request(messages, model=model, max_tokens=max_tokens,
                                                 json_schema=json_schema, timeout=timeout, raw=raw, tools=tools, cache=cache)
            return response
        finally:
            ok = bool(response and response.success)
            info = dict(detail or {})
            if response is not None and response.attempts > 1:
                info["attempts"] = response.attempts
            if response is not None and (response.tokens_cached or response.tokens_cache_write):
                info["cached"], info["cache_write"] = response.tokens_cached, response.tokens_cache_write
            if not ok:
                info["error"] = ((response.error_message if response else "exception") or "")[:300]
            get_recorder().record(
                "llm", role, (response.model_used if response else None) or model or self.default_model,
                (time.perf_counter() - started) * 1000, status="ok" if ok else "error",
                tokens_in=response.tokens_in if response else 0, tokens_out=response.tokens_out if response else 0,
                cost=(response.cost_usd if response is not None else None),      # the real price OpenRouter charged, cache discount included
                detail=info, notable=True)

    @staticmethod
    def _prepare_messages(messages: List[Dict[str, Any]], model: str, cache: str) -> List[Dict[str, Any]]:
        """The messages as they are sent, with prompt-cache breakpoints for Anthropic models (other models cache a repeated start by themselves).
        The caller's list is never changed. ``cache`` says where the stable start of the prompt ends:

        * ``"blocks"``  only where a message carries ``cache_prefix`` (the length of its stable start, in characters): the long
                        instructions of a CV / JD extraction or a match, before the document that differs every time.
        * ``"system"``  also the whole system message.
        * ``"rolling"`` the system message and the latest user message: in a chat or a tool loop the next call repeats everything
                        up to there, so it is read from the cache instead of being billed again.

        A breakpoint on text shorter than the model's minimum (512 tokens on the Claude 5 models) is ignored by the provider, not an error.
        """
        on = bool(settings.LLM_PROMPT_CACHE) and (model or "").lower().startswith("anthropic/")
        mark: Dict[str, Any] = {"type": "ephemeral"}
        if settings.LLM_PROMPT_CACHE_TTL == "1h":
            mark["ttl"] = "1h"
        last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user" and isinstance(m.get("content"), str)), default=None)
        out: List[Dict[str, Any]] = []
        for i, original in enumerate(messages):
            m = dict(original)
            split = m.pop("cache_prefix", None)                  # our own marker: never sent to the provider
            content = m.get("content")
            if on and isinstance(content, str) and content.strip():
                if isinstance(split, int) and 0 < split < len(content):
                    m["content"] = [{"type": "text", "text": content[:split], "cache_control": dict(mark)},
                                    {"type": "text", "text": content[split:]}]
                elif cache in ("system", "rolling") and m.get("role") == "system":
                    m["content"] = [{"type": "text", "text": content, "cache_control": dict(mark)}]
                elif cache == "rolling" and i == last_user:
                    m["content"] = [{"type": "text", "text": content, "cache_control": dict(mark)}]
            out.append(m)
        return out

    def _send_openai_request(
        self,
        messages: List[Dict[str, str]],
        *,
        model: Optional[str] = None,
        max_tokens: int = 1500,
        json_schema: Optional[Dict[str, Any]] = None,
        timeout: Optional[int] = None,
        raw: bool = False,
        tools: Optional[List[Dict[str, Any]]] = None,
        cache: str = "blocks",
    ) -> LLMResponse:
        """``tools`` (OpenAI function-calling format) lets the model ask for tool calls; with ``raw=True`` they come back as
        ``data["_tool_calls"]``. ``raw=True`` returns the model's text as ``data["_text"]`` without parsing it as JSON (the AI agents use a plain-text
        layout, which cannot fail to parse the way long JSON can, so there is no wasted retry)."""
        if not model:
            model = self.default_model
        request_timeout = timeout if timeout is not None else 60

        # No response_format / seed / penalty parameters: Claude models behind OpenRouter do not take them, and every
        # prompt in this app already demands "valid JSON only", which _parse_json_response then extracts and validates.
        body: Dict[str, Any] = {
            "model": model,
            "messages": self._prepare_messages(messages, model, cache),
            "max_tokens": max_tokens,
            "temperature": 0.0,
            "usage": {"include": True},            # OpenRouter reports the real cost of each call
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        if settings.OPENROUTER_ZDR:
            body["provider"] = {"zdr": True, "data_collection": "deny"}

        start = time.time()
        last_err: Optional[str] = None

        for attempt in range(self.max_retries):
            try:
                logger.info(f"LLM API call (attempt {attempt + 1}/{self.max_retries}) - Model: {model}, timeout={request_timeout}s")
                r = self.session.post(self.base_url, json=body, timeout=request_timeout)
                if r.status_code == 200:
                    payload = r.json()
                    sys_fp = payload.get("system_fingerprint")
                    message = payload.get("choices", [{}])[0].get("message", {}) or {}
                    content = message.get("content") or ""
                    tool_calls = message.get("tool_calls") or []
                    finish = str((payload.get("choices", [{}])[0] or {}).get("finish_reason") or "").lower()

                    if not content.strip() and not tool_calls:
                        raise Exception("Empty response from the model")

                    data = {"_text": content, "_tool_calls": tool_calls} if raw else self._parse_json_response(content)
                    usage = payload.get("usage") or {}
                    details = usage.get("prompt_tokens_details") or {}
                    return LLMResponse(
                        success=True,
                        data=data,
                        processing_time=time.time() - start,
                        model_used=model,
                        system_fingerprint=sys_fp,
                        tokens_in=int(usage.get("prompt_tokens") or 0),
                        tokens_out=int(usage.get("completion_tokens") or 0),
                        attempts=attempt + 1,
                        cost_usd=(float(usage["cost"]) if usage.get("cost") is not None else None),
                        truncated=finish in ("length", "max_tokens"),
                        tokens_cached=int(details.get("cached_tokens") or 0),
                        tokens_cache_write=int(details.get("cache_write_tokens") or 0),
                    )

                # Retryable HTTP statuses
                if r.status_code in (429, 502, 503, 504):
                    last_err = f"API error: {r.status_code} - {r.text}"
                    if attempt < self.max_retries - 1:
                        delay = self.base_delay * (2 ** attempt)
                        logger.warning(f"{last_err}, retrying in {delay}s...")
                        time.sleep(delay)
                        continue
                # Non-retryable
                return LLMResponse(False, {}, time.time() - start, model, f"API error: {r.status_code} - {r.text}")

            except requests.exceptions.Timeout:
                last_err = "Timeout"
                if attempt < self.max_retries - 1:
                    delay = self.base_delay * (2 ** attempt)
                    logger.warning(f"Timeout, retrying in {delay}s...")
                    time.sleep(delay)
                    continue
                return LLMResponse(False, {}, time.time() - start, model, "Timeout")
            except Exception as e:
                last_err = str(e)
                if attempt < self.max_retries - 1:
                    delay = self.base_delay * (2 ** attempt)
                    logger.warning(f"Error: {e}, retrying in {delay}s...")
                    time.sleep(delay)
                    continue
                return LLMResponse(False, {}, time.time() - start, model, last_err)

        return LLMResponse(False, {}, time.time() - start, model, last_err or "All retries failed")

    # ------------- Prompt builders -------------

    def _build_cv_prompt(self, text: str) -> List[Dict[str, str]]:
        # The instructions never change; only the CV after them does. "cache_prefix" marks where the stable start ends.
        head = f"{DEFAULT_CV_PROMPT}\n\nCV CONTENT:\n"
        return [{"role": "user", "content": head + text, "cache_prefix": len(head)}]

    def _build_jd_prompt(self, text: str) -> List[Dict[str, str]]:
        head = f"{DEFAULT_JD_PROMPT}\n\nJOB DESCRIPTION:\n"
        return [{"role": "user", "content": head + text, "cache_prefix": len(head)}]

    # ------------- Parsing & validation -------------

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        # response_format is JSON, but we still guard against code fences etc.
        cleaned = re.sub(r'```(json)?', '', content, flags=re.IGNORECASE).strip()
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1:
            raise json.JSONDecodeError("No valid JSON found", content, 0)
        if end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                pass
        # the answer was cut off before it finished (a long list hit the output limit): keep everything that was written
        repaired = self._repair_truncated_json(cleaned[start:])
        try:
            value = json.loads(repaired)
        except json.JSONDecodeError:
            raise json.JSONDecodeError("No valid JSON found", content, 0)
        logger.warning("The model's JSON was cut off; the complete part of it was used")
        return value

    @staticmethod
    def _repair_truncated_json(text: str) -> str:
        """Close whatever a cut-off JSON object left open: an unfinished string, a dangling key, trailing commas, brackets."""
        stack: List[str] = []
        in_string = escaped = False
        for ch in text:
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
            elif ch == '"':
                in_string = True
            elif ch in "{[":
                stack.append("}" if ch == "{" else "]")
            elif ch in "}]" and stack:
                stack.pop()
        out = text + ('"' if in_string else "")
        if stack and stack[-1] == "}":
            out = re.sub(r'([,{])\s*"[^"]*"\s*$', r"\1", out)    # a key that was cut off before its colon
        out = re.sub(r',\s*"[^"]*"\s*:\s*$', "", out)           # a key with no value yet
        out = re.sub(r'\{\s*"[^"]*"\s*:\s*$', "{", out)
        out = re.sub(r",\s*$", "", out)
        return out + "".join(reversed(stack))

    @staticmethod
    def _normalize_fixed_list(items: Optional[List[Any]], target_len: int) -> List[str]:
        """
        Trim whitespace, drop empties, de-duplicate case-insensitively,
        then pad to target_len with "" and truncate if needed.
        """
        cleaned: List[str] = []
        seen = set()
        for x in (items or []):
            s = ("" if x is None else str(x)).strip()
            if not s:
                continue
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(s)
        if len(cleaned) < target_len:
            cleaned.extend([""] * (target_len - len(cleaned)))
        return cleaned[:target_len]

    def _stable_order(self, phrases: List[str], source: str) -> List[str]:
        """
        Deterministic ordering: by first occurrence in source (case-insensitive),
        with blanks last; ties resolved lexicographically.
        """
        src = source.lower()
        tagged = []
        BIG = 10 ** 9
        for p in phrases:
            if not p:
                tagged.append((BIG, ""))  # blanks at end
            else:
                c = self._canonicalize(p)
                idx = src.find(c.lower())
                if idx < 0:
                    idx = BIG - 1
                tagged.append((idx, c))
        tagged.sort(key=lambda t: (t[0], t[1]))
        return [t[1] for t in tagged]

    def _canonicalize(self, s: str) -> str:
        s = unicodedata.normalize("NFKC", s).strip()
        s = re.sub(r"\s+", " ", s)
        return s

    def _clean_name_list(self, raw: Any, limit: int) -> List[str]:
        """Strings, canonicalised, de-duplicated case-insensitively, at most ``limit`` (a lone string is split on , ; |)."""
        if isinstance(raw, str):
            raw = [p.strip() for p in re.split(r"[,;|\n]+", raw) if p.strip()]
        out: List[str] = []
        seen = set()
        for item in raw if isinstance(raw, list) else []:
            if not isinstance(item, str):
                continue
            cleaned = self._canonicalize(item)[:120]
            if cleaned and cleaned.lower() not in seen:
                seen.add(cleaned.lower())
                out.append(cleaned)
            if len(out) >= limit:
                break
        return out

    def _clean_requirements(self, raw: Any) -> List[Dict[str, Any]]:
        """[{'name', 'mandatory'}]: the model's objects (or bare strings, taken as mandatory), cleaned and de-duplicated."""
        out: List[Dict[str, Any]] = []
        seen = set()
        for item in raw if isinstance(raw, list) else []:
            if isinstance(item, dict):
                name, mandatory = item.get("name"), item.get("mandatory", True)
                if isinstance(mandatory, str):
                    mandatory = mandatory.strip().lower() not in {"false", "no", "preferred", "optional", "0"}
            else:
                name, mandatory = item, True
            if not isinstance(name, str):
                continue
            cleaned = self._canonicalize(name)[:120]
            if cleaned and cleaned.lower() not in seen:
                seen.add(cleaned.lower())
                out.append({"name": cleaned, "mandatory": bool(mandatory)})
            if len(out) >= 10:
                break
        return out

    def _validate_cv_response(self, data: Dict[str, Any], *, source_text: str) -> Dict[str, Any]:
        skills_src = data.get("skills_sentences") or data.get("skills") or []
        resp_src = data.get("responsibility_sentences") or data.get("responsibilities") or []
        keywords_src = data.get("keywords") or []

        skills = self._normalize_fixed_list(skills_src, 20)
        resps  = self._normalize_fixed_list(resp_src, 10)
        # Keywords are the search index for candidate lookup (see FilterSidebar /
        # advanced CV search), deliberately NOT stable-ordered by source position
        # like skills/responsibilities are, since their whole point is a flat,
        # de-duplicated tag list, not a document-order narrative.
        keywords = self._normalize_fixed_list(keywords_src, 20)

        # deterministic ordering by appearance in source
        skills = self._stable_order(skills, source_text)
        resps  = self._stable_order(resps, source_text)

        raw_gender = data.get("gender")
        gender = None
        if isinstance(raw_gender, str):
            g = raw_gender.strip().lower()
            if g in {"male", "m", "man", "masculine"}:
                gender = "Male"
            elif g in {"female", "f", "woman", "feminine"}:
                gender = "Female"

        raw_langs = data.get("languages") or []
        languages: list[str] = []
        if isinstance(raw_langs, str):
            raw_langs = [p.strip() for p in re.split(r"[,;/|]+", raw_langs) if p.strip()]
        if isinstance(raw_langs, list):
            seen = set()
            for lang in raw_langs:
                if not isinstance(lang, str):
                    continue
                cleaned = self._canonicalize(lang)
                if not cleaned:
                    continue
                key = cleaned.lower()
                if key in seen:
                    continue
                seen.add(key)
                languages.append(cleaned)
                if len(languages) >= 20:
                    break

        certifications = self._clean_name_list(data.get("certifications"), 20)

        out = {
            "doc_type": "resume",
            "name": data.get("name"),
            "job_title": data.get("job_title"),
            "years_of_experience": data.get("years_of_experience"),
            "category": normalize_category(data.get("category")),
            "gender": gender,
            "languages": languages,
            "certifications": certifications,
            "skills_sentences": skills,
            "responsibility_sentences": resps,
            "keywords": keywords,
            "contact_info": {"name": data.get("name")},
        }
        return out

    def _validate_jd_response(self, data: Dict[str, Any], *, source_text: str) -> Dict[str, Any]:
        skills_src = data.get("skills_sentences") or data.get("skills") or []
        resp_src   = data.get("responsibility_sentences") or data.get("responsibilities") or []

        skills = self._normalize_fixed_list(skills_src, 20)
        resps  = self._normalize_fixed_list(resp_src, 10)

        skills = self._stable_order(skills, source_text)
        resps  = self._stable_order(resps, source_text)

        boolean_str = data.get("boolean_search_string") or data.get("boolean_string") or ""
        if isinstance(boolean_str, str):
            boolean_str = boolean_str.strip()
        else:
            boolean_str = ""

        out = {
            "doc_type": "job_description",
            "job_title": data.get("job_title"),
            "years_of_experience": data.get("years_of_experience"),
            "category": normalize_category(data.get("category")),
            "boolean_search_string": boolean_str,
            "required_languages": self._clean_requirements(data.get("required_languages")),
            "required_certifications": self._clean_requirements(data.get("required_certifications")),
            "skills_sentences": skills,
            "responsibility_sentences": resps,
        }
        return out

    # ------------- Normalization & cache -------------

    def _normalize_text(self, s: str) -> str:
        s = unicodedata.normalize("NFKC", s)
        s = s.replace("\r\n", "\n").replace("\r", "\n")
        s = re.sub(r"[ \t]+", " ", s)
        s = re.sub(r"\n{3,}", "\n\n", s)
        return s.strip()

    # ------------- Logging helpers -------------

    def _log_llm_outbound(self, kind: str, filename: str, raw_text: str, messages: List[Dict[str, str]]):
        logger.info(f"---------- DATA SENT TO LLM ({kind}) ----------")
        logger.info(f"Filename: {filename}")
        logger.info(f"Text length: {len(raw_text)} characters")
        logger.info(f"Prompt (first 1500 chars):\n{messages[0]['content'][:1500]}")
        logger.info("----------------------------------------------")

    def _log_llm_inbound(self, kind: str, response: LLMResponse):
        logger.info(f"---------- RESPONSE FROM LLM ({kind}) ----------")
        logger.info(f"Success: {response.success}")
        logger.info(f"Processing time: {response.processing_time:.2f}s")
        logger.info(f"Model used: {response.model_used}")
        logger.info(f"system_fingerprint: {response.system_fingerprint}")
        if response.success:
            logger.info(f"Response data keys: {list(response.data.keys())}")
        else:
            logger.info(f"Error message: {response.error_message}")
        logger.info("-----------------------------------------------")

    def extract_jd_for_ui_display(self, content: str, filename: str) -> Optional[Dict[str, Any]]:
        """
        Extract human-readable, candidate-facing information from JD content.
        This is separate from the matching pipeline and focuses on clear, professional presentation.
        """
        try:
            # New prompt specifically for UI display
            ui_extraction_prompt = f"""
You are a job description parser. Your ONLY job is to extract the EXACT information from the provided job description text below.

DO NOT CREATE, INVENT, OR GENERATE ANY CONTENT. ONLY EXTRACT what is actually written in the text.

If the text says "AI Consultant", return "AI Consultant". If it says "Senior Software Engineer", return "Senior Software Engineer". Extract exactly what is written.

Job Description Text:
{content}

Extract these 5 fields from the text above:

1. job_title: Find the exact job title mentioned in the text (e.g., "AI Consultant", "Senior AI Consultant", "Data Scientist")
2. job_location: Find location information if mentioned, otherwise use "Location not specified"
3. job_summary: Write 2-3 sentences summarizing what this role does based on the text
4. key_responsibilities: List 3-5 main responsibilities mentioned in the text as bullet points
5. qualifications: List 3-5 required skills/qualifications mentioned in the text as bullet points

Return ONLY this JSON format:
{{
    "job_title": "exact title from text",
    "job_location": "location from text or 'Location not specified'",
    "job_summary": "summary based on text content",
    "key_responsibilities": "• responsibility from text\\n• another responsibility from text",
    "qualifications": "• qualification from text\\n• another qualification from text"
}}
"""

            messages = [
                {"role": "system", "content": "You are a text extraction tool. Extract only what is written in the provided text. Do not generate or create any content."},
                {"role": "user", "content": ui_extraction_prompt}
            ]
            
            # Debug: Log what's being sent to LLM
            logger.info(f"UI Extraction - Content length: {len(content)} characters")
            logger.info(f"UI Extraction - Content preview: {content[:300]}...")
            
            response = self._call_openai_api(
                messages=messages,
                max_tokens=2000
            )
            
            # Debug: Log what's received from LLM
            if response.success:
                logger.info(f"UI Extraction - LLM Response: {response.data}")
            else:
                logger.error(f"UI Extraction - LLM Error: {response.error_message}")
            
            if not response.success:
                logger.error(f"Failed to extract UI data: {response.error_message}")
                return None
            
            ui_data = response.data
            
            # Validate required fields
            required_fields = ["job_title", "job_location", "job_summary", "key_responsibilities", "qualifications"]
            for field in required_fields:
                if field not in ui_data:
                    ui_data[field] = ""
            
            logger.info(f"UI data extracted successfully for {filename}")
            return ui_data
            
        except Exception as e:
            logger.error(f"Failed to extract UI data: {e}")
            return None

# ============================
# ---- Thin helpers / DI  ----
# ============================

_llm_service: Optional[LLMService] = None

def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
