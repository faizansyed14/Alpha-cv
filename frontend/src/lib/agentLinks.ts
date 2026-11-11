/**
 * Links from other pages into the Interview questions and LinkedIn post agents.
 *
 * A button on a match result or on a job description opens the agent with the job (and the candidate) already attached and the
 * default request started, so the person lands on the answer instead of on an empty chat. The agent reads the documents itself
 * from the library, as the signed-in user; only ids and display labels travel in the link.
 */
import { STAFF_ROLES } from '@/lib/roles';

/** Every role can open the AI agents. */
const AGENT_ROLES: string[] = ['admin', ...STAFF_ROLES];

export function canUseAgents(role?: string | null): boolean {
  return !!role && AGENT_ROLES.includes(role);
}

export interface AgentPreset {
  jdId: string;
  jdTitle?: string;
  cvId?: string;
  cvTitle?: string;
}

const clip = (s: string | undefined, n: number) => (s || '').trim().slice(0, n);

/** `/agents/interview` for one candidate against the job they were matched to. */
export function interviewHref(p: { jdId: string; cvId: string; jdTitle?: string; cvTitle?: string }): string {
  const q = new URLSearchParams({ jd: p.jdId, cv: p.cvId });
  if (p.jdTitle) q.set('jdt', clip(p.jdTitle, 120));
  if (p.cvTitle) q.set('cvt', clip(p.cvTitle, 120));
  return `/agents/interview?${q.toString()}`;
}

/** `/agents/linkedin` for one job description. */
export function linkedinHref(p: { jdId: string; jdTitle?: string }): string {
  const q = new URLSearchParams({ jd: p.jdId });
  if (p.jdTitle) q.set('jdt', clip(p.jdTitle, 120));
  return `/agents/linkedin?${q.toString()}`;
}

/** What the link attached, or null when the page was opened normally. */
export function readAgentPreset(search: string): AgentPreset | null {
  const q = new URLSearchParams(search);
  const jdId = (q.get('jd') || '').trim();
  if (!jdId || jdId.length > 128) return null;
  const cvId = (q.get('cv') || '').trim();
  return {
    jdId,
    jdTitle: clip(q.get('jdt') || undefined, 120) || undefined,
    cvId: cvId && cvId.length <= 128 ? cvId : undefined,
    cvTitle: clip(q.get('cvt') || undefined, 120) || undefined,
  };
}
