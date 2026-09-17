"""
LLM-based Contextual Matching Service

Provides deep, contextual analysis of CV-JD fit using GPT-4.1-mini: one bulk
request analyzes every top candidate against the same JD at once (see
`analyze_cv_jd_fit_bulk`), returning exact matched/missing skill names, an
overall fit level, and a summary per candidate.
"""

import json
import logging
from typing import Dict, List, Optional

from app.services.ai.llm_service import get_llm_service

logger = logging.getLogger(__name__)

class LLMMatchingService:
    """
    LLM-powered contextual matching for detailed CV-JD analysis.
    
    Provides:
    - Matched skills breakdown
    - Missing skills identification
    - Extra bonus skills
    - Responsibility alignment analysis
    - Overall fit summary
    - Red flags detection
    """
    
    def __init__(self):
        self.llm_service = get_llm_service()
        self.model = "gpt-4.1-mini-2025-04-14"
        
    def _normalize_analysis(self, analysis: dict) -> dict:
        """Validate and normalize LLM response."""
        
        # Ensure all required fields exist
        normalized = {
            "llm_score": float(analysis.get("llm_score", 0)),
            "match_level": analysis.get("match_level", "Unknown"),
            "key_matches": analysis.get("key_matches", analysis.get("matched_skills", [])),
            "gaps": analysis.get("gaps", analysis.get("missing_skills", [])),
            "summary": analysis.get("summary", analysis.get("overall_fit", "Analysis unavailable")),
            "red_flags": analysis.get("red_flags", [])
        }
        
        # Clamp score to 0-100
        normalized["llm_score"] = max(0.0, min(100.0, normalized["llm_score"]))
        
        # Ensure arrays
        for key in ["key_matches", "gaps", "red_flags"]:
            if not isinstance(normalized[key], list):
                if isinstance(normalized[key], str):
                    normalized[key] = [normalized[key]]
                else:
                    normalized[key] = []
        
        return normalized
    
    def _fallback_analysis(self, semantic_score: float) -> dict:
        """Return fallback analysis if LLM fails."""
        return {
            "llm_score": semantic_score,  # Use semantic score as fallback
            "match_level": "Average",
            "key_matches": [],
            "gaps": [],
            "summary": "Detailed analysis could not be completed. Semantic score is based on vector similarity.",
            "red_flags": ["LLM analysis failed - using semantic score only"]
        }

    def analyze_cv_jd_fit_bulk(
        self,
        jd_raw_text: str,
        candidates: List[Dict],
    ) -> List[dict]:
        """
        Analyze all candidates against the same JD in one LLM call (GPT-4.1-mini).
        Each candidate dict must have: cv_id, cv_raw_text, semantic_score (0-100).

        Returns a list of analysis dicts in the same order as candidates.
        On failure or parse error, returns fallback analyses per candidate.
        """
        if not candidates:
            return []
        n = len(candidates)
        try:
            prompt = self._build_bulk_analysis_prompt(jd_raw_text, candidates)
            logger.info(f"📏 Bulk LLM prompt length: {len(prompt)} characters for {n} candidates")
            messages = [
                {"role": "system", "content": "You are an expert technical recruiter. Respond with valid JSON only: a single object with key 'analyses' containing an array of analysis objects, one per candidate, in the exact same order as the candidates (1 to N). No other text."},
                {"role": "user", "content": prompt}
            ]
            # Output: N analyses × ~300 tokens each; allow enough for 50
            max_tokens_bulk = min(32000, 400 * n + 2000)
            # 5 min timeout for bulk (50 CVs): large input + 50 analyses take time
            response = self.llm_service._call_openai_api(
                messages=messages,
                model=self.model,
                max_tokens=max_tokens_bulk,
                json_schema=None,
                timeout=300,
            )
            if not response or not response.success:
                raise Exception(response.error_message if response else "Empty response")
            data = response.data
            if isinstance(data, dict) and "analyses" in data:
                analyses = data["analyses"]
            elif isinstance(data, list):
                analyses = data
            else:
                raise ValueError("Expected JSON object with 'analyses' key or array")
            if len(analyses) != n:
                logger.warning(f"⚠️ Bulk LLM returned {len(analyses)} analyses, expected {n}; padding with fallbacks")
            result = []
            for i, c in enumerate(candidates):
                sem = float(c.get("semantic_score", 0))
                if i < len(analyses) and isinstance(analyses[i], dict):
                    result.append(self._normalize_analysis(analyses[i]))
                else:
                    result.append(self._fallback_analysis(sem))
            logger.info(f"✅ Bulk LLM analysis completed for {len(result)} candidates")
            return result
        except (json.JSONDecodeError, ValueError, Exception) as e:
            logger.error(f"❌ Bulk LLM analysis failed: {e}")
            return [self._fallback_analysis(float(c.get("semantic_score", 0))) for c in candidates]

    def _build_bulk_analysis_prompt(self, jd_raw_text: str, candidates: List[Dict]) -> str:
        """Build one prompt: JD + full CV text for each candidate."""
        jd_block = f"""**JOB DESCRIPTION** (use this for all candidates below):
{jd_raw_text}
"""
        cv_blocks = []
        for i, c in enumerate(candidates, 1):
            raw = (c.get("cv_raw_text") or "").strip()
            sem = c.get("semantic_score", 0)
            cv_id = c.get("cv_id", "")
            cv_blocks.append(f"""
--- CANDIDATE {i} (id={cv_id}, semantic_score={sem:.1f}%) ---
{raw}
""")
        candidates_block = "\n".join(cv_blocks)
        prompt = f"""You are an expert technical recruiter. Analyze each candidate CV against the SAME job description and output one analysis per candidate.

{jd_block}

**CANDIDATES** (analyze each in order 1 to {len(candidates)}):
{candidates_block}

**TASK**: For each candidate (1 to {len(candidates)}), provide:
1. llm_score (0-100): refined match score
2. match_level: one of Strong/Good/Average/Low
3. key_matches: 3-8 EXACT skill/technology/tool/certification names that appear in
   BOTH the job description and this candidate's CV — copy the precise term as it is
   written (e.g. "AWS", "Python", "Kubernetes", "PMP", "React"), not a paraphrase or a
   general statement like "strong cloud experience". One term per item.
4. gaps: 3-8 EXACT skill/technology/tool/requirement names the job description asks
   for that do NOT appear anywhere in this candidate's CV — again the precise term
   (e.g. "Terraform", "Go", "5+ years management experience"), not a vague description.
   One term per item.
5. summary: short paragraph (2-4 sentences) overall fit
6. red_flags: array of strings (optional)

Output a JSON object with one key "analyses" whose value is an array of exactly {len(candidates)} objects, in the same order as the candidates (index 0 = Candidate 1, etc.). Example:
{{ "analyses": [
  {{ "llm_score": 85.5, "match_level": "Strong", "key_matches": ["..."], "gaps": ["..."], "summary": "...", "red_flags": [] }},
  ...
] }}"""
        return prompt


def get_llm_matching_service() -> LLMMatchingService:
    """Get LLM matching service instance."""
    return LLMMatchingService()
