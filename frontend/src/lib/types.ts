import type { Role } from './roles';

// Base types
export interface BaseDocument {
  id: string;
  filename: string;
  upload_date: string;
  has_structured_data: boolean;
}

// CV types
/** Advanced CV search (POST /api/cv/search/advanced). */
export interface CVAdvancedSearchParams {
  /** Words or phrases searched across the whole CV, ignoring case. */
  keywords?: string[];
  /** true: every keyword must match. false: any keyword, best matches first. */
  match_all?: boolean;
  experience_min?: number;
  experience_max?: number;
  locations?: string[];
  nationalities?: string[];
  /** Any of these languages (exact match on CV languages). */
  languages?: string[];
  /** A pasted boolean string, e.g. ("Cloud Engineer") AND ("Azure" OR "AWS") NOT intern. */
  boolean_query?: string;
  /** Freshness: only CVs added to the system in the last N days, or within a date range (YYYY-MM-DD). */
  added_within_days?: number;
  added_from?: string;
  added_to?: string;
  /** Only CVs in any of these categories (folders). */
  categories?: string[];
  /** Only CVs that have (or have no) HR notes. */
  notes?: 'with' | 'without';
  limit?: number;
  cursor?: string | null;
}

export interface CVSearchResult extends CVListItem {
  /** The searched keywords this CV matched, as typed. */
  matched_keywords?: string[];
}

export interface CVAdvancedSearchResponse {
  results: CVSearchResult[];
  next_cursor: string | null;
  count: number;
  /** CVs matching the search (sent with the first page only). */
  total?: number | null;
  /** True when a phrase keyword makes `total` an upper bound. */
  total_is_estimate?: boolean;
}

export interface CVListItem extends BaseDocument {
  full_name: string;
  job_title: string;
  years_of_experience: string;
  skills_count: number;
  skills: string[];
  /** Short skill keyword chips extracted from standardized skills (e.g. "Python", "AWS"). */
  skill_keywords?: string[];
  responsibilities_count: number;
  text_length: number;
  category?: string;
  /** True for CVs submitted via Careers job applications */
  is_job_application?: boolean;
  /** Careers job id (UUID) if this CV is an application */
  applied_job_id?: string | null;
  /** Careers job title if this CV is an application */
  applied_job_title?: string | null;
  /** Persisted match score (0..1) for the job this candidate applied to */
  match_score?: number | null;
  /** True if this candidate has the highest score among applicants for its job */
  is_top_for_job?: boolean;
  /** 1-based rank among applicants for its job (1 = best) */
  match_rank?: number | null;
  /** Convenience: expected salary surfaced for application CVs */
  job_application?: { expected_salary?: string | number | null } | null;
  expected_salary?: string | number | null;
  /** Candidate's current location, collected on the careers apply form (application CVs only) */
  location?: string | null;
  /** Candidate's notice period, collected on the careers apply form (application CVs only) */
  notice_period?: string | null;
  /** Candidate's nationality, collected on the careers apply form (application CVs only) */
  nationality?: string | null;
  /** Candidate contact (from CV PII / careers apply form) */
  email?: string | null;
  phone?: string | null;
  /** Profile links read from the CV (clean https links) */
  linkedin_url?: string | null;
  github_url?: string | null;
  /** LLM-inferred gender when stated/clear from CV; otherwise null */
  gender?: string | null;
  /** Languages explicitly listed on the CV */
  languages?: string[];
  /** Certifications and licences stated on the CV (full names) */
  certifications?: string[];
  /** Keyword-search: which of the searched keywords this CV matched */
  matched_keywords?: string[];
  matched_count?: number;
}

/** Admin-published login notice popup. */
export interface NoticeData {
  id: string;
  message: string;
  active: boolean;
  updated_at: string;
  updated_by?: string | null;
}

export interface CVDataResponse {
  id: string;
  filename: string;
  upload_date: string;
  document_type: "cv";
  candidate: {
    full_name: string;
    job_title: string;
    years_of_experience: string;
    skills: string[];
    responsibilities: string[];
    skills_count: number;
    responsibilities_count: number;
    contact_info?: Record<string, any>;
    /** Profile links read from the CV (clean https links) */
    linkedin_url?: string | null;
    github_url?: string | null;
    email?: string | null;
    phone?: string | null;
    expected_salary?: number | string | null;
    gender?: string | null;
    languages?: string[];
    certifications?: string[];
  };
  text_info: {
    extracted_text_length: number;
    extracted_text_preview: string;
  };
  embeddings_info: {
    skills_embeddings: number;
    responsibilities_embeddings: number;
    has_title_embedding: boolean;
    embedding_dimension: number;
  };
  structured_info: any;
  processing_metadata: any;
}

// JD types
export interface JDListItem extends BaseDocument {
  job_title: string;
  years_of_experience: string;
  skills_count: number;
  skills: string[];
  /** Short skill keyword chips extracted from standardized skills (e.g. "Python", "AWS"). */
  skill_keywords?: string[];
  responsibilities_count: number;
  text_length: number;
}

export interface JDDataResponse {
  id: string;
  filename: string;
  upload_date: string;
  document_type: "jd";
  job_requirements: {
    job_title: string;
    years_of_experience: string;
    skills: string[];
    responsibilities: string[];
    skills_count: number;
    responsibilities_count: number;
  };
  text_info: {
    extracted_text_length: number;
    extracted_text_preview: string;
  };
  embeddings_info: {
    skills_embeddings: number;
    responsibilities_embeddings: number;
    has_title_embedding: boolean;
    embedding_dimension: number;
  };
  structured_info: any;
  processing_metadata: any;
}

// API Response types
export interface CVListResponse {
  status: string;
  count: number;
  cvs: CVListItem[];
  /** Present when using pagination (limit/offset) */
  total?: number;
  /** True when the real total is larger than `total` (a search counts only up to a cap). */
  total_is_estimate?: boolean;
  limit?: number;
  offset?: number;
  /** Send it back as `cursor` to get the next page; null on the last page. */
  next_cursor?: string | null;
}

export interface JDListResponse {
  status: string;
  count: number;
  jds: JDListItem[];
  /** Present when using pagination (limit/offset) */
  total?: number;
  limit?: number;
  offset?: number;
}

export interface UploadResponse {
  status: string;
  message: string;
  cv_id?: string;
  jd_id?: string;
  filename: string;
  standardized_data: any;
  processing_stats: {
    text_length: number;
    skills_count: number;
    responsibilities_count: number;
    embeddings_generated: number;
  };
}

// Matching types
export interface MatchWeights {
  skills: number;
  responsibilities: number;
  job_title: number;
  experience: number;
}

export interface MatchRequest {
  jd_id?: string;
  jd_text?: string;
  cv_ids?: string[];
  weights?: MatchWeights;
  top_alternatives?: number;
}

export interface AssignmentItem {
  type: "skill" | "responsibility";
  jd_index: number;
  jd_item: string;
  cv_index: number;
  cv_item: string;
  score: number;
}

export interface AlternativesItem {
  jd_index: number;
  items: {
    cv_index: number;
    cv_item: string;
    score: number;
  }[];
}

export interface CandidateBreakdown {
  cv_id: string;
  cv_name: string;
  cv_job_title: string;
  cv_years: number;
  /** Candidate contact details for recruiter outreach (email / call / WhatsApp) */
  cv_email?: string;
  cv_phone?: string;
  cv_linkedin?: string | null;
  cv_github?: string | null;
  /** The job's mandatory / preferred languages and certifications vs this CV (status: met | missing | unknown) */
  requirements?: { type: 'language' | 'certification'; name: string; mandatory: boolean; status: 'met' | 'missing' | 'unknown' }[];
  expected_salary?: number;
  skills_score: number;
  responsibilities_score: number;
  job_title_score: number;
  years_score: number;
  overall_score: number;
  /** Added when LLM enhancement is enabled server-side */
  has_llm_analysis?: boolean;
  /** Stored semantic score before LLM adjustment (server may attach dynamically) */
  semantic_score?: number;
  /** Arbitrary LLM analysis payload */
  llm_analysis?: any;
  skills_assignments: AssignmentItem[];
  responsibilities_assignments: AssignmentItem[];
  skills_alternatives: AlternativesItem[];
  responsibilities_alternatives: AlternativesItem[];
}

export interface MatchResponse {
  // Queue status fields
  is_queued?: boolean;
  job_id?: string | null;
  status?: 'queued' | 'processing' | 'completed' | 'failed' | null;
  progress?: {
    status?: string;
    phase?: 'scoring' | 'llm_verification' | 'llm_enhancement' | 'finalizing' | string;
    progress_percent?: number;
    total_candidates?: number;
    processed_candidates?: number;
    current_chunk?: number;
    total_chunks?: number;
    results_so_far?: number;
    /** Name of the CV whose score was just computed (live). */
    current_candidate?: string | null;
    /** Most-recently-scored candidates, newest first. */
    recent?: { cv_id: string; cv_name: string }[];
    llm_total?: number;
    llm_done?: number;
  } | null;
  queue_position?: number | null;
  estimated_wait_time?: number | null; // seconds
  message?: string | null;
  jd_id: string;
  jd_job_title: string;
  jd_years: number;
  normalized_weights: MatchWeights;
  candidates: CandidateBreakdown[];
}

// System types
export interface HealthResponse {
  status: string;
  timestamp: number;
  services: {
    qdrant: any;
    embedding: any;
    cache: any;
  };
  environment: {
    openai_key_configured: boolean;
    qdrant_host: string;
    qdrant_port: string;
  };
}

export interface SystemStatsResponse {
  status: string;
  stats: {
    database_stats: {
      total_cvs: number;
      total_jds: number;
      total_documents: number;
    };
    cv_analytics: {
      total_cvs: number;
      avg_skills_per_cv: number;
      max_skills_per_cv: number;
      min_skills_per_cv: number;
    };
    jd_analytics: {
      total_jds: number;
      avg_skills_per_jd: number;
      max_skills_per_jd: number;
      min_skills_per_jd: number;
    };
    cache_stats: any;
    system_info: {
      embedding_model: string;
      embedding_dimension: number;
      llm_model: string;
      similarity_metric: string;
    };
  };
  timestamp: number;
}

export interface DatabaseViewResponse {
  success: boolean;
  data: {
    cvs: any[];
    jds: any[];
    summary: {
      total_documents: number;
      total_cvs: number;
      total_jds: number;
      avg_cv_skills: number;
      avg_jd_skills: number;
      ready_for_matching: boolean;
    };
  };
  timestamp: number;
}

// Auth types

export interface LoginResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: Role;
}

export interface VerifyPasswordResponse {
  success: boolean;
  requires_otp: boolean;  // True for regular users, False for admin
  message: string;
  /** Second factor the client should present: "none" (admin), "otp" (email), or "captcha". */
  auth_mode?: 'none' | 'otp' | 'captcha';
}

export interface CaptchaResponse {
  success: boolean;
  captcha_id: string;
  image: string;       // data:image/png;base64,...
  expires_in: number;
  dev_code?: string;   // dev only
}

export interface OTPResponse {
  message: string;
  success: boolean;
  masked_email?: string;  // Masked email for display (e.g., "syed****@example.com")
  dev_otp?: string;       // dev only
}

export interface UserProfile {
  id: string;
  username: string;
  role: Role;
  is_active: boolean;
  /** Dubai or Abu Dhabi; empty for the EVP and the admin, who see every location */
  location?: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  role: Role;
  is_active: boolean;
  email?: string;
  otp_mode?: 'real' | 'captcha';
  location?: string | null;
}

export interface UserPresence {
  online: boolean;
  /** Unix epoch seconds of last authenticated request, or null. */
  last_seen: number | null;
}

export interface UsersPresenceResponse {
  ttl_seconds: number;
  server_time: number;
  users: Record<string, UserPresence>;
  online: string[];
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email: string;   // what the person signs in with
  role: Role;
  otp_mode?: 'real' | 'captcha';
  /** Required for recruiters, recruitment managers and sales managers; chosen once, here */
  location?: string;
}

export interface UpdateUserRequest {
  password?: string;
  email?: string;
  role?: Role;
  is_active?: boolean;
  otp_mode?: 'real' | 'captcha';
  /** Only for an account that has no location yet; it cannot be changed afterwards */
  location?: string;
}

// ----- Requirements tracker
export type RequirementStatus = 'open' | 'submitted' | 'hold' | 'closed' | 'canceled';

export interface Requirement {
  id: string;
  /** Which team's it is (Dubai or Abu Dhabi). Nobody types it and the page does not show it; empty until a recruiter is assigned to a requirement the EVP or admin added. */
  location: string | null;
  requirement_date: string;          // yyyy-mm-dd
  position: string;
  client: string;
  /** Where the job is, and the salary, as typed (both optional) */
  job_location: string | null;
  salary: string | null;
  /** How long the job lasts: nothing chosen, full time, or a fixed number of days, months or years (which may or may not be extended) */
  duration_type: 'full_time' | 'fixed' | null;
  duration_value: number | null;
  duration_unit: 'days' | 'months' | 'years' | null;
  duration_extendable: boolean | null;
  jd_id: string | null;
  jd_filename: string | null;
  /** Not sent to recruiters */
  sales_comments: string | null;
  rm_comments: string | null;
  recruiter_comments: string | null;
  cv_submission_date: string | null;
  /** What the recruiter has submitted: the day, and how many CVs */
  cvs_submitted_date: string | null;
  cvs_submitted_count: number | null;
  /** The lead recruiter: the first of the recruiters, credited when the requirement is closed */
  recruiter: { id: string; username: string } | null;
  /** Every recruiter assigned, the lead first, each with their own CVs submitted (a recruiter sees only their own numbers) */
  recruiters: Array<{ id: string; username: string; cvs_submitted_date: string | null; cvs_submitted_count: number | null }>;
  /** The recruitment manager and the sales manager the requirement is assigned to (null: nobody chosen) */
  manager: { id: string; username: string } | null;
  sales_manager: { id: string; username: string } | null;
  status: RequirementStatus;
  /** The job posted in Careers from this requirement's job description */
  job_id: string | null;
  /** Set while the requirement is closed: when, by whom, and how many days after the requirement date */
  closed_at: string | null;
  closed_by: string | null;
  days_to_close: number | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface ClosuresPage {
  items: Requirement[];
  total: number;
  /** The years that have closures, newest first (for the Year dropdown, whatever the filters are) */
  years: number[];
  summary: { closed: number; closed_this_month: number; avg_days: number | null };
}

export type AnalyticsView = 'monthly' | 'yearly';

export interface RecruiterPerformance {
  id: string | null;
  username: string;
  location: string | null;
  closed: number;
  avg_days: number | null;
  /** CVs this recruiter submitted in the period */
  cvs_submitted: number;
  open: number;
  submitted: number;
  hold: number;
  canceled: number;
  last_closed: string | null;
}

/** One location's numbers, for the EVP and the admin looking at Dubai and Abu Dhabi side by side */
export interface LocationPerformance {
  location: string | null;
  recruiters: number;
  received: number;
  closed: number;
  previous_closed: number;
  avg_days: number | null;
  cvs_submitted: number;
  active: number;
  open: number;
  submitted: number;
  hold: number;
  canceled: number;
  overdue: number;
}

export interface TrackerAnalytics {
  view: AnalyticsView;
  year: number;
  /** 1 to 12 in the monthly view, null in the yearly one */
  month: number | null;
  /** "March 2026" or "2026" */
  label: string;
  /** The one location asked for (EVP and admin only); null for everything they can see */
  location: string | null;
  /** "own" for a recruiter (their numbers only), "team" for everyone else */
  scope: 'own' | 'team';
  summary: {
    /** Requirements that came in during the period, and in the one before */
    received: number;
    previous_received: number;
    closed: number;
    previous_closed: number;
    /** The month or year it is compared with: "February 2026" or "2025" */
    previous_label: string;
    avg_days: number | null;
    median_days: number | null;
    cvs_submitted: number;
    active: { open: number; submitted: number; hold: number };
    active_total: number;
    canceled: number;
    /** Open or on-hold requirements whose submission deadline has passed */
    overdue: number;
  };
  /** Received and closed per day of the month (monthly) or per month of the year (yearly) */
  series: Array<{ key: string; label: string; closed: number; received: number }>;
  years: number[];
  /** Dubai and Abu Dhabi side by side: only for the EVP and the admin looking at both */
  locations: LocationPerformance[];
  recruiters: RecruiterPerformance[];
  clients: Array<{ client: string; closed: number; avg_days: number | null }>;
  /** The latest closures in the period: what, for whom and who closed it */
  closures: Array<{ position: string; client: string; recruiter: string; location: string | null; closed_at: string; days: number }>;
}

/** The status counts, and `cvs_submitted`: the CVs submitted added up over every requirement these filters match */
export interface RequirementStats { total: number; open: number; submitted: number; hold: number; closed: number; canceled: number; cvs_submitted: number }
export interface RequirementPage { items: Requirement[]; total: number; stats: RequirementStats }
export interface RequirementEvent { at: string; actor: string; action: 'created' | 'changed'; field: string | null; old: string | null; new: string | null }
export interface RequirementDetail extends Requirement { history: RequirementEvent[] }

export interface TrackerOptions {
  statuses: RequirementStatus[];
  locations: string[];
  /** True for the EVP and the admin: they see both locations and get a Location dropdown */
  all_locations: boolean;
  can_create: boolean;
  /** Which fields this person may change (the others are shown as plain text) */
  editable: Record<'requirement_date' | 'position' | 'client' | 'job_location' | 'salary' | 'duration' | 'cv_submission_date' | 'cvs_submitted' | 'recruiter' | 'recruitment_manager' | 'sales_manager' | 'jd' | 'sales_comments' | 'rm_comments' | 'recruiter_comments' | 'status', boolean>;
  /** The recruiters that can be assigned: those of the person's own location (every recruiter for the EVP and the admin) */
  recruiters: Array<{ id: string; username: string; location: string }>;
  /** The recruitment managers and the sales managers that can be chosen (the same location rule) */
  managers: Array<{ id: string; username: string; location: string }>;
  sales_managers: Array<{ id: string; username: string; location: string }>;
}

// Selections and joining: what became of a closed requirement (managers, EVP and admin only)
export type SelectionStatus = 'offer_pending' | 'offer_released' | 'joined' | 'backed_out';

export interface Selection {
  id: string;
  /** The requirement it came from (made when that requirement was closed) */
  requirement_id: string | null;
  date: string;
  candidate_name: string | null;
  position: string;
  client: string;
  status: SelectionStatus;
  recruiters: Array<{ id: string; username: string }>;
  /** Shown as the Account Manager */
  sales_manager: { id: string; username: string } | null;
  manager: { id: string; username: string } | null;
  comments: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface SelectionStats { total: number; offer_pending: number; offer_released: number; joined: number; backed_out: number }

export interface SelectionPage { items: Selection[]; total: number; stats: SelectionStats }

export interface SelectionOptions {
  statuses: SelectionStatus[];
  locations: string[];
  all_locations: boolean;
  editable: Record<'selection_date' | 'candidate_name' | 'status' | 'comments', boolean>;
  recruiters: Array<{ id: string; username: string; location: string }>;
}

export interface SelectionFilters {
  q?: string;
  status?: SelectionStatus | '';
  location?: string;
  recruiter_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface SelectionInput { selection_date?: string; candidate_name?: string | null; status?: SelectionStatus; comments?: string | null }

export interface RequirementFilters {
  status?: RequirementStatus | '';
  q?: string;
  /** Dubai or Abu Dhabi: only the EVP and the admin can choose (everyone else is held to their own) */
  location?: string;
  recruiter_id?: string;
  /** A recruitment manager or sales manager id, or 'none' for requirements with nobody chosen */
  manager_id?: string;
  sales_manager_id?: string;
  date_from?: string;
  date_to?: string;
}

/** What the sales manager (or a manager) fills in. Only the fields that are present are changed on an update; null clears one. */
export interface RequirementInput {
  requirement_date?: string;
  position?: string;
  client?: string;
  job_location?: string | null;
  salary?: string | null;
  duration_type?: 'full_time' | 'fixed' | null;
  duration_value?: number | null;
  duration_unit?: 'days' | 'months' | 'years' | null;
  duration_extendable?: boolean | null;
  jd_id?: string | null;
  sales_comments?: string | null;
  rm_comments?: string | null;
  recruiter_comments?: string | null;
  cv_submission_date?: string | null;
  /** The recruiters, the first is the lead. Sending the list replaces it. */
  recruiter_ids?: string[];
  /** The recruitment manager and the sales manager (null clears) */
  manager_id?: string | null;
  sales_manager_id?: string | null;
  /** What each recruiter has submitted: only the fields present are changed */
  cvs_submissions?: Array<{ recruiter_id: string; date?: string | null; count?: number | null }>;
  status?: RequirementStatus;
}

// Careers types
export interface JobPostingResponse {
  job_id: string;
  public_link: string;
  public_token: string; // Added this field
  job_title?: string;
  upload_date: string;
  filename: string;
  is_active: boolean;
  posted_by_user?: string;
  posted_by_role?: string;
  // Email integration fields
  email_subject_id?: string;
  email_subject_template?: string;
  // Naukri Gulf Boolean recruiter search string (LLM-generated from the JD)
  boolean_search_string?: string;
}

export interface PublicJobView {
  job_id: string;
  job_title?: string;
  job_location?: string;
  job_description: string;
  upload_date: string;
  requirements?: string[];
  responsibilities?: string[];
  experience_required?: string;
  is_active: boolean;
  posted_by_user?: string;
  posted_by_role?: string;
}

export interface JobApplicationResponse {
  success: boolean;
  application_id: string;
  message: string;
  next_steps?: string;
}

export interface JobPostingListItem {
  job_id: string;
  job_title?: string;
  job_location?: string;
  job_summary?: string;
  key_responsibilities?: string;
  qualifications?: string;
  filename: string;
  upload_date: string;
  is_active: boolean;
  application_count?: number;
  public_token: string; // Already present
  posted_by_user?: string;
  posted_by_role?: string;
  can_edit?: boolean;
  can_delete?: boolean;
  // Email integration fields
  email_subject_id?: string;
  email_subject_template?: string;
  // Naukri Gulf Boolean recruiter search string (LLM-generated from the JD)
  boolean_search_string?: string;
}

/** A candidate found in the database by a job's boolean search string (not an applicant of that job). */
export interface JobDatabaseCandidate {
  id: string;
  filename: string;
  upload_date: string;
  full_name: string;
  job_title: string;
  years_of_experience?: number | string | null;
  category?: string | null;
  skill_keywords: string[];
  location?: string | null;
  nationality?: string | null;
  notice_period?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  /** Set when this person applied to ANOTHER job */
  applied_job_title?: string | null;
  /** The words of the boolean string found in this CV */
  matched_keywords: string[];
}

export interface JobDatabaseCandidatesPage {
  results: JobDatabaseCandidate[];
  next_cursor: string | null;
  count: number;
  total: number | null;
  total_is_estimate: boolean;
  /** The boolean string that was searched, and where it came from */
  boolean_query: string;
  query_source: 'job' | 'custom' | 'generated';
  applicants_excluded: number;
}

export type BugStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type BugSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A bug report as its reporter sees it. */
export interface BugReport {
  id: string;
  title: string;
  description: string;
  steps?: string | null;
  area: string;
  severity: BugSeverity;
  status: BugStatus;
  admin_note?: string | null;
  created_at: string;
  updated_at?: string | null;
  resolved_at?: string | null;
}

/** A bug report as the admin sees it: with who sent it and from where. */
export interface AdminBugReport extends BugReport {
  user_agent?: string | null;
  reporter_username: string;
  reporter_role?: string | null;
  reporter_email?: string | null;
  handled_by?: string | null;
}

export interface BugCreateRequest {
  title: string;
  description: string;
  steps?: string;
  area: string;
  severity: BugSeverity;
}

export type BugCounts = Record<'all' | BugStatus, number>;

/** The dashboard's numbers, counted by the server over every posting. */
export interface CareersOverview {
  postings: { total: number; live: number; closed: number };
  applications: { total: number; days: string[]; series: number[]; last_7_days: number; previous_7_days: number };
  months: { key: string; label: string; count: number }[];
  top_jobs: { job_id: string; job_title: string; posted_by_user?: string | null; is_active: boolean; upload_date?: string; application_count: number }[];
  recent_jobs: { job_id: string; job_title: string; job_location?: string; posted_by_user?: string | null; is_active: boolean; upload_date?: string; application_count: number }[];
}

export interface WeeklyAnalysisReport {
  range: { start_date: string; end_date: string };
  total_jobs_posted: number;
  recruiters_posted: { recruiter: string; jobs_posted: number }[];
  applications_by_recruiter: Record<
    string,
    { job_id: string; job_title: string; applications: number }[]
  >;
}

export interface JobApplicationListItem {
  application_id: string;
  job_id: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone?: string;
  linkedin_url?: string | null;
  github_url?: string | null;
  cv_filename: string;
  application_date: string;
  expected_salary?: number;
  years_of_experience?: number;
  location?: string;
  notice_period?: string;
  nationality?: string;
  match_score?: number;
  status?: string;
  source?: string; // 'website' for applications made on the job page
  // Note fields added by backend
  notes?: any[];
  notes_count?: number;
  has_notes?: boolean;
  latest_note?: any;
  latest_note_text?: string;
  latest_note_author?: string;
  latest_note_date?: string;
}

// Queue management types removed

// Notes Summary types
export interface NotesSummaryItem {
  cv_id: string;
  has_notes: boolean;
  notes_count: number;
  latest_note: any | null;
}

export interface NotesSummaryResponse {
  status: string;
  summaries: NotesSummaryItem[];
  count: number;
}

// ---- AI agents (interview questions, LinkedIn posts) ----
export interface AgentInfo {
  id: string;
  name: string;
  tagline: string;
  examples: string[];
  default_request: string;
  accepts_cv?: boolean;
  max_jd_chars?: number;
  max_message_chars: number;
}

export interface AgentConversationSummary {
  id: string;
  agent: string;
  title: string;
  jd_title: string | null;
  jd_source: string;
  cv_title?: string | null;
  created_at: string;
  last_message_at: string;
  message_count: number;
}

export interface AgentInterviewQuestion {
  category: string;
  difficulty: string;
  question: string;
  listen_for: string;
  follow_up: string;
  based_on?: string;
}

export interface AgentMessageMeta {
  type?: 'interview' | 'linkedin';
  role?: string;
  questions?: AgentInterviewQuestion[];
  post?: string;
  hashtags?: string[];
  chars?: number;
  warnings?: string[];
  /** Clickable follow-ups under a predefined reply */
  suggestions?: string[];
  /** Agentic mode: which specialist answered, what it showed and which tools it used */
  specialist?: string;
  cancelled?: boolean;
  route?: string;
  cards?: AgenticCard[];
  /** A file attached to this message (Agentic mode) */
  attachment?: { filename: string };
  trace?: Array<{ step: number; tool: string; ok: boolean; ms: number; args: Record<string, string> }>;
}

/** A result shown as a card in Agentic mode. Built by the server from application data (never from the model's wording). */
export interface AgenticCard {
  type: string;
  /** What "Show more" asks for next (absent when everything is already on screen) */
  page?: { tool: string; args: Record<string, any>; offset: number; cursor: string | null } | null;
  [key: string]: any;
}

export interface AgenticSkill {
  name: string;
  label: string;
  description: string;
  examples: string[];
}

export interface AgenticCapabilities {
  role: string;
  username: string;
  skills: AgenticSkill[];
  examples: string[];
}

export interface AgentMessage {
  id: string | null;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  status: 'ok' | 'blocked' | 'error';
  blocked_reason: string | null;
  meta: AgentMessageMeta | null;
  model: string | null;
  tokens?: number;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  agent: string;
  title: string;
  jd_id: string | null;
  jd_title: string | null;
  jd_source: string;
  cv_title?: string | null;
  created_at: string;
}

export interface AgentChatResponse {
  conversation: AgentConversation | null;
  user_message: AgentMessage | null;
  assistant_message: AgentMessage;
  usage?: AgentUsage;
}

export interface AgentUsage {
  limit: number;
  used: number;
  remaining: number;
  percent: number;
  calls: number;
  cost_usd: number;
  resets_at: string | null;
  last_reset_at: string | null;
  last_reset_by: string | null;
  reset_request?: AgentResetRequestState | null;
}

export interface AgentResetRequestState {
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface AgentResetRequestRow {
  id: string;
  username: string;
  reason: string;
  requested_at: string;
  used: number;
  limit: number;
  percent: number;
}

export interface AgentResetDecisionRow {
  id: string;
  username: string;
  reason: string;
  requested_at: string;
  decision: 'approved' | 'rejected';
  decided_by: string;
  decided_at: string;
}

export interface AgentResetRequests {
  pending: AgentResetRequestRow[];
  recent: AgentResetDecisionRow[];
}

export interface AgentAdminUsage {
  limit_per_user: number;
  global_limit: number;
  global_used: number;
  users: Array<AgentUsage & { username: string; role: string }>;
}

export interface AgentChatRequest {
  message: string;
  conversation_id?: string | null;
  jd_source?: 'library' | 'pasted' | 'uploaded';
  jd_id?: string | null;
  jd_text?: string | null;
  jd_title?: string | null;
  /** Public careers URL for this posting (LinkedIn Apply Now line). */
  apply_url?: string | null;
  cv_source?: 'none' | 'library' | 'uploaded';
  cv_id?: string | null;
  cv_text?: string | null;
  cv_title?: string | null;
}

