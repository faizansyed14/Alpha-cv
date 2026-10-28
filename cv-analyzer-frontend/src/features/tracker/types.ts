import type { TrackerTeam } from '@/lib/trackerApi';

export type ViewMode = 'jobOpenings' | 'candidateProfiles' | 'followUps' | 'managerSettings';
export type TeamView = TrackerTeam | 'all';
export type ConfirmDeleteType = 'job' | 'candidate' | 'followup';

export const FOLLOW_UP_STAGE_OPTIONS = [
  'Feedback Pending',
  'Interviews Scheduled',
  'Interview Feedback Pending',
  'Rework',
  'Positions Closed',
  'Overdue Follow-ups',
  'Profiles Submitted',
  'Position Cancelled',
  'Hold',
] as const;

export type TextPeekState = {
  title: string;
  text: string;
  canEdit: boolean;
  onSave?: (nextText: string) => Promise<void>;
} | null;

export type ManagerSettingsAddKind =
  | 'recruiter'
  | 'account_manager'
  | 'recruitment_manager'
  | 'requirement'
  | 'job_status'
  | 'candidate_status'
  | 'followup_stage';
