import { AxiosInstance } from 'axios';
import { logger } from '../logger';
import { createAxiosClient } from './httpClient';
import {
  AgentChatRequest,
  AgentChatResponse,
  AgentConversation,
  AgentConversationSummary,
  AgentInfo,
  AgentMessage,
  AgentUsage,
  AgentAdminUsage,
  AgenticCapabilities,
  AgenticCard,
  AgentResetRequests,
  MatchRequest,
  MatchResponse,
  CVListResponse,
  JDListResponse,
  HealthResponse,
  UploadResponse,
  SystemStatsResponse,
  CVDataResponse,
  JDDataResponse,
  DatabaseViewResponse,
  LoginResponse,
  UserProfile,
  VerifyPasswordResponse,
  OTPResponse,
  CaptchaResponse,
  AdminUser,
  CreateUserRequest,
  UpdateUserRequest,
  JobPostingResponse,
  JobPostingListItem,
  PublicJobView,
  JobApplicationResponse,
  JobApplicationListItem,
  JobDatabaseCandidatesPage,
  NotesSummaryResponse,
  WeeklyAnalysisReport,
  CareersOverview,
  BugReport,
  CVListItem,
  AdminBugReport,
  BugCreateRequest,
  BugCounts,
  BugStatus,
  BugSeverity,
  NoticeData,
  UsersPresenceResponse,
  CVAdvancedSearchParams,
  CVAdvancedSearchResponse,
} from '../types';

export class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = createAxiosClient();
  }

  // Health endpoints
  async healthCheck(): Promise<HealthResponse> {
    const response = await this.client.get<HealthResponse>('/api/health');
    return response.data;
  }

  // CV endpoints
  async uploadCV(file: File, cvText?: string): Promise<UploadResponse> {
    const formData = new FormData();

    if (file) {
      formData.append('file', file);
    } else if (cvText) {
      formData.append('cv_text', cvText);
    }

    const response = await this.client.post<UploadResponse>('/api/cv/upload-cv', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  /** Progress of a queued upload (status: processing | completed | failed | not_found). */
  async getCVUploadProgress(cvId: string): Promise<{ status: string; progress_percent?: number; current_step?: string }> {
    const response = await this.client.get(`/api/cv/cv-upload-progress/${cvId}`);
    return response.data;
  }

  async listCVs(params?: { limit?: number; offset?: number; category?: string; q?: string }): Promise<CVListResponse> {
    const response = await this.client.get<CVListResponse>('/api/cv/cvs', {
      // Disable the browser HTTP cache + bust it with _t so switching category/search
      // never serves a stale (wrong-category) response.
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' },
      params: { ...(params ?? {}), _t: Date.now() },
    });
    return response.data;
  }

  /** Only the ids of the most recent CVs (optionally in one category); no contact data. Used to launch a match. */
  async listCVIds(params?: { limit?: number; category?: string; categories?: string[] }): Promise<{ ids: string[]; total: number }> {
    const response = await this.client.get<{ ids: string[]; total: number }>('/api/cv/cvs', {
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' },
      params: { ...(params ?? {}), ids_only: true, _t: Date.now() },
      // several categories go as repeated ?categories=a&categories=b (what the server reads)
      paramsSerializer: { indexes: null },
    });
    return response.data;
  }

  /** Distinct values + counts for a filterable CV field (location, nationality, notice_period). */
  async getCVSearchFacet(field: 'location' | 'nationality' | 'notice_period' | 'languages'): Promise<{ field: string; values: { value: string; count: number }[] }> {
    const response = await this.client.get(`/api/cv/search/facets/${field}`);
    return response.data;
  }

  /**
   * Advanced CV search: keywords + experience range + location + nationality,
   * evaluated server-side across the whole CV database with cursor-based
   * pagination (pass the previous response's next_cursor back in as `cursor`
   * to fetch the next page, this is what powers infinite scroll).
   */
  async searchCVsAdvanced(params: CVAdvancedSearchParams): Promise<CVAdvancedSearchResponse> {
    const response = await this.client.post('/api/cv/search/advanced', params);
    return response.data;
  }

  // ---- Login notice popup ----
  async getNotice(): Promise<{ notice: NoticeData | null }> {
    const response = await this.client.get('/api/notice', {
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' },
      params: { _t: Date.now() },
    });
    return response.data;
  }
  async getAdminNotice(): Promise<{ notice: NoticeData | null }> {
    const response = await this.client.get('/api/admin/notice', { params: { _t: Date.now() } });
    return response.data;
  }
  async setNotice(message: string, active: boolean): Promise<{ notice: NoticeData | null }> {
    const response = await this.client.put('/api/admin/notice', { message, active });
    return response.data;
  }
  async clearNotice(): Promise<{ notice: NoticeData | null }> {
    const response = await this.client.delete('/api/admin/notice');
    return response.data;
  }

  async getCVDetails(cvId: string): Promise<CVDataResponse> {
    const response = await this.client.get<{ status: string; cv: CVDataResponse }>(`/api/cv/${cvId}`);
    return response.data.cv;
  }

  async deleteCV(cvId: string): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete<{ success: boolean; message: string }>(`/api/cv/${cvId}`);
    return response.data;
  }

  // CV Notes endpoints
  async getCVNotes(cvId: string): Promise<{ status: string; cv_id: string; notes: any[]; notes_count: number }> {
    const response = await this.client.get(`/api/cv/${cvId}/note`);
    return response.data;
  }

  async getNotesSummary(cvIds: string[]): Promise<NotesSummaryResponse> {
    const response = await this.client.post<NotesSummaryResponse>(`/api/cv/notes/summary`, { cv_ids: cvIds });
    return response.data;
  }

  async addOrUpdateNote(cvId: string, note: string, hrUser: string): Promise<{ status: string; message: string; cv_id: string; note: any }> {
    const payload = { note, hr_user: hrUser };
    const response = await this.client.post(`/api/cv/${cvId}/note`, payload);
    return response.data;
  }

  async deleteCVNote(cvId: string, hrUser: string): Promise<{ status: string; message: string; cv_id: string; hr_user: string }> {
    const response = await this.client.delete(`/api/cv/${cvId}/note/${hrUser}`);
    return response.data;
  }

  // JD endpoints
  async uploadJD(file: File, jdText?: string): Promise<UploadResponse> {
    const formData = new FormData();

    if (file) {
      formData.append('file', file);
    } else if (jdText) {
      formData.append('jd_text', jdText);
    }

    const response = await this.client.post<UploadResponse>('/api/jd/upload-jd', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async listJDs(params?: { limit?: number; offset?: number; category?: string; q?: string }): Promise<JDListResponse> {
    const response = await this.client.get<JDListResponse>('/api/jd/jds', {
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' },
      params: { ...(params ?? {}), _t: Date.now() },
    });
    return response.data;
  }

  async getJDDetails(jdId: string): Promise<JDDataResponse> {
    const response = await this.client.get<{ status: string; jd: JDDataResponse }>(`/api/jd/jd/${jdId}`);
    return response.data.jd;
  }

  async deleteJD(jdId: string): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete<{ success: boolean; message: string }>(`/api/jd/jd/${jdId}`);
    return response.data;
  }

  // Two-phase JD upload methods
  async extractJDForUI(jdId: string): Promise<any> {
    const token = localStorage.getItem('auth_token');
    const response = await this.client.post(`/api/careers/admin/jobs/${jdId}/extract-ui-data`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.data;
  }


  async unifiedJobUpdate(
    jdId: string | null,
    jobId: string | null,
    formData: any
  ): Promise<any> {
    // Backend expects form data, not JSON
    const formDataObj = new FormData();

    if (jobId) {
      formDataObj.append('job_id', jobId);
    } else if (jdId) {
      formDataObj.append('jd_id', jdId);
    }

    formDataObj.append('job_title', formData.jobTitle || '');
    formDataObj.append('job_location', formData.jobLocation || '');
    formDataObj.append('job_summary', formData.jobSummary || '');
    formDataObj.append('key_responsibilities', formData.keyResponsibilities || '');
    formDataObj.append('qualifications', formData.qualifications || '');

    const token = localStorage.getItem('auth_token');
    const response = await this.client.post('/api/careers/admin/jobs/unified-update', formDataObj, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': `Bearer ${token}`,
      }
    });
    return response.data;
  }

  // Matching endpoints
  async matchCandidates(request: MatchRequest): Promise<MatchResponse> {
    const token = localStorage.getItem('auth_token');
    const response = await this.client.post<MatchResponse>('/api/match', request, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.data;
  }

  /** State of a queued match (progress while it runs, the full result when done). Never starts a new job. */
  async getMatchJob(jobId: string): Promise<MatchResponse> {
    const response = await this.client.get<MatchResponse>(`/api/match/jobs/${jobId}`);
    return response.data;
  }

  // System endpoints
  async getSystemStats(): Promise<SystemStatsResponse> {
    const response = await this.client.get<SystemStatsResponse>('/api/system-stats');
    return response.data;
  }

  async getDatabaseView(): Promise<DatabaseViewResponse> {
    const response = await this.client.get<DatabaseViewResponse>('/api/database/view');
    return response.data;
  }

  // Download CV by ID
  /** One drawn page of a CV (legacy .doc, RTF, ODT, HTML, text). `pages` is the document's page count. */
  async getCVPreviewPage(cvId: string, page: number): Promise<{ blob: Blob; pages: number }> {
    const response = await this.client.get(`/api/cv/${cvId}/preview`, { params: { page, scale: 1.2 }, responseType: 'blob' });
    return { blob: response.data, pages: Number(response.headers['x-preview-pages'] ?? 1) };
  }

  /** One drawn page of a JD (same as getCVPreviewPage). */
  async getJDPreviewPage(jdId: string, page: number): Promise<{ blob: Blob; pages: number }> {
    const response = await this.client.get(`/api/jd/jd/${jdId}/preview`, { params: { page, scale: 1.2 }, responseType: 'blob' });
    return { blob: response.data, pages: Number(response.headers['x-preview-pages'] ?? 1) };
  }

  async downloadCV(cvId: string): Promise<{ blob: Blob; filename: string }> {
    const response = await this.client.get(`/api/cv/${cvId}/download`, {
      responseType: 'blob',
    });

    // Extract filename from Content-Disposition header
    const contentDisposition = response.headers['content-disposition'];
    let filename = `cv_${cvId}.pdf`; // fallback filename

    if (contentDisposition) {
      // Try different patterns for filename extraction
      const patterns = [
        /filename\*?=['"]?([^'";\r\n]+)['"]?/i,
        /filename=([^;]+)/i,
        /filename\*?=UTF-8''([^;]+)/i
      ];

      for (const pattern of patterns) {
        const match = contentDisposition.match(pattern);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1].trim());
          break;
        }
      }
    }

    // If we still have a generic filename, try to get it from the CV metadata
    if (filename.startsWith('cv_') && filename.includes(cvId)) {
      // We could potentially fetch CV metadata here, but for now use a better fallback
      filename = `CV_${cvId}.pdf`;
    }

    return { blob: response.data, filename };
  }

  /** Authenticated fetch of a stored raw document (cv|jd) via the storage route. */
  async downloadStorageFile(docType: 'cv' | 'jd', docId: string): Promise<Blob> {
    const response = await this.client.get(`/api/storage/files/${docType}/${docId}`, {
      responseType: 'blob',
    });
    return response.data as Blob;
  }

  // Auth methods
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/login', {
      email,
      password,
    }, {
      timeout: 10000, // 10 second timeout for auth
    });
    return response.data;
  }

  async me(token: string): Promise<UserProfile> {
    const response = await this.client.get<UserProfile>('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 5000, // 5 second timeout for quick auth check
    });
    return response.data;
  }

  /** Best-effort: tell the server we logged out so the admin presence dot flips red immediately. */
  async logout(token: string): Promise<void> {
    try {
      await this.client.post('/api/auth/logout', null, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 4000,
      });
    } catch {
      /* stateless auth, the token is discarded client-side regardless */
    }
  }

  /** Admin: which users are currently online. { users: { <username>: { online, last_seen } } } */
  async getUsersPresence(token: string): Promise<UsersPresenceResponse> {
    const response = await this.client.get<UsersPresenceResponse>('/api/admin/presence', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 6000,
    });
    return response.data;
  }

  // OTP methods
  async verifyPassword(email: string, password: string): Promise<VerifyPasswordResponse> {
    const response = await this.client.post<VerifyPasswordResponse>('/api/auth/verify-password', {
      email,
      password,
    }, {
      timeout: 10000, // 10 second timeout for auth
    });
    return response.data;
  }

  async sendOTP(email: string, password: string): Promise<OTPResponse> {
    const response = await this.client.post<OTPResponse>('/api/auth/send-otp', {
      email,
      password,
    }, {
      timeout: 30000, // 30 second timeout for email sending
    });
    return response.data;
  }

  async verifyOTP(email: string, otp: string): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/verify-otp', {
      email,
      otp,
    }, {
      timeout: 10000, // 10 second timeout for auth
    });
    return response.data;
  }

  /** Stable per-browser fingerprint that binds a CAPTCHA challenge to this client. */
  getClientFingerprint(): string {
    try {
      let fp = localStorage.getItem('client_fp');
      if (!fp) {
        fp = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('client_fp', fp);
      }
      return `${fp}|${navigator.userAgent}`;
    } catch {
      return 'no-fingerprint';
    }
  }

  async getCaptcha(email: string, password: string): Promise<CaptchaResponse> {
    const response = await this.client.post<CaptchaResponse>('/api/auth/captcha', {
      email,
      password,
      fingerprint: this.getClientFingerprint(),
    }, { timeout: 15000 });
    return response.data;
  }

  async verifyCaptcha(email: string, captchaId: string, answer: string): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/captcha/verify', {
      email,
      captcha_id: captchaId,
      answer,
      fingerprint: this.getClientFingerprint(),
    }, { timeout: 10000 });
    return response.data;
  }

  // Admin methods
  async listUsers(token: string): Promise<AdminUser[]> {
    const response = await this.client.get<AdminUser[]>('/api/admin/users', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  }

  async createUser(token: string, body: CreateUserRequest): Promise<AdminUser> {
    const response = await this.client.post<AdminUser>('/api/admin/users', body, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  }

  async updateUser(token: string, id: string, body: UpdateUserRequest): Promise<AdminUser> {
    const response = await this.client.patch<AdminUser>(`/api/admin/users/${id}`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  }

  async deleteUser(token: string, id: string): Promise<void> {
    await this.client.delete(`/api/admin/users/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // Careers methods
  async createJobPostingWithFormData(file: File | null, formData: any): Promise<JobPostingResponse> {
    const formDataToSend = new FormData();

    if (file) {
      formDataToSend.append('file', file);
    }

    // Add form data fields
    if (formData.jobTitle) formDataToSend.append('job_title', formData.jobTitle);
    if (formData.jobLocation) formDataToSend.append('job_location', formData.jobLocation);
    if (formData.jobSummary) formDataToSend.append('job_summary', formData.jobSummary);
    if (formData.keyResponsibilities) formDataToSend.append('key_responsibilities', formData.keyResponsibilities);
    if (formData.qualifications) formDataToSend.append('qualifications', formData.qualifications);

    const response = await this.client.post<JobPostingResponse>(
      '/api/careers/admin/jobs/post',
      formDataToSend,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
      }
    );
    return response.data;
  }

  /**
   * Paginated job postings list.
   *
   * This is backwards compatible with the existing endpoint:
   * - If the backend returns an array (legacy behaviour), we wrap it in { jobs, total }.
   * - If the backend returns { jobs, total }, we use that directly.
   */
  async listJobPostingsPaged(params: {
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
    /** Searched by the server across every posting: title, poster, e-mail subject, id. */
    q?: string;
    scope?: 'all' | 'mine' | 'others';
    status?: 'all' | 'active' | 'inactive';
  } = {}): Promise<{ jobs: JobPostingListItem[]; total: number; counts?: { all: number; active: number; inactive: number } }> {
    const { includeInactive = false, limit, offset, q, scope, status } = params;
    const response = await this.client.get<any>(
      '/api/careers/admin/jobs',
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        params: {
          include_inactive: includeInactive,
          limit,
          offset,
          q: q?.trim() || undefined,
          scope: scope && scope !== 'all' ? scope : undefined,
          status: status && status !== 'all' ? status : undefined,
          _t: Date.now()
        }
      }
    );
    const data = response.data;

    // Legacy shape: bare array
    if (Array.isArray(data)) {
      return { jobs: data as JobPostingListItem[], total: data.length };
    }

    // New shape: { jobs, total, ... } (or similar)
    const jobs: JobPostingListItem[] =
      data.jobs ??
      data.items ??
      [];
    const total: number =
      typeof data.total === 'number'
        ? data.total
        : jobs.length;

    return { jobs, total, counts: data.counts };
  }

  // ---- saved CVs (each recruiter's own list)
  async getSavedCVs(params: { limit?: number; offset?: number; q?: string } = {}): Promise<{ cvs: CVListItem[]; total: number; count: number }> {
    const response = await this.client.get<{ cvs: CVListItem[]; total: number; count: number }>('/api/cv/saved', {
      params: { limit: params.limit, offset: params.offset, q: params.q?.trim() || undefined },
    });
    return response.data;
  }

  async getSavedCVIds(): Promise<string[]> {
    const response = await this.client.get<{ ids: string[] }>('/api/cv/saved/ids');
    return response.data.ids || [];
  }

  async saveCVs(cvIds: string[]): Promise<number> {
    const response = await this.client.post<{ saved: number }>('/api/cv/saved', { cv_ids: cvIds });
    return response.data.saved;
  }

  async unsaveCVs(cvIds: string[]): Promise<number> {
    const response = await this.client.post<{ removed: number }>('/api/cv/saved/remove', { cv_ids: cvIds });
    return response.data.removed;
  }

  // ---- bug reports
  async submitBugReport(body: BugCreateRequest): Promise<BugReport> {
    const response = await this.client.post<BugReport>('/api/bugs', body);
    return response.data;
  }

  async listMyBugReports(params: { limit?: number; offset?: number } = {}): Promise<{ items: BugReport[]; total: number }> {
    const response = await this.client.get<{ items: BugReport[]; total: number }>('/api/bugs/mine', { params });
    return response.data;
  }

  async adminListBugReports(params: {
    q?: string; status?: 'all' | BugStatus; severity?: 'all' | BugSeverity; area?: string; limit?: number; offset?: number;
  } = {}): Promise<{ items: AdminBugReport[]; total: number; counts: BugCounts }> {
    const { q, status, severity, area, limit, offset } = params;
    const response = await this.client.get<{ items: AdminBugReport[]; total: number; counts: BugCounts }>('/api/admin/bugs', {
      params: {
        q: q?.trim() || undefined,
        status: status && status !== 'all' ? status : undefined,
        severity: severity && severity !== 'all' ? severity : undefined,
        area: area || undefined,
        limit,
        offset,
      },
    });
    return response.data;
  }

  async adminUpdateBugReport(id: string, body: { status?: BugStatus; severity?: BugSeverity; admin_note?: string }): Promise<AdminBugReport> {
    const response = await this.client.patch<AdminBugReport>(`/api/admin/bugs/${id}`, body);
    return response.data;
  }

  async adminDeleteBugReport(id: string): Promise<void> {
    await this.client.delete(`/api/admin/bugs/${id}`);
  }

  async getOpenBugCount(): Promise<number> {
    const response = await this.client.get<{ open: number }>('/api/admin/bugs/open-count');
    return response.data.open;
  }

  async getCareersOverview(): Promise<CareersOverview> {
    const response = await this.client.get<CareersOverview>('/api/careers/admin/overview');
    return response.data;
  }

  async getJobTrends(days = 14): Promise<{ days: string[]; series: Record<string, number[]> }> {
    const response = await this.client.get<{ days: string[]; series: Record<string, number[]> }>(
      '/api/careers/admin/jobs-trends',
      { params: { days } },
    );
    return response.data;
  }

  async getWeeklyAnalysisReport(params: {
    startDate: string; // YYYY-MM-DD
    endDate: string;   // YYYY-MM-DD
  }): Promise<WeeklyAnalysisReport> {
    const { startDate, endDate } = params;
    const response = await this.client.get<WeeklyAnalysisReport>(
      '/api/careers/admin/reports/weekly',
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
        params: {
          start_date: startDate,
          end_date: endDate,
          _t: Date.now(),
        },
      }
    );
    return response.data;
  }

  // lib/api.ts

  async getPublicJob(token: string): Promise<PublicJobView> {
    try {
      const response = await this.client.get<PublicJobView>(`/api/careers/jobs/${token}`);
      return response.data;
    } catch (error: any) {
      logger.error('Failed to get public job:', error);

      // If it's a 404 error, throw a more specific error
      if (error.response?.status === 404) {
        throw new Error('Job not found or no longer available');
      }

      // Re-throw the original error
      throw error;
    }
  }

  async getRecentJobPostings(limit: number = 10): Promise<JobPostingListItem[]> {
    try {
      const response = await this.client.get<JobPostingListItem[]>(`/api/careers/jobs/recent?limit=${limit}`);
      return response.data;
    } catch (error: any) {
      logger.error('Failed to get recent job postings:', error);
      throw error;
    }
  }

  /** The open postings, searched and paged by the server (public, no login): title or location words, skills, region, areas. */
  async searchOpenJobs(params: {
    q?: string;
    skills?: string[];
    region?: 'UAE' | 'KSA' | 'Remote' | 'Not specified';
    areas?: string[];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ jobs: JobPostingListItem[]; total: number }> {
    const response = await this.client.get<{ jobs: JobPostingListItem[]; total: number }>('/api/careers/jobs/open', {
      params: {
        q: params.q?.trim() || undefined,
        skills: params.skills?.length ? params.skills : undefined,
        region: params.region,
        areas: params.areas?.length ? params.areas : undefined,
        limit: params.limit,
        offset: params.offset,
      },
      // lists go as repeated ?skills=a&skills=b (what the server reads)
      paramsSerializer: { indexes: null },
    });
    return response.data;
  }

  async searchLocations(query: string): Promise<{ city: string; country: string; label: string }[]> {
    const response = await this.client.get<{ results: { city: string; country: string; label: string }[] }>(
      '/api/careers/locations/search',
      { params: { q: query } }
    );
    return response.data.results;
  }

  async submitJobApplication(
    token: string,
    applicantName: string,
    applicantEmail: string,
    applicantPhone: string | undefined,
    expectedSalary: number,
    yearsOfExperience: number,
    cvFile: File,
    location?: string,
    noticePeriod?: string,
    nationality?: string
  ): Promise<JobApplicationResponse> {
    const formData = new FormData();
    formData.append('applicant_name', applicantName);
    formData.append('applicant_email', applicantEmail);
    if (applicantPhone) formData.append('applicant_phone', applicantPhone);
    formData.append('expected_salary', expectedSalary.toString());
    formData.append('years_of_experience', yearsOfExperience.toString());
    if (location) formData.append('location', location);
    if (noticePeriod) formData.append('notice_period', noticePeriod);
    if (nationality) formData.append('nationality', nationality);
    formData.append('cv_file', cvFile);

    const response = await this.client.post<JobApplicationResponse>(
      `/api/careers/jobs/${token}/apply`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  }

  /** Read a dropped CV and get back only the form values that are certain (same parsers and prompt as an application). */
  async autofillFromCV(token: string, cvFile: File): Promise<{ fields: Record<string, string>; sources: Record<string, string>; readable: boolean }> {
    const formData = new FormData();
    formData.append('cv_file', cvFile);
    const response = await this.client.post(`/api/careers/jobs/${token}/autofill`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return response.data;
  }

  // ---- AI agents: read, send a message, read history. There is no edit or delete: the history is a record. ----
  // ---- Agentic mode: one assistant that uses the app's features. Read, send, hide: there is no edit or delete call. ----
  async getAgenticCapabilities(): Promise<AgenticCapabilities> {
    return (await this.client.get<AgenticCapabilities>('/api/agentic/capabilities')).data;
  }

  async listAgenticConversations(): Promise<AgentConversationSummary[]> {
    return (await this.client.get<AgentConversationSummary[]>('/api/agentic/conversations')).data;
  }

  async getAgenticConversation(id: string): Promise<{ conversation: AgentConversation; messages: AgentMessage[] }> {
    return (await this.client.get(`/api/agentic/conversations/${id}`)).data;
  }

  /** One turn. Not retried automatically (a retry would repeat the work), and given time: matching can take a while. */
  /** Attach a job description file to post. It is read and held privately; nothing is posted until the person confirms the draft. */
  async agenticUpload(file: File): Promise<{ ref: string; filename: string; chars: number }> {
    const form = new FormData();
    form.append('file', file);
    return (await this.client.post('/api/agentic/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })).data;
  }

  async agenticChat(body: { message: string; conversation_id?: string | null; attachment_ref?: string | null; selection?: Record<string, any> | null }): Promise<AgentChatResponse> {
    return (await this.client.post<AgentChatResponse>('/api/agentic/chat', body, { timeout: 180000 })).data;
  }

  /** The next page of a list already on screen. Read straight from the application, no assistant and no tokens. */
  async agenticMore(body: { tool: string; args: Record<string, any>; offset: number; cursor: string | null }): Promise<{ rows: any[]; total: number; page: AgenticCard['page'] }> {
    return (await this.client.post('/api/agentic/cards/more', body)).data;
  }

  /** Progress of a matching run (and its results when done). Read straight from the matching engine: no assistant, no tokens. */
  async agenticMatchStatus(jobId: string): Promise<{ status: 'running' | 'failed' | 'completed'; percent?: number | null; card?: AgenticCard; summary?: string }> {
    return (await this.client.get(`/api/agentic/match-status/${encodeURIComponent(jobId)}`)).data;
  }

  async hideAgenticConversation(id: string): Promise<void> {
    await this.client.post(`/api/agentic/conversations/${id}/hide`);
  }

  async getAgentUsage(): Promise<AgentUsage> {
    return (await this.client.get<AgentUsage>('/api/agents/usage')).data;
  }

  /** Ask an admin to reset the signed-in person's tokens for today. */
  async requestAgentReset(reason: string): Promise<AgentUsage> {
    return (await this.client.post<AgentUsage>('/api/agents/usage/request-reset', { reason })).data;
  }

  async getAgentResetRequests(): Promise<AgentResetRequests> {
    return (await this.client.get<AgentResetRequests>('/api/agents/admin/reset-requests')).data;
  }

  async answerAgentResetRequest(id: string, decision: 'approve' | 'reject'): Promise<void> {
    await this.client.post(`/api/agents/admin/reset-requests/${encodeURIComponent(id)}/${decision}`);
  }

  async getAgentUsageAdmin(): Promise<AgentAdminUsage> {
    return (await this.client.get<AgentAdminUsage>('/api/agents/admin/usage')).data;
  }

  async resetAgentUsage(username: string): Promise<AgentUsage> {
    return (await this.client.post<AgentUsage>(`/api/agents/admin/usage/${encodeURIComponent(username)}/reset`)).data;
  }

  async getAgentInfo(agent: string): Promise<AgentInfo> {
    return (await this.client.get<AgentInfo>(`/api/agents/${agent}`)).data;
  }

  async listAgentConversations(agent: string): Promise<AgentConversationSummary[]> {
    return (await this.client.get<AgentConversationSummary[]>(`/api/agents/${agent}/conversations`)).data;
  }

  async getAgentConversation(agent: string, id: string): Promise<{ conversation: AgentConversation; messages: AgentMessage[] }> {
    return (await this.client.get(`/api/agents/${agent}/conversations/${id}`)).data;
  }

  /** One turn. Deliberately NOT retried automatically: a retry would be a second model call. */
  async agentChat(agent: string, body: AgentChatRequest): Promise<AgentChatResponse> {
    return (await this.client.post<AgentChatResponse>(`/api/agents/${agent}/chat`, body, { timeout: 150000 })).data;
  }

  /** Removes a chat from the person's list. The record itself is kept on the server. */
  async hideAgentConversation(agent: string, id: string): Promise<void> {
    await this.client.post(`/api/agents/${agent}/conversations/${id}/hide`);
  }

  async agentExtractText(file: File, kind: 'jd' | 'cv' = 'jd'): Promise<{ filename: string; text: string; chars: number; truncated: boolean }> {
    const form = new FormData();
    form.append('file', file);
    return (await this.client.post(`/api/agents/extract-text?kind=${kind}`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })).data;
  }

  async getJobApplications(jobId: string): Promise<JobApplicationListItem[]> {
    const response = await this.client.get<JobApplicationListItem[]>(
      `/api/careers/admin/jobs/${jobId}/applications`,
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      }
    );
    return response.data;
  }

  /** Candidates in the database who fit the job's boolean search string and have not applied to it (one page; newest first). */
  async getJobDatabaseCandidates(jobId: string, params: { limit?: number; cursor?: string | null; q?: string | null } = {}): Promise<JobDatabaseCandidatesPage> {
    const response = await this.client.get<JobDatabaseCandidatesPage>(`/api/careers/admin/jobs/${jobId}/database-candidates`, {
      params: { limit: params.limit ?? 50, ...(params.cursor ? { cursor: params.cursor } : {}), ...(params.q ? { q: params.q } : {}) },
    });
    return response.data;
  }

  /** The id of every database candidate who fits the job's boolean string (what "match" scores besides the applicants). */
  async getJobDatabaseCandidateIds(jobId: string, q?: string | null): Promise<{ ids: string[]; total: number | null; truncated: boolean }> {
    const response = await this.client.get<{ ids: string[]; total: number | null; truncated: boolean }>(
      `/api/careers/admin/jobs/${jobId}/database-candidates`, { params: { ids_only: true, ...(q ? { q } : {}) }, timeout: 120000 });
    return response.data;
  }

  async getJobForMatching(jobId: string): Promise<{
    job_title: string;
    job_location: string;
    job_summary: string;
    key_responsibilities: string;
    qualifications: string;
    jd_id?: string;  // Include jd_id for matching
  }> {
    const response = await this.client.get<{
      job_title: string;
      job_location: string;
      job_summary: string;
      key_responsibilities: string;
      qualifications: string;
      jd_id?: string;  // Include jd_id for matching
    }>(`/api/careers/admin/jobs/${jobId}/match-data`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      params: {
        _t: Date.now() // Cache busting parameter
      }
    });
    return response.data;
  }

  async getJobForEdit(jobId: string): Promise<{
    job_title: string;
    job_location: string;
    job_summary: string;
    key_responsibilities: string;
    qualifications: string;
    jd_id?: string;  // Include jd_id for matching
  }> {
    const response = await this.client.get<{
      job_title: string;
      job_location: string;
      job_summary: string;
      key_responsibilities: string;
      qualifications: string;
      jd_id?: string;  // Include jd_id for matching
    }>(`/api/careers/admin/jobs/${jobId}/edit-data`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      params: {
        _t: Date.now() // Cache busting parameter
      }
    });
    return response.data;
  }

  async updateJobStatus(jobId: string, status: { is_active: boolean }): Promise<{ success: boolean; message: string }> {
    const response = await this.client.patch<{ success: boolean; message: string }>(
      `/api/careers/admin/jobs/${jobId}/status`,
      status,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        }
      }
    );
    return response.data;
  }

  async deleteJobPosting(jobId: string): Promise<{ success: boolean; message: string; details: any }> {
    const response = await this.client.delete(
      `/api/careers/admin/jobs/${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        }
      }
    );
    return response.data;
  }

  // Category endpoints
  async getCategories(): Promise<{ categories: Record<string, number> }> {
    const response = await this.client.get<{ categories: Record<string, number> }>('/api/cv/categories');
    return response.data;
  }

  // Monitor page (admin): metrics rolled up in Redis by every API / worker process
  async getMonitorSummary(minutes: number): Promise<any> {
    const response = await this.client.get('/api/monitor/summary', { params: { minutes } });
    return response.data;
  }

  async getMonitorTimeseries(minutes: number): Promise<any> {
    const response = await this.client.get('/api/monitor/timeseries', { params: { minutes } });
    return response.data;
  }

  async getMonitorEvents(params: { kind?: string; failures?: boolean; limit?: number }): Promise<any> {
    const response = await this.client.get('/api/monitor/events', { params });
    return response.data;
  }

  // Queue management methods removed
}
