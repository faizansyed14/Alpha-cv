'use client';

import { AgentChatShell } from '@/components/agents/shared/AgentChatShell';
import { InterviewAnswer } from './InterviewAnswer';

/** Interview Question Agent: talks to /api/agents/interview/*. Questions come from the job description, and from a CV too when one is attached. */
export default function InterviewAgentPage() {
  return (
    <AgentChatShell
      agentId="interview"
      title="Interview questions"
      headline="Interview questions for any role"
      blurb="Attach a job description, and a candidate's CV if you have one, then ask."
      heroMarkSrc="/icons/interview.jpg"
      workingSteps={['Reading the job description', 'Choosing what matters most for the role', 'Writing the questions', 'Adding what to listen for']}
      workingStepsWithCv={['Reading the job description', "Reading the candidate's CV", 'Finding strengths and gaps to probe', 'Writing questions for this candidate']}
      renderAnswer={(m, ctx) => <InterviewAnswer message={m} fresh={ctx.fresh} />}
    />
  );
}
