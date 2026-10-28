import { AxiosInstance } from 'axios';
import { logger } from '../logger';
import { createAxiosClient } from './httpClient';
import {
  MatchRequest,
  MatchResponse,
  CVListResponse,
  JDListResponse,
  HealthResponse,
  UploadResponse,
  StandardizeResponse,
  DatabaseStatusResponse,
  SystemStatsResponse,
  EmbeddingsInfoResponse,
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
  NotesSummaryResponse,
  WeeklyAnalysisReport,
  CVListItem,
  NoticeData,
  UsersPresenceResponse
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

  async listCVs(params?: { limit?: number; offset?: number; category?: string; q?: string }): Promise<CVListResponse> {
    const response = await this.client.get<CVListResponse>('/api/cv/cvs', {
      // Disable the browser HTTP cache + bust it with _t so switching category/search
      // never serves a stale (wrong-category) response.
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' },
      params: { ...(params ?? {}), _t: Date.now() },
    });
    return response.data;
  }

  /** Deep keyword search across the whole CV database (multiple keywords). */
  async keywordSearchCVs(params: { keywords: string; category?: string; match_all?: boolean; limit?: number }): Promise<{ status: string; count: number; total: number; keywords: string[]; match_all: boolean; cvs: CVListItem[] }> {
    const response = await this.client.get('/api/cv/keyword-search', {
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' },
      params: { ...params, _t: Date.now() },
    });
    return response.data;
  }

  /** Distinct values + counts for a filterable CV field (location, nationality, notice_period). */
  async getCVSearchFacet(field: 'location' | 'nationality' | 'notice_period'): Promise<{ field: string; values: { value: string; count: number }[] }> {
    const response = await this.client.get(`/api/cv/search/facets/${field}`);
    return response.data;
  }

  /**
   * Advanced CV search: keywords + experience range + location + nationality,
   * evaluated server-side across the whole CV database with cursor-based
   * pagination (pass the previous response's next_cursor back in as `cursor`
   * to fetch the next page — this is what powers infinite scroll).
   */
  async searchCVsAdvanced(params: {
    keywords?: string[];
    experience_min?: number;
    experience_max?: number;
    locations?: string[];
    nationalities?: string[];
    limit?: number;
    cursor?: string | null;
  }): Promise<{ results: CVListItem[]; next_cursor: string | null; count: number }> {
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


  async getCVEmbeddings(cvId: string): Promise<EmbeddingsInfoResponse> {
    const response = await this.client.get<EmbeddingsInfoResponse>(`/api/cv/${cvId}/embeddings`);
    return response.data;
  }

  async standardizeCV(cvText: string, filename?: string): Promise<StandardizeResponse> {
    const payload: { cv_text: string; cv_filename?: string } = { cv_text: cvText };
    if (filename) payload.cv_filename = filename;

    const response = await this.client.post<StandardizeResponse>('/api/cv/standardize-cv', payload);
    return response.data;
  }

  // CV Notes endpoints
  async getAllCVsWithNotes(): Promise<{ status: string; cvs_with_notes: any[]; total_count: number }> {
    const response = await this.client.get('/api/cv/notes/all');
    return response.data;
  }

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


  async getJDEmbeddings(jdId: string): Promise<EmbeddingsInfoResponse> {
    const response = await this.client.get<EmbeddingsInfoResponse>(`/api/jd/jd/${jdId}/embeddings`);
    return response.data;
  }

  async standardizeJD(jdText: string, filename?: string): Promise<StandardizeResponse> {
    const payload: { jd_text: string; jd_filename?: string } = { jd_text: jdText };
    if (filename) payload.jd_filename = filename;

    const response = await this.client.post<StandardizeResponse>('/api/jd/standardize-jd', payload);
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

    if (formData.companyName) {
      formDataObj.append('company_name', formData.companyName);
    }
    if (formData.additionalInfo) {
      formDataObj.append('additional_info', formData.additionalInfo);
    }

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

  async matchText(jdText: string, cvText: string): Promise<any> {
    const response = await this.client.post('/api/match-text', {
      jd_text: jdText,
      cv_text: cvText
    });
    return response.data;
  }

  // System endpoints
  async getSystemStats(): Promise<SystemStatsResponse> {
    const response = await this.client.get<SystemStatsResponse>('/api/system-stats');
    return response.data;
  }

  async getDatabaseStatus(): Promise<DatabaseStatusResponse> {
    const response = await this.client.get<DatabaseStatusResponse>('/api/database/status');
    return response.data;
  }

  async getDatabaseView(): Promise<DatabaseViewResponse> {
    const response = await this.client.get<DatabaseViewResponse>('/api/database/view');
    return response.data;
  }

  // Clear database
  async clearDatabase(token: string, confirm: boolean): Promise<{ status: string; message: string }> {
    const response = await this.client.post<{ status: string; message: string }>('/api/clear-database', null, {
      params: { confirm },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  }


  // Download CV by ID
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
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/login', {
      username,
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
      /* stateless auth — the token is discarded client-side regardless */
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
  async verifyPassword(username: string, password: string): Promise<VerifyPasswordResponse> {
    const response = await this.client.post<VerifyPasswordResponse>('/api/auth/verify-password', {
      username,
      password,
    }, {
      timeout: 10000, // 10 second timeout for auth
    });
    return response.data;
  }

  async sendOTP(username: string, password: string): Promise<OTPResponse> {
    const response = await this.client.post<OTPResponse>('/api/auth/send-otp', {
      username,
      password,
    }, {
      timeout: 30000, // 30 second timeout for email sending
    });
    return response.data;
  }

  async verifyOTP(username: string, otp: string): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/verify-otp', {
      username,
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

  async getCaptcha(username: string, password: string): Promise<CaptchaResponse> {
    const response = await this.client.post<CaptchaResponse>('/api/auth/captcha', {
      username,
      password,
      fingerprint: this.getClientFingerprint(),
    }, { timeout: 15000 });
    return response.data;
  }

  async verifyCaptcha(username: string, captchaId: string, answer: string): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/captcha/verify', {
      username,
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
  async createJobPosting(file: File): Promise<JobPostingResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.post<JobPostingResponse>(
      '/api/careers/admin/jobs/post',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
      }
    );
    return response.data;
  }

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

  async createManualJobPosting(formData: any): Promise<JobPostingResponse> {
    const formDataToSend = new FormData();

    // Add required and optional form data fields
    formDataToSend.append('job_title', formData.jobTitle);
    if (formData.jobLocation) formDataToSend.append('job_location', formData.jobLocation);
    if (formData.jobSummary) formDataToSend.append('job_summary', formData.jobSummary);
    if (formData.keyResponsibilities) formDataToSend.append('key_responsibilities', formData.keyResponsibilities);
    if (formData.qualifications) formDataToSend.append('qualifications', formData.qualifications);
    if (formData.companyName) formDataToSend.append('company_name', formData.companyName);
    if (formData.additionalInfo) formDataToSend.append('additional_info', formData.additionalInfo);

    const response = await this.client.post<JobPostingResponse>(
      '/api/careers/admin/jobs/post-manual',
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

  async listJobPostings(includeInactive: boolean = false): Promise<JobPostingListItem[]> {
    const response = await this.client.get<JobPostingListItem[]>(
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
          _t: Date.now() // Cache busting parameter
        }
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
  } = {}): Promise<{ jobs: JobPostingListItem[]; total: number }> {
    const { includeInactive = false, limit, offset } = params;
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

    return { jobs, total };
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

  async getJobForMatching(jobId: string): Promise<{
    job_title: string;
    job_location: string;
    job_summary: string;
    key_responsibilities: string;
    qualifications: string;
    company_name: string;
    jd_id?: string;  // Include jd_id for matching
  }> {
    const response = await this.client.get<{
      job_title: string;
      job_location: string;
      job_summary: string;
      key_responsibilities: string;
      qualifications: string;
      company_name: string;
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
    company_name: string;
    jd_id?: string;  // Include jd_id for matching
  }> {
    const response = await this.client.get<{
      job_title: string;
      job_location: string;
      job_summary: string;
      key_responsibilities: string;
      qualifications: string;
      company_name: string;
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

  // Notes methods (legacy aliases — same behavior as CV Notes endpoints above)
  async addNote(cvId: string, note: string, hrUser: string = 'HR'): Promise<any> {
    return this.addOrUpdateNote(cvId, note, hrUser);
  }

  async getNotes(cvId: string): Promise<any> {
    return this.getCVNotes(cvId);
  }

  async deleteNote(cvId: string, hrUser: string): Promise<any> {
    return this.deleteCVNote(cvId, hrUser);
  }

  async getAllNotes(): Promise<any> {
    return this.getAllCVsWithNotes();
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

  async deleteAllJobPostings(): Promise<{ success: boolean; message: string; details: any }> {
    const response = await this.client.delete(
      `/api/careers/admin/jobs/delete-all`,
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

  async getCVsByCategory(category: string): Promise<{ cvs: any[]; category: string; count: number }> {
    const response = await this.client.get<{ cvs: any[]; category: string; count: number }>(`/api/cv/cvs/category/${encodeURIComponent(category)}`);
    return response.data;
  }

  async matchByCategory(jdId: string, topK?: number): Promise<any> {
    const response = await this.client.post('/api/match/category-based', {
      jd_id: jdId,
      top_k: topK || 10
    });
    return response.data;
  }

  // Performance monitoring methods
  async getSystemPerformance(): Promise<any> {
    const response = await this.client.get('/api/performance/system');
    return response.data;
  }

  async getGPUPerformance(): Promise<any> {
    const response = await this.client.get('/api/performance/gpu');
    return response.data;
  }

  async getDockerPerformance(): Promise<any> {
    const response = await this.client.get('/api/performance/docker');
    return response.data;
  }

  async getPerformanceSummary(): Promise<any> {
    const response = await this.client.get('/api/performance/summary');
    return response.data;
  }

  async getPerformanceHealth(): Promise<any> {
    const response = await this.client.get('/api/performance/health');
    return response.data;
  }

  // Queue management methods removed
}
