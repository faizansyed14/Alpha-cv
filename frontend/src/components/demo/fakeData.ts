import type { CVListItem, JobPostingListItem } from '@/lib/types';
import type { CandidateCardDisplay } from '@/components/database/CandidateCard';

/** Fictional sample data for the business product tour only. */

export const DEMO_MONTHS = [
  { key: '2026-06', label: 'Jun', count: 4 },
  { key: '2026-07', label: 'Jul', count: 7 },
  { key: '2026-08', label: 'Aug', count: 6 },
  { key: '2026-09', label: 'Sep', count: 11 },
  { key: '2026-10', label: 'Oct', count: 9 },
  { key: '2026-11', label: 'Nov', count: 14 },
];

export const DEMO_APP_SERIES = [2, 5, 3, 8, 4, 6, 9, 7, 5, 11, 8, 6, 10, 12];
export const DEMO_APP_DAYS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(2026, 10, 9);
  d.setDate(d.getDate() - (13 - i));
  return d.toISOString().slice(0, 10);
});

function cv(
  id: string,
  name: string,
  title: string,
  years: string,
  skills: string[],
  location: string,
  extras: Partial<CVListItem> = {},
): CVListItem {
  return {
    id,
    filename: `${name.replace(/\s+/g, '_').toLowerCase()}_cv.pdf`,
    upload_date: '2026-10-12T10:00:00Z',
    has_structured_data: true,
    full_name: name,
    job_title: title,
    years_of_experience: years,
    skills_count: skills.length,
    skills,
    skill_keywords: skills.slice(0, 4),
    responsibilities_count: 8,
    text_length: 4200,
    category: 'Design',
    email: `${name.split(' ')[0].toLowerCase()}.demo@example.com`,
    phone: '+971 50 000 0000',
    location,
    nationality: 'UAE',
    languages: ['English', 'Arabic'],
    certifications: ['Google UX Certificate'],
    linkedin_url: 'https://linkedin.com/in/demo',
    github_url: null,
    gender: null,
    expected_salary: 'AED 22,000',
    ...extras,
  };
}

export const DEMO_CVS: CVListItem[] = [
  cv('demo-cv-1', 'Nora Rahman', 'Product Designer', '6', ['Figma', 'Research', 'Design Systems', 'Prototyping', 'Workshops'], 'Dubai'),
  cv('demo-cv-2', 'James Lee', 'UX Designer', '5', ['Prototyping', 'User Research', 'Wireframes', 'FigJam'], 'Abu Dhabi'),
  cv('demo-cv-3', 'Sara Khan', 'UI Designer', '4', ['Design Systems', 'UI Craft', 'Accessibility', 'Figma'], 'Sharjah'),
  cv('demo-cv-4', 'Omar Hassan', 'Product Designer', '8', ['Mobile', 'Web', 'Product Thinking', 'Workshops'], 'Dubai'),
];

export const DEMO_PROFILE = {
  name: 'Nora Rahman',
  title: 'Product Designer',
  category: 'Design',
  filename: 'nora_rahman_cv.pdf',
  years: '6',
  salary: 'AED 22,000',
  location: 'Dubai',
  nationality: 'UAE',
  languages: ['English', 'Arabic'],
  gender: 'Female',
  email: 'nora.demo@example.com',
  phone: '+971 50 000 0000',
  linkedin: 'linkedin.com/in/nora-demo',
  keywords: ['Figma', 'Research', 'Design Systems', 'Prototyping'],
  skills: [
    'End to end product design for web and mobile',
    'Design systems and component libraries',
    'User research and usability testing',
    'Stakeholder workshops and facilitation',
  ],
  responsibilities: [
    'Led redesign of customer onboarding for a fintech product',
    'Partnered with engineering on discovery and delivery',
    'Grew a shared design system used by three product teams',
  ],
  cvLines: [
    'NORA RAHMAN',
    'Product Designer  |  Dubai, UAE',
    'nora.demo@example.com  |  +971 50 000 0000',
    '',
    'SUMMARY',
    'Product designer with 6 years building digital products for enterprise',
    'and consumer teams. Strong in research, systems, and facilitation.',
    '',
    'EXPERIENCE',
    'Senior Product Designer  ·  Northwind Labs  ·  2022 to Present',
    '• Led onboarding redesign that lifted activation by 18%',
    '• Owned the design system used across web and mobile',
    '',
    'Product Designer  ·  Cedar Soft  ·  2019 to 2022',
    '• Shipped B2B dashboards with engineering partners',
    '',
    'SKILLS',
    'Figma · Research · Design Systems · Prototyping · Workshops',
  ],
};

export function demoDisplay(c: CVListItem): CandidateCardDisplay {
  return {
    name: c.full_name,
    title: c.job_title,
    years: c.years_of_experience,
    skillsCount: c.skills_count,
    category: c.category || 'Design',
    filename: c.filename,
    expectedSalary: c.expected_salary || 'AED 22,000',
    appliedJob: null,
    isApplication: false,
    matchScore: null,
    isTopForJob: false,
    matchRank: null,
    skillKeywords: c.skill_keywords || [],
    skills: c.skills,
    email: c.email || null,
    phone: c.phone || null,
    linkedin: c.linkedin_url || null,
    github: null,
    gender: null,
    languages: c.languages || [],
    certifications: c.certifications || [],
    location: c.location || null,
    nationality: c.nationality || null,
  };
}

export const DEMO_JOB: JobPostingListItem = {
  job_id: 'demo-job-1',
  job_title: 'Senior Product Designer',
  job_location: 'Dubai, UAE',
  job_summary: 'Shape digital products for enterprise clients across the UAE.',
  key_responsibilities:
    'Lead end to end product design for web and mobile\nPartner with engineering and product on discovery\nBuild and evolve a scalable design system\nPresent concepts clearly to stakeholders',
  qualifications:
    '5+ years product design experience\nStrong Figma and systems thinking\nPortfolio of shipped digital products',
  filename: 'senior_product_designer.pdf',
  upload_date: '2026-11-09T09:00:00Z',
  is_active: true,
  application_count: 48,
  public_token: 'senior-product-designer-demo',
  posted_by_user: 'Aisha Demo',
  posted_by_role: 'recruiter',
  can_edit: true,
  can_delete: true,
  email_subject_template: 'AlphaData Senior Product Designer PMA-2026-001',
  boolean_search_string: '("Product Designer") AND (Figma OR "Design System")',
};

export const DEMO_APPLICANTS = [
  { name: 'Nora Rahman', email: 'nora.demo@example.com', location: 'Dubai', years: '6 yrs', salary: 'AED 22,000', score: 92, date: '8 Nov 2026' },
  { name: 'James Lee', email: 'james.demo@example.com', location: 'Abu Dhabi', years: '5 yrs', salary: 'AED 18,500', score: 87, date: '7 Nov 2026' },
  { name: 'Omar Hassan', email: 'omar.demo@example.com', location: 'Dubai', years: '8 yrs', salary: 'AED 25,000', score: 81, date: '6 Nov 2026' },
  { name: 'Sara Khan', email: 'sara.demo@example.com', location: 'Sharjah', years: '4 yrs', salary: 'AED 16,000', score: 74, date: '5 Nov 2026' },
];

export const DEMO_LLM = {
  match_level: 'Strong',
  recommendation: 'Shortlist',
  key_matches: ['Figma', 'Design Systems', 'User Research', 'Prototyping'],
  gaps: ['Enterprise SaaS domain depth', 'Arabic fluency for workshops'],
  strengths: [
    'Clear ownership of design systems across teams',
    'Strong research to delivery loop on onboarding work',
    'Comfortable facilitating with product and engineering',
  ],
  experience_analysis: 'Six years of relevant product design with recent senior scope.',
  responsibility_alignment: 'Maps well to end to end ownership and systems work in the JD.',
  education_certifications: 'Google UX Certificate noted. Degree not required for this role.',
  language_fit: 'English is strong. Arabic conversational for UAE stakeholder work.',
  summary:
    'Nora is a strong fit for Senior Product Designer. Systems craft and research depth cover the core of the role. Check enterprise SaaS exposure in interview and confirm workshop language needs.',
  red_flags: ['Limited explicit enterprise SaaS case studies on the CV'],
};

export const TOUR_NAV = [
  { id: 'dashboard', label: 'Dashboard', section: 'Recruiting' },
  { id: 'candidates', label: 'Candidates', section: 'Recruiting' },
  { id: 'jobs', label: 'Job descriptions', section: 'Recruiting' },
  { id: 'match', label: 'Match', section: 'Recruiting' },
  { id: 'upload', label: 'Upload', section: 'Recruiting' },
  { id: 'careers', label: 'Careers', section: 'Hiring' },
] as const;

export type TourScene =
  | 'dashboard'
  | 'candidates'
  | 'profile'
  | 'cv'
  | 'matchSetup'
  | 'matching'
  | 'results'
  | 'jdUpload'
  | 'jdLlm'
  | 'jdEdit'
  | 'jobLive'
  | 'publicJob'
  | 'applyUpload'
  | 'applyFill'
  | 'applySubmit'
  | 'applicants'
  | 'outro';

export const DEMO_CATEGORIES = [
  { value: 'Design', label: 'Design', count: 186 },
  { value: 'Engineering', label: 'Engineering', count: 412 },
  { value: 'Product', label: 'Product', count: 98 },
  { value: 'Sales', label: 'Sales', count: 154 },
  { value: 'Finance', label: 'Finance', count: 67 },
];

export const DEMO_JD_OPTIONS = [
  { id: 'demo-job-1', title: 'Senior Product Designer' },
  { id: 'demo-job-2', title: 'Frontend Engineer' },
  { id: 'demo-job-3', title: 'Product Manager' },
];
