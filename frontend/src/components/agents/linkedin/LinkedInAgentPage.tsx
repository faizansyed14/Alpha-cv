'use client';

import { AgentChatShell } from '@/components/agents/shared/AgentChatShell';
import { LinkedInAnswer } from './LinkedInAnswer';

/** LinkedIn Job Post Agent: talks to /api/agents/linkedin/*. A post comes only from the job description. */
export default function LinkedInAgentPage() {
  return (
    <AgentChatShell
      agentId="linkedin"
      title="LinkedIn post"
      headline="A LinkedIn post for any job"
      blurb="Attach a job description, then ask for a post. Ask for a different tone or length any time."
      heroMarkSrc="/icons/linkedin.svg"
      workingSteps={['Reading the job description', 'Finding the hook', 'Writing the post', 'Choosing hashtags']}
      renderAnswer={(m, ctx) => <LinkedInAnswer message={m} fresh={ctx.fresh} />}
    />
  );
}
