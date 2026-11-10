import { MATCH_MAX_CVS, finishMatchProgress, loadActiveMatch, resumeMatchJob, runMatchJob, toMatchingProgress } from '@/lib/matchRun';
import { useAuthStore } from '@/stores/authStore';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  MatchWeights,
  MatchResponse,
  CVListItem,
  JDListItem,
  HealthResponse,
  MatchRequest,
  SystemStatsResponse,
  DatabaseViewResponse,
  // Queue types removed
} from '@/lib/types';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';

interface LoadingState {
  isLoading: boolean;
  error?: string | null;
}

interface MatchingProgress {
  totalCVs: number;
  processedCVs: number;
  currentStage: 'initializing' | 'processing' | 'analyzing' | 'scoring' | 'finalizing';
  estimatedTimeRemaining?: number;
  isVisible: boolean;
  /** Current batch completed (1-based). Backend processes in chunks of 50. */
  currentBatch?: number;
  /** Total batches (ceil(totalCVs/50)). */
  totalBatches?: number;
  /** Phase for status message: batches = "Batch N matched", llm_verification = "AI accurate matching". */
  phase?: 'initializing' | 'batches' | 'llm_verification' | 'finalizing';
  /** Live: name of the CV whose score was just computed. */
  currentCandidate?: string | null;
  /** Live: most-recently-scored candidates, newest first. */
  recentCandidates?: { cv_id: string; cv_name: string }[];
  /** The one progress number (0-100) from the backend: never guessed from time, never decreases within a run. */
  percent?: number;
  /** AI verification of the top candidates: finished / total. */
  llmDone?: number;
  llmTotal?: number;
}

interface AppState {
  // Current tab
  currentTab: 'dashboard' | 'upload' | 'database' | 'candidates' | 'jobs' | 'match' | 'careers' | 'reports' | 'system' | 'monitor';
  
  // Database tab state
  databaseActiveTab: 'cvs' | 'jds';
  
  // Data
  cvs: CVListItem[];
  jds: JDListItem[];
  /** Total count from API when using pagination (so UI can show "X of Y") */
  totalCVs: number | null;
  totalJDs: number | null;
  selectedJD: string | null;
  selectedCVs: string[];
  /** Names of CVs picked on pages that do not load the whole Candidates list (Saved CVs), so the match tray can name them. */
  knownCVs: Record<string, { name: string; title: string }>;
  
  // Matching
  matchWeights: MatchWeights;
  matchResult: MatchResponse | null;
  matchingProgress: MatchingProgress;
  
  // Queue state
  matchingQueue: {
    isQueued: boolean;
    queuePosition: number | null;
    estimatedWaitTime: number | null; // seconds
    message: string | null;
  } | null;
  
  // Health
  systemHealth: HealthResponse | null;
  systemStats: SystemStatsResponse | null;
  databaseView: DatabaseViewResponse | null;
  
  // Loading states
  loadingStates: {
    cvs: LoadingState;
    jds: LoadingState;
    upload: LoadingState;
    matching: LoadingState;
    careersMatching: LoadingState;
    health: LoadingState;
    stats: LoadingState;
    database: LoadingState;
    // queue: LoadingState; // removed
  };
  
  // Actions
  setCurrentTab: (tab: AppState['currentTab']) => void;
  setDatabaseActiveTab: (tab: AppState['databaseActiveTab']) => void;
  setCareersMatchResult: (matchResult: MatchResponse) => void;
  setCareersMatchData: (data: { jobId: string; jobTitle: string; cvIds: string[] }) => void;
  
  // CV actions
  loadCVs: () => Promise<void>;
  loadMoreCVs: () => Promise<void>;
  selectCV: (cvId: string) => void;
  deselectCV: (cvId: string) => void;
  selectAllCVs: () => void;
  deselectAllCVs: () => void;
  rememberCVs: (items: { id: string; full_name?: string; filename?: string; job_title?: string }[]) => void;
  uploadCV: (file: File) => Promise<void>;
  uploadCVs: (files: File[]) => Promise<void>;
  deleteCV: (cvId: string) => Promise<void>;

  // JD actions
  loadJDs: () => Promise<void>;
  loadMoreJDs: () => Promise<void>;
  selectJD: (jdId: string | null) => void;
  uploadJD: (file: File) => Promise<void>;
  deleteJD: (jdId: string) => Promise<void>;

  // Matching actions
  setMatchWeights: (weights: Partial<MatchWeights>) => void;
  runMatch: (request?: Partial<MatchRequest>) => Promise<void>;
  /** Re-attaches to a match that was still running when the page was reloaded; resolves true when its results are now in the store. */
  resumeMatch: () => Promise<boolean>;
  clearMatchResult: () => void;
  setMatchingProgress: (progress: Partial<MatchingProgress>) => void;
  hideMatchingProgress: () => void;
  setMatchingQueue: (queue: AppState['matchingQueue']) => void;
  
  // Queue management actions removed
  
  // System actions
  loadSystemHealth: () => Promise<void>;
  loadSystemStats: () => Promise<void>;
  loadDatabaseView: () => Promise<void>;
  
  // Utility actions
  setLoading: (operation: keyof AppState['loadingStates'], loading: boolean, error?: string) => void;
  clearError: (operation: keyof AppState['loadingStates']) => void;
}

const APP_CURRENT_TAB_KEY = 'alpha_cv_current_tab';

/** Page size for CV/JD list API calls to keep responses small and fast */
const LIST_PAGE_SIZE = 200;

const defaultWeights: MatchWeights = {
  skills: 80,
  responsibilities: 15,
  job_title: 2.5,
  experience: 2.5,
};

export const useAppStore = create<AppState>()(
  devtools(
    (set, get) => ({
      // Initial state
      currentTab: 'dashboard',
      databaseActiveTab: 'cvs',
      cvs: [],
      jds: [],
      totalCVs: null,
      totalJDs: null,
      selectedJD: null,
      selectedCVs: [],
      knownCVs: {},
      matchWeights: defaultWeights,
      matchResult: null,
      matchingProgress: {
        totalCVs: 0,
        processedCVs: 0,
        currentStage: 'initializing',
        isVisible: false,
        currentBatch: 0,
        totalBatches: 0,
        phase: 'initializing',
      },
      // Queue state removed
      systemHealth: null,
      systemStats: null,
      databaseView: null,
      
      loadingStates: {
        cvs: { isLoading: false, error: null },
        jds: { isLoading: false, error: null },
        upload: { isLoading: false, error: null },
        matching: { isLoading: false, error: null },
        careersMatching: { isLoading: false, error: null },
        health: { isLoading: false, error: null },
        stats: { isLoading: false, error: null },
        database: { isLoading: false, error: null },
        // queue: { isLoading: false, error: null }, // removed
      },
      
      // Actions
      setCurrentTab: (tab) => {
        set({ currentTab: tab });
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(APP_CURRENT_TAB_KEY, tab);
          } catch {
            /* ignore */
          }
        }

        // Auto-load data when switching to relevant tabs
        const state = get();
        if (tab === 'database' && state.cvs.length === 0) {
          state.loadCVs();
          state.loadJDs();
        } else if (tab === 'system' && !state.systemHealth) {
          state.loadSystemHealth();
          state.loadSystemStats();
          state.loadDatabaseView();
        }
      },
      
      setDatabaseActiveTab: (tab) => {
        set({ databaseActiveTab: tab });
      },

      setCareersMatchResult: (matchResult) => {
        set({ matchResult });
      },
      
      setCareersMatchData: (data) => {
        set({ 
          selectedJD: data.jobId,
          selectedCVs: data.cvIds
          // Don't clear matchResult - keep the careers matching results
        });
      },
      
      // CV actions
      loadCVs: async () => {
        const { setLoading } = get();
        setLoading('cvs', true);
        
        try {
          logger.info('Loading CVs from API (paginated)');
          const response = await api.listCVs({ limit: LIST_PAGE_SIZE, offset: 0 });
          const total = response.total ?? response.cvs.length;
          set({
            cvs: response.cvs,
            totalCVs: total,
          });
          setLoading('cvs', false);
          logger.info(`Loaded ${response.cvs.length} CVs${total > response.cvs.length ? ` of ${total}` : ''}`);
        } catch (error: any) {
          logger.error('Failed to load CVs', error);
          setLoading('cvs', false, error.message);
        }
      },
      
      loadMoreCVs: async () => {
        const { setLoading, cvs, totalCVs } = get();
        if (totalCVs != null && cvs.length >= totalCVs) return;
        setLoading('cvs', true);
        try {
          const response = await api.listCVs({ limit: LIST_PAGE_SIZE, offset: cvs.length });
          set((s) => ({
            cvs: [...s.cvs, ...response.cvs],
            totalCVs: response.total ?? s.totalCVs ?? s.cvs.length + response.cvs.length,
          }));
          setLoading('cvs', false);
          logger.info(`Loaded more CVs: ${cvs.length + response.cvs.length} total`);
        } catch (error: any) {
          logger.error('Failed to load more CVs', error);
          setLoading('cvs', false, error.message);
        }
      },
      
      selectCV: (cvId) => {
        set((state) => ({
          selectedCVs: state.selectedCVs.includes(cvId)
            ? state.selectedCVs
            : [...state.selectedCVs, cvId],
        }));
      },
      
      deselectCV: (cvId) => {
        set((state) => ({
          selectedCVs: state.selectedCVs.filter(id => id !== cvId),
        }));
      },
      
      selectAllCVs: () => {
        const { cvs } = get();
        set({ selectedCVs: cvs.map(cv => cv.id) });
      },
      
      deselectAllCVs: () => {
        set({ selectedCVs: [] });
      },

      rememberCVs: (items) => {
        set((state) => {
          const next = { ...state.knownCVs };
          for (const cv of items) next[cv.id] = { name: cv.full_name || cv.filename || 'Candidate', title: cv.job_title && cv.job_title !== 'Not specified' ? cv.job_title : '' };
          return { knownCVs: next };
        });
      },
      
      uploadCV: async (file) => {
        const { setLoading, loadCVs } = get();
        setLoading('upload', true);
        
        try {
          logger.info(`Uploading CV file: ${file.name}`);
          await api.uploadCV(file);
          
          // Reload CVs after successful upload
          await loadCVs();
          setLoading('upload', false);
          logger.info('CV upload completed successfully');
        } catch (error: any) {
          logger.error('Failed to upload CV', error);
          setLoading('upload', false, error.message);
        }
      },
      
      uploadCVs: async (files) => {
        const { setLoading, loadCVs } = get();
        setLoading('upload', true);
        
        try {
          logger.info(`Uploading ${files.length} CV files`);
          for (const file of files) {
            await api.uploadCV(file);
          }
          
          // Reload CVs after successful upload
          await loadCVs();
          setLoading('upload', false);
          logger.info('CV uploads completed successfully');
        } catch (error: any) {
          logger.error('Failed to upload CVs', error);
          setLoading('upload', false, error.message);
        }
      },
      
      deleteCV: async (cvId) => {
        const { setLoading, loadCVs } = get();
        setLoading('upload', true);
        
        try {
          logger.info(`Deleting CV: ${cvId}`);
          await api.deleteCV(cvId);
          
          // Reload CVs after successful deletion
          await loadCVs();
          setLoading('upload', false);
          logger.info('CV deletion completed successfully');
        } catch (error: any) {
          logger.error('Failed to delete CV', error);
          setLoading('upload', false, error.message);
        }
      },
      
      // JD actions
      loadJDs: async () => {
        const { setLoading } = get();
        setLoading('jds', true);
        
        try {
          logger.info('Loading JDs from API (paginated)');
          const response = await api.listJDs({ limit: LIST_PAGE_SIZE, offset: 0 });
          const total = response.total ?? response.jds.length;
          set({
            jds: response.jds,
            totalJDs: total,
          });
          setLoading('jds', false);
          logger.info(`Loaded ${response.jds.length} JDs${total > response.jds.length ? ` of ${total}` : ''}`);
        } catch (error: any) {
          logger.error('Failed to load JDs', error);
          setLoading('jds', false, error.message);
        }
      },
      
      loadMoreJDs: async () => {
        const { setLoading, jds, totalJDs } = get();
        if (totalJDs != null && jds.length >= totalJDs) return;
        setLoading('jds', true);
        try {
          const response = await api.listJDs({ limit: LIST_PAGE_SIZE, offset: jds.length });
          set((s) => ({
            jds: [...s.jds, ...response.jds],
            totalJDs: response.total ?? s.totalJDs ?? s.jds.length + response.jds.length,
          }));
          setLoading('jds', false);
          logger.info(`Loaded more JDs: ${jds.length + response.jds.length} total`);
        } catch (error: any) {
          logger.error('Failed to load more JDs', error);
          setLoading('jds', false, error.message);
        }
      },
      
      selectJD: (jdId) => {
        set({ selectedJD: jdId });
      },
      
      uploadJD: async (file) => {
        const { setLoading, loadJDs } = get();
        setLoading('upload', true);
        
        try {
          logger.info(`Uploading JD file: ${file.name}`);
          await api.uploadJD(file);
          
          // Reload JDs after successful upload
          await loadJDs();
          setLoading('upload', false);
          logger.info('JD upload completed successfully');
        } catch (error: any) {
          logger.error('Failed to upload JD', error);
          setLoading('upload', false, error.message);
        }
      },
      
      deleteJD: async (jdId) => {
        const { setLoading, loadJDs } = get();
        setLoading('upload', true);
        
        try {
          logger.info(`Deleting JD: ${jdId}`);
          await api.deleteJD(jdId);
          
          // Reload JDs after successful deletion
          await loadJDs();
          setLoading('upload', false);
          logger.info('JD deletion completed successfully');
        } catch (error: any) {
          logger.error('Failed to delete JD', error);
          setLoading('upload', false, error.message);
        }
      },
      
      // Matching actions
      setMatchWeights: (weights) => {
        set((state) => ({
          matchWeights: { ...state.matchWeights, ...weights },
        }));
      },
      
      runMatch: async (request: Partial<MatchRequest> = {}) => {
        const { setLoading, selectedJD, selectedCVs, setMatchingProgress, hideMatchingProgress } = get();

        setLoading('matching', true);

        try {
          if (!selectedJD && !request.jd_text) {
            throw new Error('Please select a job description first');
          }

          // One match scores at most MATCH_MAX_CVS CVs (the backend refuses more).
          if (selectedCVs.length > MATCH_MAX_CVS) {
            throw new Error(`A match can score at most ${MATCH_MAX_CVS.toLocaleString()} CVs. You selected ${selectedCVs.length.toLocaleString()}.`);
          }
          const matchRequest: MatchRequest = {
            jd_id: selectedJD || undefined,
            cv_ids: selectedCVs.length > 0 ? selectedCVs : undefined,
            top_alternatives: 3,
            ...request,
          };

          setMatchingProgress({
            totalCVs: selectedCVs.length,
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

          logger.info('Starting candidate matching', matchRequest);

          const result = await runMatchJob(matchRequest, (u) => {
            setMatchingProgress(toMatchingProgress(u));
            set({
              matchingQueue: u.waiting
                ? { isQueued: true, queuePosition: u.queuePosition, estimatedWaitTime: u.estimatedWaitTime, message: u.message }
                : null,
            });
          }, { remember: true, owner: useAuthStore.getState().user?.username });

          await finishMatchProgress(setMatchingProgress);   // the bar reaches 100 before the results replace it
          hideMatchingProgress();
          set({ matchResult: result, matchingQueue: null });
          setLoading('matching', false);
          logger.info(`Matching completed: ${result.candidates.length} candidates processed`);
        } catch (error: any) {
          logger.error('Failed to run matching', error);
          hideMatchingProgress();
          setMatchingProgress({ isVisible: false });
          set({ matchingQueue: null });
          const errorMessage = error?.detail || error?.response?.data?.detail || error?.message || 'Failed to run matching';
          setLoading('matching', false, errorMessage);
        }
      },

      resumeMatch: async () => {
        const { setLoading, setMatchingProgress, hideMatchingProgress } = get();
        const active = loadActiveMatch(useAuthStore.getState().user?.username);
        if (!active || get().loadingStates.matching.isLoading) return false;

        setLoading('matching', true);
        try {
          setMatchingProgress({
            totalCVs: active.totalCVs,
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
          logger.info('Resuming the match that was running before the reload', active.jobId);
          const result = await resumeMatchJob(active, (u) => {
            setMatchingProgress(toMatchingProgress(u));
            set({
              matchingQueue: u.waiting
                ? { isQueued: true, queuePosition: u.queuePosition, estimatedWaitTime: u.estimatedWaitTime, message: u.message }
                : null,
            });
          });
          await finishMatchProgress(setMatchingProgress);
          hideMatchingProgress();
          set({ matchResult: result, matchingQueue: null });
          setLoading('matching', false);
          return true;
        } catch (error: any) {
          hideMatchingProgress();
          setMatchingProgress({ isVisible: false });
          set({ matchingQueue: null });
          if (error?.response?.status === 404) {          // the result has expired on the server: nothing to show, nothing to report
            setLoading('matching', false);
            return false;
          }
          const errorMessage = error?.detail || error?.response?.data?.detail || error?.message || 'Failed to run matching';
          setLoading('matching', false, errorMessage);
          return false;
        }
      },

      clearMatchResult: () => {
        set({ matchResult: null });
      },
      
      setMatchingProgress: (progress) => {
        set((state) => ({
          matchingProgress: { ...state.matchingProgress, ...progress },
        }));
      },
      
      hideMatchingProgress: () => {
        set((state) => ({
          matchingProgress: { ...state.matchingProgress, isVisible: false },
        }));
      },
      
      setMatchingQueue: (queue) => {
        set({ matchingQueue: queue });
      },
      
      // System actions
      loadSystemHealth: async () => {
        const { setLoading } = get();
        setLoading('health', true);
        
        try {
          logger.info('Checking system health');
          const health = await api.healthCheck();
          set({ systemHealth: health });
          setLoading('health', false);
          logger.info('System health check completed', { status: health.status });
        } catch (error: any) {
          logger.error('Failed to check system health', error);
          setLoading('health', false, error.message);
        }
      },
      
      loadSystemStats: async () => {
        const { setLoading } = get();
        setLoading('stats', true);
        
        try {
          logger.info('Loading system stats');
          const stats = await api.getSystemStats();
          set({ systemStats: stats });
          setLoading('stats', false);
          logger.info('System stats loaded');
        } catch (error: any) {
          logger.error('Failed to load system stats', error);
          setLoading('stats', false, error.message);
        }
      },
      
      loadDatabaseView: async () => {
        const { setLoading } = get();
        setLoading('database', true);
        
        try {
          logger.info('Loading database view');
          const view = await api.getDatabaseView();
          set({ databaseView: view });
          setLoading('database', false);
          logger.info('Database view loaded');
        } catch (error: any) {
          logger.error('Failed to load database view', error);
          setLoading('database', false, error.message);
        }
      },
      
      // Utility actions
      setLoading: (operation, loading, error) => {
        set((state) => ({
          loadingStates: {
            ...state.loadingStates,
            [operation]: { isLoading: loading, error: error || null },
          },
        }));
      },
      
      clearError: (operation) => {
        set((state) => ({
          loadingStates: {
            ...state.loadingStates,
            [operation]: { ...state.loadingStates[operation], error: null },
          },
        }));
      },
      
      // Queue management actions removed
    }),
    {
      name: 'cv-analyzer-store',
    }
  )
);