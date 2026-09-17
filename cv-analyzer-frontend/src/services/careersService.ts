import { api } from '@/lib/api';

/**
 * Careers portal: job postings & applications.
 * Thin domain grouping over the existing `api` client — no new logic.
 */
export const careersService = {
  // Job postings
  createJobPosting: api.createJobPosting,
  createJobPostingWithFormData: api.createJobPostingWithFormData,
  createManualJobPosting: api.createManualJobPosting,
  listJobPostings: api.listJobPostings,
  listJobPostingsPaged: api.listJobPostingsPaged,
  getRecentJobPostings: api.getRecentJobPostings,
  getJobForEdit: api.getJobForEdit,
  updateJobStatus: api.updateJobStatus,
  deleteJobPosting: api.deleteJobPosting,
  deleteAllJobPostings: api.deleteAllJobPostings,

  // Public careers page
  getPublicJob: api.getPublicJob,
  submitApplication: api.submitJobApplication,

  // Applications
  getJobApplications: api.getJobApplications,

  // Reports
  getWeeklyAnalysisReport: api.getWeeklyAnalysisReport,
};

export default careersService;
