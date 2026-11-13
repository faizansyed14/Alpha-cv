import type { ComponentType } from 'react';
import {
  Activity, Bug, ClipboardList, Cpu, FileText, ImageIcon, Globe2, LayoutDashboard, Megaphone, MessageSquare, Shield, Target, Upload, Users,
} from '@/components/icons';
import type { Role } from '@/lib/roles';
import type { WorkspaceId } from '@/lib/navigation';

export type NavSection = 'Tracker' | 'Recruiting' | 'Hiring' | 'AI agents' | 'Administration' | 'Support';

export interface NavItem {
  id: WorkspaceId | string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  section: NavSection;
}

export const NAV_SECTIONS: NavSection[] = ['Recruiting', 'Tracker', 'Hiring', 'AI agents', 'Administration', 'Support'];

/** The side navigation for a role. Every role sees the same application; the admin also sees the administration pages. */
export function getNavigationTabs(role?: Role): NavItem[] {
  // The tracker has its own left navigation inside it (requirements, closures, analytics); what each role sees there differs
  const tracker: NavItem = { id: 'tracker', label: 'Tracker', icon: ClipboardList, description: 'Requirements, closures and analytics', section: 'Tracker' };
  const tabs: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview and quick actions', section: 'Recruiting' },
    { id: 'candidates', label: 'Candidates', icon: Users, description: 'Browse and select CVs', section: 'Recruiting' },
    { id: 'jobs', label: 'Job descriptions', icon: FileText, description: 'Browse and select a JD', section: 'Recruiting' },
    { id: 'match', label: 'Match', icon: Target, description: 'AI matching results', section: 'Recruiting' },
    { id: 'upload', label: 'Upload', icon: Upload, description: 'Upload documents', section: 'Recruiting' },
    tracker,
    { id: 'careers', label: 'Careers', icon: Globe2, description: 'Job postings, applicants and database matches', section: 'Hiring' },
    { id: 'agent-interview', label: 'Interview questions', icon: MessageSquare, description: 'AI agent: interview questions for a job', section: 'AI agents' },
    { id: 'agent-linkedin', label: 'LinkedIn post', icon: Megaphone, description: 'AI agent: a LinkedIn post for a job', section: 'AI agents' },
    { id: 'agent-hiring-image', label: 'Hiring image', icon: ImageIcon, description: 'A ready-to-post We are hiring picture for a role', section: 'AI agents' },
  ];
  if (role === 'admin') {
    tabs.push({ id: 'admin', label: 'Users', icon: Shield, description: 'Accounts and roles', section: 'Administration' });
    tabs.push({ id: 'monitor', label: 'Monitor', icon: Activity, description: 'Model calls, matching flow and system health', section: 'Administration' });
    tabs.push({ id: 'agent-usage', label: 'Agent usage', icon: Cpu, description: 'AI token use per person, with reset', section: 'Administration' });
    tabs.push({ id: 'admin-bugs', label: 'Bug reports', icon: Bug, description: 'What users reported, with status and replies', section: 'Administration' });
  }
  tabs.push({ id: 'report-bug', label: 'Report a bug', icon: Bug, description: 'Tell us something is not working', section: 'Support' });
  return tabs;
}
