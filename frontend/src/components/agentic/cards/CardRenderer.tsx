'use client';

import { InterviewAnswer } from '@/components/agents/interview/InterviewAnswer';
import { LinkedInAnswer } from '@/components/agents/linkedin/LinkedInAnswer';
import type { AgentMessage, AgenticCard } from '@/lib/types';
import { ActionCard, ActionDoneCard } from './ActionCards';
import { ApplicationsCard, CandidateProfileCard, CandidatesCard } from './CandidatesCard';
import { JobDraftCard, JobPostedCard } from './JobCards';
import { JobDescriptionsCard, JobsCard, TableCard } from './JobsCard';
import { CategoriesCard } from './CategoriesCard';
import { MatchesCard, MatchRunningCard } from './MatchCards';
import { MatchSetupCard, type MatchSelection } from './MatchSetupCard';
import { UploadPromptCard } from './UploadPromptCard';
import { ClosuresCard, RequirementsCard, SelectionsCard } from './TrackerCards';
import type { Send } from './ui';

/** Interview questions and LinkedIn posts reuse the cards of the dedicated chat pages, so they look and copy exactly the same. */
function asMessage(card: AgenticCard, kind: 'interview' | 'linkedin'): AgentMessage {
  return { id: null, seq: 0, role: 'assistant', content: card.content ?? '', status: 'ok', blocked_reason: null, meta: { type: kind, ...(card.meta ?? {}) }, model: null, created_at: new Date().toISOString() };
}

export function CardRenderer({ card, onSend, onSelect, draftActive, fresh, onUpload, uploading }: {
  card: AgenticCard; onSend: Send; onSelect: (text: string, selection: MatchSelection) => void; draftActive: boolean; fresh: boolean; onUpload: (file: File) => void; uploading: boolean;
}) {
  switch (card.type) {
    case 'candidates': return <CandidatesCard card={card} />;
    case 'candidate_profile': return <CandidateProfileCard card={card} />;
    case 'applications': return <ApplicationsCard card={card} />;
    case 'jobs': return <JobsCard card={card} onSend={onSend} />;
    case 'job_descriptions': return <JobDescriptionsCard card={card} onSend={onSend} />;
    case 'requirements': return <RequirementsCard card={card} onSend={onSend} />;
    case 'closures': return <ClosuresCard card={card} onSend={onSend} />;
    case 'selections': return <SelectionsCard card={card} onSend={onSend} />;
    case 'matches': return <MatchesCard card={card} />;
    case 'match_running': return <MatchRunningCard card={card} />;
    case 'action': return <ActionCard card={card} active={draftActive} />;
    case 'action_done': return <ActionDoneCard card={card} />;
    case 'job_draft': return <JobDraftCard card={card} onSend={onSend} active={draftActive} />;
    case 'job_posted': return <JobPostedCard card={card} onSend={onSend} />;
    case 'table': return <TableCard card={card} />;
    case 'categories': return <CategoriesCard card={card} onSend={onSend} active={draftActive} />;
    case 'match_setup': return <MatchSetupCard card={card} onSelect={onSelect} active={draftActive} />;
    case 'upload_prompt': return <UploadPromptCard onUpload={onUpload} active={draftActive} uploading={uploading} />;
    case 'interview': return <InterviewAnswer message={asMessage(card, 'interview')} fresh={fresh} />;
    case 'linkedin': return <LinkedInAnswer message={asMessage(card, 'linkedin')} fresh={fresh} />;
    default: return null;
  }
}
