"""Shared "tech stack" keyword extraction, used for both CVs and JDs.

Turns verbose standardized skill sentences (e.g. "5+ years of experience with
AWS cloud infrastructure") into short, clean keyword chips (e.g. "AWS cloud")
suitable for display as tags — without relying on a fixed technology list, so
it works for any domain.
"""

import re
from typing import List, Optional, Sequence

# Words that should not be returned as standalone skill keyword chips.
SKILL_STOPWORDS = frozenset({
    'and', 'or', 'the', 'a', 'an', 'in', 'at', 'for', 'with', 'by', 'to', 'of', 'as', 'on',
    'is', 'are', 'be', 'will', 'we', 'you', 'your', 'our', 'using', 'use', 'used', 'strong',
    'good', 'excellent', 'ability', 'skills', 'skill', 'knowledge', 'understanding', 'including',
    'etc', 'experience', 'experienced', 'years', 'year', 'work', 'working', 'various', 'multiple',
    'including', 'such', 'other', 'across', 'within', 'related', 'hands', 'hands-on', 'proficient',
    'proficiency', 'expertise', 'familiar', 'familiarity', 'develop', 'development', 'developing',
    'design', 'designing', 'management', 'managing', 'manage', 'building', 'build', 'support',
})


def extract_skill_keywords(skills: Optional[Sequence[str]], limit: int = 12) -> List[str]:
    """
    Turn standardized skill sentences into short, role-agnostic keyword chips
    (e.g. "Python backend", "AWS cloud"). Keeps the first 1-2 meaningful words
    of each skill, de-duplicated, capped at `limit`. Works for any CV or JD
    because it only relies on stopword removal, not a fixed tech list.
    """
    seen = set()
    keywords: List[str] = []
    for raw in (skills or []):
        text = re.sub(r'[^\w\s+#.-]', ' ', str(raw)).strip()
        words = [w for w in text.split() if w]
        if not words:
            continue
        if len(words) <= 2:
            phrase = ' '.join(words)
        else:
            meaningful = [w for w in words if w.lower() not in SKILL_STOPWORDS]
            phrase = ' '.join(meaningful[:2]) if meaningful else ' '.join(words[:2])
        phrase = phrase.strip()
        key = phrase.lower()
        if not phrase or len(phrase) < 2 or key in seen or key in SKILL_STOPWORDS:
            continue
        seen.add(key)
        keywords.append(phrase)
        if len(keywords) >= limit:
            break
    return keywords
