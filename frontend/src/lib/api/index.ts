import { RequestRetryHandler } from '../error-handler';
import { CVAdvancedSearchParams, MatchRequest } from '../types';
import { ApiClient } from './ApiClient';
import type { CreateUserRequest, UpdateUserRequest, RequirementFilters, RequirementInput, AnalyticsView, SelectionFilters, SelectionInput } from '../types';

// Create singleton instance
export const apiClient = new ApiClient();

// Export individual functions for easier consumption
export const api = {
  // Health
  healthCheck: () => RequestRetryHandler.withRetry(() => apiClient.healthCheck()),

  // CV operations
  uploadCV: (file: File, cvText?: string) => RequestRetryHandler.withRetry(() => apiClient.uploadCV(file, cvText)),
  getCVUploadProgress: (cvId: string) => apiClient.getCVUploadProgress(cvId),
  listCVs: (params?: { limit?: number; offset?: number; cursor?: string; category?: string; q?: string }) =>
    RequestRetryHandler.withRetry(() => apiClient.listCVs(params)),
  listCVIds: (params?: { limit?: number; category?: string; categories?: string[] }) =>
    RequestRetryHandler.withRetry(() => apiClient.listCVIds(params)),
  getCVSearchFacet: (field: 'location' | 'nationality' | 'notice_period' | 'languages') =>
    RequestRetryHandler.withRetry(() => apiClient.getCVSearchFacet(field)),
  searchCVsAdvanced: (params: CVAdvancedSearchParams) => RequestRetryHandler.withRetry(() => apiClient.searchCVsAdvanced(params)),
  // Login notice popup
  getNotice: () => RequestRetryHandler.withRetry(() => apiClient.getNotice()),
  getAdminNotice: () => RequestRetryHandler.withRetry(() => apiClient.getAdminNotice()),
  setNotice: (message: string, active: boolean) => RequestRetryHandler.withRetry(() => apiClient.setNotice(message, active)),
  clearNotice: () => RequestRetryHandler.withRetry(() => apiClient.clearNotice()),
  getCVDetails: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.getCVDetails(cvId)),
  deleteCV: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.deleteCV(cvId)),

  // CV Notes operations
  getCVNotes: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.getCVNotes(cvId)),
  getNotesSummary: (cvIds: string[]) => RequestRetryHandler.withRetry(() => apiClient.getNotesSummary(cvIds)),
  addOrUpdateNote: (cvId: string, note: string, hrUser: string) => RequestRetryHandler.withRetry(() => apiClient.addOrUpdateNote(cvId, note, hrUser)),
  deleteCVNote: (cvId: string, hrUser: string) => RequestRetryHandler.withRetry(() => apiClient.deleteCVNote(cvId, hrUser)),

  // JD operations
  uploadJD: (file: File, jdText?: string) => RequestRetryHandler.withRetry(() => apiClient.uploadJD(file, jdText)),
  listJDs: (params?: { limit?: number; offset?: number; category?: string; q?: string }) =>
    RequestRetryHandler.withRetry(() => apiClient.listJDs(params)),
  getJDDetails: (jdId: string) => RequestRetryHandler.withRetry(() => apiClient.getJDDetails(jdId)),
  deleteJD: (jdId: string) => RequestRetryHandler.withRetry(() => apiClient.deleteJD(jdId)),
  extractJDForUI: (jdId: string) => RequestRetryHandler.withRetry(() => apiClient.extractJDForUI(jdId)),
  unifiedJobUpdate: (jdId: string | null, jobId: string | null, formData: any) => RequestRetryHandler.withRetry(() => apiClient.unifiedJobUpdate(jdId, jobId, formData)),

  // Requirements tracker
  getTrackerOptions: () => RequestRetryHandler.withRetry(() => apiClient.getTrackerOptions()),
  listRequirements: (filters: RequirementFilters, limit = 50, offset = 0) => apiClient.listRequirements(filters, limit, offset),
  getRequirement: (id: string) => apiClient.getRequirement(id),
  createRequirement: (body: RequirementInput) => apiClient.createRequirement(body),
  updateRequirement: (id: string, body: RequirementInput) => apiClient.updateRequirement(id, body),
  deleteRequirement: (id: string) => apiClient.deleteRequirement(id),
  getSelectionOptions: () => apiClient.getSelectionOptions(),
  listSelections: (filters: SelectionFilters, limit = 50, offset = 0) => apiClient.listSelections(filters, limit, offset),
  updateSelection: (id: string, body: SelectionInput) => apiClient.updateSelection(id, body),
  deleteSelection: (id: string) => apiClient.deleteSelection(id),
  markRequirementPosted: (id: string, jobId: string) => apiClient.markRequirementPosted(id, jobId),
  exportRequirements: (filters: RequirementFilters) => apiClient.exportRequirements(filters),
  listClosures: (filters: RequirementFilters, limit = 50, offset = 0) => apiClient.listClosures(filters, limit, offset),
  exportClosures: (filters: RequirementFilters) => apiClient.exportClosures(filters),
  getTrackerAnalytics: (params: { view: AnalyticsView; year: number; month?: number; location?: string }) => apiClient.getTrackerAnalytics(params),

  // Matching
  matchCandidates: (request: MatchRequest) => RequestRetryHandler.withRetry(() => apiClient.matchCandidates(request)),
  getMatchJob: (jobId: string) => apiClient.getMatchJob(jobId),

  // System
  getSystemStats: () => RequestRetryHandler.withRetry(() => apiClient.getSystemStats()),
  getDatabaseView: () => RequestRetryHandler.withRetry(() => apiClient.getDatabaseView()),
  downloadCV: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.downloadCV(cvId)),
  getCVPreviewPage: (cvId: string, page: number) => apiClient.getCVPreviewPage(cvId, page),
  getJDPreviewPage: (jdId: string, page: number) => apiClient.getJDPreviewPage(jdId, page),
  downloadStorageFile: (docType: 'cv' | 'jd', docId: string) => RequestRetryHandler.withRetry(() => apiClient.downloadStorageFile(docType, docId)),

  // Auth
  login: (email: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.login(email, password)),
  me: (token: string) => RequestRetryHandler.withRetry(() => apiClient.me(token)),
  verifyPassword: (email: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.verifyPassword(email, password)),
  sendOTP: (email: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.sendOTP(email, password)),
  verifyOTP: (email: string, otp: string) => RequestRetryHandler.withRetry(() => apiClient.verifyOTP(email, otp)),
  getCaptcha: (email: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.getCaptcha(email, password)),
  verifyCaptcha: (email: string, captchaId: string, answer: string) => RequestRetryHandler.withRetry(() => apiClient.verifyCaptcha(email, captchaId, answer)),
  totpSetup: (email: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.totpSetup(email, password)),
  // not retried: a code works once, so a repeated request would be refused as a replay
  verifyTotp: (email: string, password: string, code: string) => apiClient.verifyTotp(email, password, code),
  logout: (token: string) => apiClient.logout(token),

  // Admin Users (admin only)
  listUsers: (token: string) => RequestRetryHandler.withRetry(() => apiClient.listUsers(token)),
  createUser: (token: string, body: CreateUserRequest) => RequestRetryHandler.withRetry(() => apiClient.createUser(token, body)),
  updateUser: (token: string, id: string, body: UpdateUserRequest) => RequestRetryHandler.withRetry(() => apiClient.updateUser(token, id, body)),
  resetAuthenticator: (token: string, id: string) => RequestRetryHandler.withRetry(() => apiClient.resetAuthenticator(token, id)),
  deleteUser: (token: string, id: string) => RequestRetryHandler.withRetry(() => apiClient.deleteUser(token, id)),
  getUsersPresence: (token: string) => RequestRetryHandler.withRetry(() => apiClient.getUsersPresence(token)),

  // Careers API
  createJobPostingWithFormData: (file: File | null, formData: any) =>
    RequestRetryHandler.withRetry(() => apiClient.createJobPostingWithFormData(file, formData)),
  listJobPostingsPaged: (params?: { includeInactive?: boolean; limit?: number; offset?: number }) =>
    RequestRetryHandler.withRetry(() => apiClient.listJobPostingsPaged(params)),
  getPublicJob: (token: string) => RequestRetryHandler.withRetry(() => apiClient.getPublicJob(token)),
  searchOpenJobs: (params: Parameters<typeof apiClient.searchOpenJobs>[0] = {}) => RequestRetryHandler.withRetry(() => apiClient.searchOpenJobs(params)),
  getRecentJobPostings: (limit: number = 10) => RequestRetryHandler.withRetry(() => apiClient.getRecentJobPostings(limit)),
  searchLocations: (query: string) => RequestRetryHandler.withRetry(() => apiClient.searchLocations(query)),
  autofillFromCV: (token: string, cvFile: File) => apiClient.autofillFromCV(token, cvFile),
  requestAgentReset: (reason: string) => apiClient.requestAgentReset(reason),
  getAgentResetRequests: () => RequestRetryHandler.withRetry(() => apiClient.getAgentResetRequests()),
  answerAgentResetRequest: (id: string, decision: 'approve' | 'reject') => apiClient.answerAgentResetRequest(id, decision),
  getAgenticCapabilities: () => RequestRetryHandler.withRetry(() => apiClient.getAgenticCapabilities()),
  listAgenticConversations: () => RequestRetryHandler.withRetry(() => apiClient.listAgenticConversations()),
  getAgenticConversation: (id: string) => RequestRetryHandler.withRetry(() => apiClient.getAgenticConversation(id)),
  agenticUpload: (file: File) => apiClient.agenticUpload(file),
  agenticChat: (body: { message: string; conversation_id?: string | null; attachment_ref?: string | null; selection?: Record<string, any> | null }) => apiClient.agenticChat(body),   // no automatic retry
  agenticMore: (body: { tool: string; args: Record<string, any>; offset: number; cursor: string | null }) => apiClient.agenticMore(body),
  agenticMatchStatus: (jobId: string) => apiClient.agenticMatchStatus(jobId),
  hideAgenticConversation: (id: string) => apiClient.hideAgenticConversation(id),
  getAgentUsage: () => RequestRetryHandler.withRetry(() => apiClient.getAgentUsage()),
  getAgentUsageAdmin: () => RequestRetryHandler.withRetry(() => apiClient.getAgentUsageAdmin()),
  resetAgentUsage: (username: string) => apiClient.resetAgentUsage(username),
  getHiringImage: (title: string, location: string) => apiClient.getHiringImage(title, location),
  getJobHiringImage: (jobId: string) => apiClient.getJobHiringImage(jobId),
  getJobDatabaseCandidates: (jobId: string, params?: { limit?: number; cursor?: string | null; q?: string | null }) => apiClient.getJobDatabaseCandidates(jobId, params),
  getJobDatabaseCandidateIds: (jobId: string, q?: string | null) => apiClient.getJobDatabaseCandidateIds(jobId, q),
  getAgentInfo: (agent: string) => RequestRetryHandler.withRetry(() => apiClient.getAgentInfo(agent)),
  listAgentConversations: (agent: string) => RequestRetryHandler.withRetry(() => apiClient.listAgentConversations(agent)),
  getAgentConversation: (agent: string, id: string) => RequestRetryHandler.withRetry(() => apiClient.getAgentConversation(agent, id)),
  agentChat: (agent: string, body: import('@/lib/types').AgentChatRequest) => apiClient.agentChat(agent, body),   // no automatic retry
  agentExtractText: (file: File, kind: 'jd' | 'cv' = 'jd') => apiClient.agentExtractText(file, kind),
  hideAgentConversation: (agent: string, id: string) => apiClient.hideAgentConversation(agent, id),
  submitJobApplication: (token: string, name: string, email: string, phone: string | undefined, expectedSalary: number, yearsOfExperience: number, cvFile: File, location?: string, noticePeriod?: string, nationality?: string) =>
    RequestRetryHandler.withRetry(() => apiClient.submitJobApplication(token, name, email, phone, expectedSalary, yearsOfExperience, cvFile, location, noticePeriod, nationality)),
  getJobApplications: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.getJobApplications(jobId)),


  getJobForMatching: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.getJobForMatching(jobId)),
  getJobForEdit: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.getJobForEdit(jobId)),
  updateJobStatus: (jobId: string, status: { is_active: boolean }) =>
    RequestRetryHandler.withRetry(() => apiClient.updateJobStatus(jobId, status)),
  deleteJobPosting: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.deleteJobPosting(jobId)),
  // Bug reports (a submit is never retried automatically: it would send the report twice)
  submitBugReport: (body: import('@/lib/types').BugCreateRequest) => apiClient.submitBugReport(body),
  listMyBugReports: (params?: { limit?: number; offset?: number }) => RequestRetryHandler.withRetry(() => apiClient.listMyBugReports(params)),
  adminListBugReports: (params?: Parameters<typeof apiClient.adminListBugReports>[0]) => RequestRetryHandler.withRetry(() => apiClient.adminListBugReports(params)),
  adminUpdateBugReport: (id: string, body: Parameters<typeof apiClient.adminUpdateBugReport>[1]) => apiClient.adminUpdateBugReport(id, body),
  adminDeleteBugReport: (id: string) => apiClient.adminDeleteBugReport(id),
  getOpenBugCount: () => apiClient.getOpenBugCount(),
  getCareersOverview: () => RequestRetryHandler.withRetry(() => apiClient.getCareersOverview()),
  getJobTrends: (days: number = 14) => RequestRetryHandler.withRetry(() => apiClient.getJobTrends(days)),
  getWeeklyAnalysisReport: (params: { startDate: string; endDate: string }) =>
    RequestRetryHandler.withRetry(() => apiClient.getWeeklyAnalysisReport(params)),

  // Category operations
  getCategories: () => RequestRetryHandler.withRetry(() => apiClient.getCategories()),

  // Monitor page operations
  getMonitorSummary: (minutes: number) => RequestRetryHandler.withRetry(() => apiClient.getMonitorSummary(minutes)),
  getMonitorTimeseries: (minutes: number) => RequestRetryHandler.withRetry(() => apiClient.getMonitorTimeseries(minutes)),
  getMonitorEvents: (params: { kind?: string; failures?: boolean; limit?: number }) =>
    RequestRetryHandler.withRetry(() => apiClient.getMonitorEvents(params)),

  // Queue management operations removed
};

// Re-export types for convenience
export type { AdminUser, CreateUserRequest, UpdateUserRequest, LoginResponse, UserProfile } from '../types';