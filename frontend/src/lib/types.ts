
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
    has_experience_embedding: boolean;
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
    has_experience_embedding: boolean;
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
  limit?: number;
  offset?: number;
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
  role: 'admin' | 'user';
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
  role: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager';
  is_active: boolean;
  team_location?: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager';
  is_active: boolean;
  email?: string;
  otp_mode?: 'real' | 'captcha';
  team_location?: string | null;
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
  email?: string;  // Required for non-admin users
  role: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager';
  otp_mode?: 'real' | 'captcha';
  team_location?: string | null;
}

export interface UpdateUserRequest {
  password?: string;
  email?: string;
  role?: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager';
  is_active?: boolean;
  otp_mode?: 'real' | 'captcha';
  team_location?: string | null;
}

// Candidate Tracker types
export interface TrackerJobOpening {
  id: string;
  title: string;
  requirement?: string | null;
  department?: string | null;
  client?: string | null;
  status: string;
  hiring_manager?: string | null;
  recruitment_manager?: string | null;
  req_date?: string | null;
  submission_date?: string | null;
  cvs_submitted_count?: number | null;
  comments?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerCandidate {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerApplication {
  id: string;
  candidate_id: string;
  job_opening_id: string;
  applied_date?: string | null;
  position?: string | null;
  client?: string | null;
  status: string;
  recruiter?: string | null;
  account_manager?: string | null;
  recruitment_manager?: string | null;
  comment?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerCandidateRow {
  candidate: TrackerCandidate;
  application?: TrackerApplication | null;
}

export interface TrackerOption {
  id: string;
  kind: string;
  value: string;
  email?: string | null;
  email_enabled?: boolean;
  is_deleted?: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrackerFollowUp {
  id: string;
  client_name: string;
  position?: string | null;
  recruiter_name?: string | null;
  account_manager?: string | null;
  recruitment_manager?: string | null;
  cv_submitted_date?: string | null;
  current_stage: string;
  last_follow_up_date?: string | null;
  next_follow_up_date?: string | null;
  interview_date?: string | null;
  client_feedback?: string | null;
  interview_feedback?: string | null;
  remarks?: string | null;
  reminder_last_sent_at?: string | null;
  created_at: string;
  updated_at: string;
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
  company_name?: string;
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
  company_name?: string;
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
  cv_source?: 'none' | 'library' | 'uploaded';
  cv_id?: string | null;
  cv_text?: string | null;
  cv_title?: string | null;
}

