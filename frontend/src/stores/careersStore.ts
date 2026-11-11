import { MATCH_MAX_CVS, finishMatchProgress, runMatchJob, toMatchingProgress } from '@/lib/matchRun';
import { create } from 'zustand';
import { api } from '@/lib/api';
import {
  JobPostingResponse, 
  JobPostingListItem, 
  JobApplicationListItem,
  PublicJobView,
  JobApplicationResponse
} from '@/lib/types';
import { logger } from '@/lib/logger';

export interface JobFilters {
  q: string;
  scope: 'all' | 'mine' | 'others';
  status: 'all' | 'active' | 'inactive';
}

export interface MatchJobOptions {
  /** Include everyone who applied to the job (default true) */
  applicants?: boolean;
  /** Database candidates to score as well (ids from the job's boolean search) */
  databaseIds?: string[];
}

const NO_JOB_FILTERS: JobFilters = { q: '', scope: 'all', status: 'all' };

interface CareersState {
  // Job postings
  jobPostings: JobPostingListItem[];
  selectedJob: JobPostingListItem | null;
  totalJobPostings: number | null;
  /** What the server filters the postings by; the list is always one page at a time. */
  jobFilters: JobFilters;
  /** How many postings match the search and owner filter, open and closed (the tabs' numbers); from the server. */
  jobCounts: { all: number; active: number; inactive: number };
  
  // Applications
  applications: JobApplicationListItem[];
  /** The last match started from a job: which description it used and who of the matched people had applied (the rest came from the database). */
  lastMatch: { jdId: string; applicantIds: string[] } | null;
  
  // Public job viewing
  publicJob: PublicJobView | null;
  
  // CV Data Viewer
  viewingCVData: { cvId: string; filename: string; content: string } | null;
  
  // Loading states
  isLoading: boolean;
  isCreatingJob: boolean;
  isSubmittingApplication: boolean;
  isUpdatingStatus: boolean;
  
  // Error handling
  error: string | null;
}

interface CareersActions {
  // Job posting management
  createJobPostingWithFormData: (file: File | null, formData: any) => Promise<JobPostingResponse | null>;
  /** First page of the postings that match the filters (the filters are kept for the next pages and for later reloads). */
  loadJobPostings: (filters?: Partial<JobFilters>) => Promise<void>;
  loadMoreJobPostings: () => Promise<void>;
  selectJob: (job: JobPostingListItem | null) => void;
  updateJobStatus: (jobId: string, isActive: boolean) => Promise<boolean>;
  
  // Application management
  loadJobApplications: (jobId: string) => Promise<void>;
  /** Scores a job's candidates against it: its applicants, and/or the given database candidates (found by the job's boolean string). */
  matchJobCandidates: (jobId: string, options?: MatchJobOptions) => Promise<any>;
  convertToMatchResponse: (matchResults: any, jobData: any) => any;
  
  // Public actions (no auth required)
  loadPublicJob: (token: string) => Promise<void>;
  submitApplication: (
    token: string,
    name: string,
    email: string,
    phone: string | undefined,
    expectedSalary: number,
    yearsOfExperience: number,
    cvFile: File,
    location?: string,
    noticePeriod?: string,
    nationality?: string
  ) => Promise<JobApplicationResponse | null>;
  
  // CV Data Viewer
  setViewingCVData: (data: { cvId: string; filename: string; content: string } | null) => void;
  
  // Utilities
  clearError: () => void;
  reset: () => void;
}

type CareersStore = CareersState & CareersActions;

export const useCareersStore = create<CareersStore>((set, get) => ({
  // Initial state
  jobPostings: [],
  jobFilters: NO_JOB_FILTERS,
  jobCounts: { all: 0, active: 0, inactive: 0 },
  selectedJob: null,
  totalJobPostings: null,
  applications: [],
  lastMatch: null,
  publicJob: null,
  viewingCVData: null,
  isLoading: false,
  isCreatingJob: false,
  isSubmittingApplication: false,
  isUpdatingStatus: false,
  error: null,
  
  // Actions
  createJobPostingWithFormData: async (file: File | null, formData: any) => {
    set({ isCreatingJob: true, error: null });
    try {
      logger.info('Creating job posting with form data', { 
        hasFile: !!file,
        jobTitle: formData.jobTitle 
      });
      const result = await api.createJobPostingWithFormData(file, formData);
      
      logger.info('Job posting created successfully', { 
        jobId: result.job_id,
        publicLink: result.public_link 
      });
      
      // Reload job postings to include the new one
      get().loadJobPostings();
      
      set({ isCreatingJob: false });
      return result;
    } catch (error: any) {
      logger.error('Failed to create job posting with form data:', error);
      set({ 
        isCreatingJob: false, 
        error: error.message || 'Failed to create job posting' 
      });
      return null;
    }
  },

  loadJobPostings: async (filters?: Partial<JobFilters>) => {
    const active: JobFilters = { ...get().jobFilters, ...(filters ?? {}) };
    set({ isLoading: true, error: null, jobFilters: active });
    try {
      logger.info('Loading job postings (paginated, filtered by the server)');
      const JOBS_PAGE_SIZE = 20;
      // Load only the first page to reduce backend and frontend load
      const { jobs, total, counts } = await api.listJobPostingsPaged({
        includeInactive: true,
        limit: JOBS_PAGE_SIZE,
        offset: 0,
        ...active,
      });
      // a slower answer to an older filter must not overwrite the answer to the current one
      if (get().jobFilters !== active) return;

      logger.info(`Loaded ${jobs.length} job postings (of ${total})`);
      set({
        jobPostings: jobs,
        totalJobPostings: total,
        jobCounts: counts ?? { all: total, active: total, inactive: 0 },
        isLoading: false,
      });
    } catch (error: any) {
      logger.error('Failed to load job postings:', error);
      set({ 
        isLoading: false, 
        error: error.message || 'Failed to load job postings' 
      });
    }
  },

  // Load additional pages of job postings
  loadMoreJobPostings: async () => {
    const { jobPostings, totalJobPostings } = get();
    // Nothing more to load
    if (totalJobPostings != null && jobPostings.length >= totalJobPostings) {
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const JOBS_PAGE_SIZE = 20;
      const filtersNow = get().jobFilters;
      const { jobs, total } = await api.listJobPostingsPaged({
        includeInactive: true,
        limit: JOBS_PAGE_SIZE,
        offset: jobPostings.length,
        ...filtersNow,
      });
      if (get().jobFilters !== filtersNow) return;   // the filter changed while this page was coming

      set((state) => ({
        jobPostings: [...state.jobPostings, ...jobs],
        totalJobPostings: typeof total === 'number'
          ? total
          : state.totalJobPostings ?? state.jobPostings.length + jobs.length,
        isLoading: false,
      }));
    } catch (error: any) {
      logger.error('Failed to load more job postings:', error);
      set({
        isLoading: false,
        error: error.message || 'Failed to load more job postings',
      });
    }
  },
  
  selectJob: (job: JobPostingListItem | null) => {
    if (job) {
      logger.info('Selected job', { jobId: job.job_id, title: job.job_title });
      set({ selectedJob: job });
      // Auto-load applications when job is selected
      get().loadJobApplications(job.job_id);
    } else {
      logger.info('Cleared selected job');
      set({ selectedJob: null });
    }
  },
  
  updateJobStatus: async (jobId: string, isActive: boolean) => {
    set({ isUpdatingStatus: true, error: null });
    try {
      logger.info('Updating job status', { jobId, isActive });
      await api.updateJobStatus(jobId, { is_active: isActive });
      
      // Update the job in the local state
      set((state) => ({
        jobPostings: state.jobPostings.map(job => 
          job.job_id === jobId ? { ...job, is_active: isActive } : job
        ),
        selectedJob: state.selectedJob?.job_id === jobId 
          ? { ...state.selectedJob, is_active: isActive } 
          : state.selectedJob,
        isUpdatingStatus: false
      }));
      
      logger.info('Job status updated successfully', { jobId, isActive });
      return true;
    } catch (error: any) {
      logger.error('Failed to update job status:', error);
      set({ 
        isUpdatingStatus: false, 
        error: error.message || 'Failed to update job status' 
      });
      return false;
    }
  },
  
  loadJobApplications: async (jobId: string) => {
    set({ isLoading: true, error: null });
    try {
      logger.info('Loading applications for job', { jobId });
      const applications = await api.getJobApplications(jobId);
      
      logger.info(`Loaded ${applications.length} applications for job ${jobId}`);
      set({ applications, isLoading: false });
    } catch (error: any) {
      logger.error('Failed to load applications:', error);
      set({ 
        isLoading: false, 
        error: error.message || 'Failed to load applications' 
      });
    }
  },

  matchJobCandidates: async (jobId: string, options: MatchJobOptions = {}) => {
    const { applicants: withApplicants = true, databaseIds = [] } = options;
    set({ isLoading: true, error: null });
    
    // Set careers matching loading state in app store
    const { useAppStore } = await import('./appStore');
    const appStore = useAppStore.getState();
    appStore.setLoading('careersMatching', true);
    try {
      logger.info('Matching candidates for job', { jobId, withApplicants, databaseCandidates: databaseIds.length });

      // The applicants are read fresh from the server (not from whatever list happens to be on screen), then the database
      // candidates are added; a person is scored once even if both lists name them.
      const currentApplications = await api.getJobApplications(jobId);
      set({ applications: currentApplications });
      const applicantIds = withApplicants ? currentApplications.map(app => app.application_id) : [];
      const cvIds = Array.from(new Set([...applicantIds, ...databaseIds])).slice(0, MATCH_MAX_CVS);

      if (cvIds.length === 0) {
        throw new Error('There is nobody to match yet: this job has no applicants and no database candidates fit its search.');
      }

      appStore.setMatchingProgress({
        totalCVs: cvIds.length,
        processedCVs: 0,
        percent: 0,
        currentStage: 'initializing',
        isVisible: true,
        estimatedTimeRemaining: undefined,
        currentBatch: 0,
        totalBatches: 0,
        phase: 'initializing',
        currentCandidate: null,
        recentCandidates: [],
        llmDone: 0,
        llmTotal: 0,
      });

      // Get the job posting details to find the original JD ID
      const jobData = await api.getJobForMatching(jobId);
      let originalJdId = (jobData as any).jd_id || jobId; // Use jd_id if available, fallback to jobId
      
      // If the job posting doesn't have a linked JD, this is a legacy job posting
      if (!(jobData as any).jd_id) {
        logger.warn('Legacy job posting has no linked JD - this should be fixed by updating the job posting', { 
          jobId, 
          jobTitle: jobData.job_title 
        });
        
        // For legacy job postings, try to find a matching JD by title
        const availableJds = await api.listJDs();
        
        // Try multiple matching strategies
        let matchingJd = null;
        
        // Strategy 1: Exact title match
        matchingJd = availableJds.jds?.find((jd: any) => 
          jd.job_title && jobData.job_title && 
          jd.job_title.toLowerCase() === jobData.job_title.toLowerCase()
        );
        
        // Strategy 2: Title contains match
        if (!matchingJd) {
          matchingJd = availableJds.jds?.find((jd: any) => 
            jd.job_title && jobData.job_title && 
            (jd.job_title.toLowerCase().includes(jobData.job_title.toLowerCase()) ||
             jobData.job_title.toLowerCase().includes(jd.job_title.toLowerCase()))
          );
        }
        
        // Strategy 3: If only one JD available, use it (fallback for test data)
        if (!matchingJd && availableJds.jds?.length === 1) {
          matchingJd = availableJds.jds[0];
          logger.warn('Using only available JD as fallback for legacy job', { 
            jobId, 
            jobTitle: jobData.job_title, 
            fallbackJdTitle: matchingJd.job_title 
          });
        }
        
        // Strategy 4: If multiple JDs available but no match, use the first one (fallback)
        if (!matchingJd && availableJds.jds?.length > 0) {
          matchingJd = availableJds.jds[0];
          logger.warn('Using first available JD as fallback for legacy job (no title match found)', { 
            jobId, 
            jobTitle: jobData.job_title, 
            fallbackJdTitle: matchingJd.job_title,
            totalJds: availableJds.jds.length
          });
        }
        
        if (matchingJd) {
          originalJdId = matchingJd.id;
          logger.info('Found matching JD for legacy job', { 
            jobId, 
            originalJdId, 
            jobTitle: jobData.job_title,
            matchedJdTitle: matchingJd.job_title 
          });
        } else {
          const availableTitles = availableJds.jds?.map((jd: any) => jd.job_title) || [];
          logger.error('No matching JD found for legacy job posting', { 
            jobId, 
            jobTitle: jobData.job_title,
            availableJds: availableTitles,
            totalJds: availableJds.jds?.length || 0
          });
          throw new Error(`No matching job description found for "${jobData.job_title}". Available JDs (${availableJds.jds?.length || 0}): ${availableTitles.join(', ')}`);
        }
      } else {
        logger.info('Using linked JD for matching', { 
          jobId, 
          originalJdId, 
          jobTitle: jobData.job_title 
        });
      }
      
      logger.info('Using JD ID for matching', { jobId, originalJdId });
      
      // Same runner as the Match page: real progress from the backend job, no time-based guessing.
      const matchResults = await runMatchJob({ jd_id: originalJdId, cv_ids: cvIds }, (u) => {
        appStore.setMatchingProgress(toMatchingProgress(u));
      });

      await finishMatchProgress((p) => appStore.setMatchingProgress(p as never));
      appStore.hideMatchingProgress?.();

      logger.info(`Matching completed for job ${jobId}`, { 
        totalCandidates: matchResults.candidates.length,
        matchResults: matchResults
      });
      
      set({ lastMatch: { jdId: originalJdId, applicantIds: currentApplications.map(app => app.application_id) } });

      // Store match results in app store for display in match tab
      appStore.setCareersMatchResult(matchResults);
      appStore.setCareersMatchData({
        jobId: originalJdId, // Use the actual JD ID that was used for matching
        jobTitle: get().selectedJob?.job_title || 'Job',
        cvIds: cvIds
      });
      
      // Convert match results back to application format with scores
      const applicationsWithScores = currentApplications.map(app => {
        const candidate = matchResults.candidates.find(c => c.cv_id === app.application_id);
        return {
          ...app,
          match_score: candidate ? candidate.overall_score : undefined,
          skills_score: candidate ? candidate.skills_score : undefined,
          responsibilities_score: candidate ? candidate.responsibilities_score : undefined,
          job_title_score: candidate ? candidate.job_title_score : undefined,
          years_score: candidate ? candidate.years_score : undefined,
          skills_assignments: candidate ? candidate.skills_assignments : [],
          responsibilities_assignments: candidate ? candidate.responsibilities_assignments : [],
          skills_alternatives: candidate ? candidate.skills_alternatives : [],
          responsibilities_alternatives: candidate ? candidate.responsibilities_alternatives : []
        };
      });
      
      // Update applications with match scores
      set((state) => ({
        applications: applicationsWithScores,
        isLoading: false
      }));
      
      appStore.setLoading('careersMatching', false);
      
      return {
        job_id: jobId,
        job_title: matchResults.jd_job_title,
        total_applications: applicationsWithScores.length,
        matched_applications: applicationsWithScores,
        top_candidates: applicationsWithScores.slice(0, 10)
      };
    } catch (error: any) {
      appStore.hideMatchingProgress?.();
      logger.error('Failed to match candidates:', error);
      const errorMessage = error?.detail || error?.response?.data?.detail || error?.message || 'Failed to match candidates';
      set({ isLoading: false, error: errorMessage });
      appStore.setLoading('careersMatching', false, errorMessage);
      throw error;
    }
  },

  convertToMatchResponse: (matchResults: any, jobData: any) => {
    // The matchResults from /match API already has the correct format
    // Just need to ensure it has the right structure for the matching page
    logger.info('Converting match results to MatchResponse format', {
      matchResults,
      jobData,
      candidatesCount: matchResults.candidates?.length || 0
    });
    
    const result = {
      jd_id: matchResults.jd_id || jobData.job_id,
      jd_job_title: matchResults.jd_job_title || jobData.title,
      jd_years: matchResults.jd_years || jobData.experience_required || 0,
      normalized_weights: matchResults.normalized_weights || {
        skills: 80,
        responsibilities: 15,
        job_title: 2.5,
        experience: 2.5
      },
      candidates: matchResults.candidates || []
    };
    
    logger.info('Converted MatchResponse', result);
    return result;
  },

  
  // stores/careersStore.ts

loadPublicJob: async (token: string) => {
  set({ isLoading: true, error: null, publicJob: null });   // never show a previous link's job while this one loads
  try {
    logger.info('Loading public job', { token: token.substring(0, 8) + '...' });
    const job = await api.getPublicJob(token);
    
    logger.info('Public job loaded successfully', { 
      jobId: job.job_id, 
      title: job.job_title 
    });
    set({ publicJob: job, isLoading: false });
  } catch (error: any) {
    logger.error('Failed to load public job:', error);
    set({ 
      isLoading: false, 
      error: error.message || 'Job not found or no longer available' 
    });
  }
},
  submitApplication: async (token: string, name: string, email: string, phone: string | undefined, expectedSalary: number, yearsOfExperience: number, cvFile: File, location?: string, noticePeriod?: string, nationality?: string) => {
    set({ isSubmittingApplication: true, error: null });
    try {
      logger.info('Submitting job application', {
        token: token.substring(0, 8) + '...',
        applicantName: name,
        applicantEmail: email,
        cvFileName: cvFile.name
      });

      const result = await api.submitJobApplication(token, name, email, phone, expectedSalary, yearsOfExperience, cvFile, location, noticePeriod, nationality);
      
      logger.info('Application submitted successfully', { 
        applicationId: result.application_id 
      });
      
      set({ isSubmittingApplication: false });
      return result;
    } catch (error: any) {
      logger.error('Failed to submit application:', error);
      const msg =
        (typeof error?.detail === 'string' && error.detail) ||
        (typeof error?.message === 'string' && error.message) ||
        'Failed to submit application';
      set({
        isSubmittingApplication: false,
        error: msg,
      });
      return null;
    }
  },
  
  setViewingCVData: (data: { cvId: string; filename: string; content: string } | null) => {
    set({ viewingCVData: data });
  },
  
  clearError: () => {
    set({ error: null });
  },
  
  reset: () => {
    logger.info('Resetting careers store');
    set({
      jobPostings: [],
      jobFilters: NO_JOB_FILTERS,
      selectedJob: null,
      applications: [],
      lastMatch: null,
      publicJob: null,
      viewingCVData: null,
      isLoading: false,
      isCreatingJob: false,
      isSubmittingApplication: false,
      isUpdatingStatus: false,
      error: null,
    });
  },
}));