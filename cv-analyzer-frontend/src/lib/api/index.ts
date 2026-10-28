import { RequestRetryHandler } from '../error-handler';
import { MatchRequest } from '../types';
import { ApiClient } from './ApiClient';
import type { AdminUser, CreateUserRequest, UpdateUserRequest, LoginResponse, UserProfile } from '../types';

// Create singleton instance
export const apiClient = new ApiClient();

// Export individual functions for easier consumption
export const api = {
  // Health
  healthCheck: () => RequestRetryHandler.withRetry(() => apiClient.healthCheck()),

  // CV operations
  uploadCV: (file: File, cvText?: string) => RequestRetryHandler.withRetry(() => apiClient.uploadCV(file, cvText)),
  listCVs: (params?: { limit?: number; offset?: number; category?: string; q?: string }) =>
    RequestRetryHandler.withRetry(() => apiClient.listCVs(params)),
  keywordSearchCVs: (params: { keywords: string; category?: string; match_all?: boolean; limit?: number }) =>
    RequestRetryHandler.withRetry(() => apiClient.keywordSearchCVs(params)),
  getCVSearchFacet: (field: 'location' | 'nationality' | 'notice_period') =>
    RequestRetryHandler.withRetry(() => apiClient.getCVSearchFacet(field)),
  searchCVsAdvanced: (params: {
    keywords?: string[]; experience_min?: number; experience_max?: number;
    locations?: string[]; nationalities?: string[]; limit?: number; cursor?: string | null;
  }) => RequestRetryHandler.withRetry(() => apiClient.searchCVsAdvanced(params)),
  // Login notice popup
  getNotice: () => RequestRetryHandler.withRetry(() => apiClient.getNotice()),
  getAdminNotice: () => RequestRetryHandler.withRetry(() => apiClient.getAdminNotice()),
  setNotice: (message: string, active: boolean) => RequestRetryHandler.withRetry(() => apiClient.setNotice(message, active)),
  clearNotice: () => RequestRetryHandler.withRetry(() => apiClient.clearNotice()),
  getCVDetails: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.getCVDetails(cvId)),
  deleteCV: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.deleteCV(cvId)),
  getCVEmbeddings: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.getCVEmbeddings(cvId)),
  standardizeCV: (cvText: string, filename?: string) => RequestRetryHandler.withRetry(() => apiClient.standardizeCV(cvText, filename)),

  // CV Notes operations
  getAllCVsWithNotes: () => RequestRetryHandler.withRetry(() => apiClient.getAllCVsWithNotes()),
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
  getJDEmbeddings: (jdId: string) => RequestRetryHandler.withRetry(() => apiClient.getJDEmbeddings(jdId)),
  standardizeJD: (jdText: string, filename?: string) => RequestRetryHandler.withRetry(() => apiClient.standardizeJD(jdText, filename)),
  extractJDForUI: (jdId: string) => RequestRetryHandler.withRetry(() => apiClient.extractJDForUI(jdId)),
  unifiedJobUpdate: (jdId: string | null, jobId: string | null, formData: any) => RequestRetryHandler.withRetry(() => apiClient.unifiedJobUpdate(jdId, jobId, formData)),

  // Matching
  matchCandidates: (request: MatchRequest) => RequestRetryHandler.withRetry(() => apiClient.matchCandidates(request)),
  matchText: (jdText: string, cvText: string) => RequestRetryHandler.withRetry(() => apiClient.matchText(jdText, cvText)),

  // System
  getSystemStats: () => RequestRetryHandler.withRetry(() => apiClient.getSystemStats()),
  getDatabaseStatus: () => RequestRetryHandler.withRetry(() => apiClient.getDatabaseStatus()),
  getDatabaseView: () => RequestRetryHandler.withRetry(() => apiClient.getDatabaseView()),
  clearDatabase: (token: string, confirm: boolean) => RequestRetryHandler.withRetry(() => apiClient.clearDatabase(token, confirm)),
  downloadCV: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.downloadCV(cvId)),
  downloadStorageFile: (docType: 'cv' | 'jd', docId: string) => RequestRetryHandler.withRetry(() => apiClient.downloadStorageFile(docType, docId)),

  // Auth
  login: (username: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.login(username, password)),
  me: (token: string) => RequestRetryHandler.withRetry(() => apiClient.me(token)),
  verifyPassword: (username: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.verifyPassword(username, password)),
  sendOTP: (username: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.sendOTP(username, password)),
  verifyOTP: (username: string, otp: string) => RequestRetryHandler.withRetry(() => apiClient.verifyOTP(username, otp)),
  getCaptcha: (username: string, password: string) => RequestRetryHandler.withRetry(() => apiClient.getCaptcha(username, password)),
  verifyCaptcha: (username: string, captchaId: string, answer: string) => RequestRetryHandler.withRetry(() => apiClient.verifyCaptcha(username, captchaId, answer)),
  logout: (token: string) => apiClient.logout(token),

  // Admin Users (admin only)
  listUsers: (token: string) => RequestRetryHandler.withRetry(() => apiClient.listUsers(token)),
  createUser: (token: string, body: CreateUserRequest) => RequestRetryHandler.withRetry(() => apiClient.createUser(token, body)),
  updateUser: (token: string, id: string, body: UpdateUserRequest) => RequestRetryHandler.withRetry(() => apiClient.updateUser(token, id, body)),
  deleteUser: (token: string, id: string) => RequestRetryHandler.withRetry(() => apiClient.deleteUser(token, id)),
  getUsersPresence: (token: string) => RequestRetryHandler.withRetry(() => apiClient.getUsersPresence(token)),

  // Careers API
  createJobPosting: (file: File) => RequestRetryHandler.withRetry(() => apiClient.createJobPosting(file)),
  createJobPostingWithFormData: (file: File | null, formData: any) =>
    RequestRetryHandler.withRetry(() => apiClient.createJobPostingWithFormData(file, formData)),
  createManualJobPosting: (formData: any) =>
    RequestRetryHandler.withRetry(() => apiClient.createManualJobPosting(formData)),
  listJobPostings: (includeInactive: boolean = false) =>
    RequestRetryHandler.withRetry(() => apiClient.listJobPostings(includeInactive)),
  listJobPostingsPaged: (params?: { includeInactive?: boolean; limit?: number; offset?: number }) =>
    RequestRetryHandler.withRetry(() => apiClient.listJobPostingsPaged(params)),
  getPublicJob: (token: string) => RequestRetryHandler.withRetry(() => apiClient.getPublicJob(token)),
  getRecentJobPostings: (limit: number = 10) => RequestRetryHandler.withRetry(() => apiClient.getRecentJobPostings(limit)),
  searchLocations: (query: string) => RequestRetryHandler.withRetry(() => apiClient.searchLocations(query)),
  submitJobApplication: (token: string, name: string, email: string, phone: string | undefined, expectedSalary: number, yearsOfExperience: number, cvFile: File, location?: string, noticePeriod?: string, nationality?: string) =>
    RequestRetryHandler.withRetry(() => apiClient.submitJobApplication(token, name, email, phone, expectedSalary, yearsOfExperience, cvFile, location, noticePeriod, nationality)),
  getJobApplications: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.getJobApplications(jobId)),


  getJobForMatching: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.getJobForMatching(jobId)),
  getJobForEdit: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.getJobForEdit(jobId)),
  updateJobStatus: (jobId: string, status: { is_active: boolean }) =>
    RequestRetryHandler.withRetry(() => apiClient.updateJobStatus(jobId, status)),
  deleteJobPosting: (jobId: string) => RequestRetryHandler.withRetry(() => apiClient.deleteJobPosting(jobId)),
  deleteAllJobPostings: () => RequestRetryHandler.withRetry(() => apiClient.deleteAllJobPostings()),
  getWeeklyAnalysisReport: (params: { startDate: string; endDate: string }) =>
    RequestRetryHandler.withRetry(() => apiClient.getWeeklyAnalysisReport(params)),

  // Category operations
  getCategories: () => RequestRetryHandler.withRetry(() => apiClient.getCategories()),
  getCVsByCategory: (category: string) => RequestRetryHandler.withRetry(() => apiClient.getCVsByCategory(category)),
  matchByCategory: (jdId: string, topK?: number) => RequestRetryHandler.withRetry(() => apiClient.matchByCategory(jdId, topK)),

  // Notes operations (legacy aliases → modern CV Notes methods)
  addNote: (cvId: string, note: string, hrUser?: string) =>
    RequestRetryHandler.withRetry(() => apiClient.addOrUpdateNote(cvId, note, hrUser ?? 'HR')),
  getNotes: (cvId: string) => RequestRetryHandler.withRetry(() => apiClient.getCVNotes(cvId)),
  deleteNote: (cvId: string, hrUser: string) => RequestRetryHandler.withRetry(() => apiClient.deleteCVNote(cvId, hrUser)),
  getAllNotes: () => RequestRetryHandler.withRetry(() => apiClient.getAllCVsWithNotes()),
  // deleteCVNote: (cvId: string, hrUser: string) => RequestRetryHandler.withRetry(() => apiClient.deleteCVNote(cvId, hrUser)),

  // Performance monitoring operations
  getSystemPerformance: () => RequestRetryHandler.withRetry(() => apiClient.getSystemPerformance()),
  getGPUPerformance: () => RequestRetryHandler.withRetry(() => apiClient.getGPUPerformance()),
  getDockerPerformance: () => RequestRetryHandler.withRetry(() => apiClient.getDockerPerformance()),
  getPerformanceSummary: () => RequestRetryHandler.withRetry(() => apiClient.getPerformanceSummary()),
  getPerformanceHealth: () => RequestRetryHandler.withRetry(() => apiClient.getPerformanceHealth()),

  // Queue management operations removed
};

// Re-export types for convenience
export type { AdminUser, CreateUserRequest, UpdateUserRequest, LoginResponse, UserProfile } from '../types';