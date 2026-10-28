'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackerApi, type TrackerTeam } from '@/lib/trackerApi';
import { useAuthStore } from '@/stores/authStore';
import type { TrackerApplication, TrackerCandidate, TrackerFollowUp, TrackerJobOpening, TrackerOption } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ManagedSelect } from '@/components/tracker/ManagedSelect';
import {
  ArrowLeft,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
  Shield,
  Save,
} from 'lucide-react';
import type { ConfirmDeleteType, TeamView, TextPeekState, ViewMode } from './types';
import { FOLLOW_UP_STAGE_OPTIONS } from './types';
import {
  _norm,
  downloadBlob,
  formatDdMmYy,
  isBackoutStatus,
  isJoinedStatus,
  isOfferReleasedStatus,
  isOverdue,
  stageBadgeClass,
} from './utils';
import { StatusBadge } from './components/FormFields';
import { SyncedXScroll } from './components/SyncedXScroll';
import {
  EditApplicationDialog,
  EditJobOpeningDialog,
  FollowUpDialog,
  NewCandidateDialog,
  NewJobOpeningDialog,
} from './components/dialogs/TrackerDialogs';
import { ImportSelectionsModal } from './components/ImportSelectionsModal';
import { TextPeekDialog } from './components/TextPeekDialog';
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog';

export default function TrackerWorkspace() {
  const router = useRouter();
  const { token, user, logout } = useAuthStore();
  const isAdminLike = user?.role === 'admin' || user?.role === 'evp';
  const isAdmin = user?.role === 'admin';

  const handleLogout = useCallback(() => {
    logout();
    router.push('/login');
  }, [logout, router]);

  const formatDate = useCallback((v?: string | null) => formatDdMmYy(v), []);
  const formatDateTime = useCallback((v?: string | null) => {
    if (!v) return '';
    const raw = String(v).trim();
    // Many backends return timestamps like "2026-04-22 07:00:00" (no timezone).
    // JS treats those as *local time*, which breaks UAE display. Treat tz-less values as UTC.
    const looksLikeHasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
    const isoish =
      looksLikeHasTz
        ? raw
        : raw.includes('T')
          ? `${raw}Z`
          : raw.includes(' ')
            ? `${raw.replace(' ', 'T')}Z`
            : raw;
    const d = new Date(isoish);
    if (Number.isNaN(d.getTime())) return String(v);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
  }, []);

  const [teamView, setTeamView] = useState<TeamView>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tracker_team_view');
      if (saved === 'dubai' || saved === 'abudhabi' || saved === 'all') return saved as TeamView;
    }
    return 'dubai';
  });

  const setTeamViewPersisted = (v: TeamView) => {
    setTeamView(v);
    if (typeof window !== 'undefined') localStorage.setItem('tracker_team_view', v);
  };

  const apiTeam: TrackerTeam | undefined = isAdminLike && teamView !== 'all' ? teamView : undefined;
  const isAllTeamsView = isAdminLike && teamView === 'all';
  /** account_manager has FULL tracker write access (manager-level within the tracker). */
  const isAccountManager = user?.role === 'account_manager';
  /** Requirements grid: admin, manager, evp & account_manager; recruiters see this tab as view-only. */
  const canWriteJobs = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'evp' || isAccountManager;
  /** Recruiter persona: `user` and `recruiter` are treated the same. */
  const isRecruiterUser = user?.role === 'recruiter' || user?.role === 'user';
  const canWriteCandidates = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'evp' || isAccountManager;
  // Follow-ups: recruiters also get write access.
  const canWriteFollowUps = canWriteJobs || isRecruiterUser;
  const isReadOnlyTracker = !canWriteJobs && !canWriteCandidates && !canWriteFollowUps;
  const canManageJobOptions = canWriteJobs;
  const canManageCandidateOptions = canWriteCandidates;

  const noopAsync = useCallback(async () => { }, []);

  const [textPeek, setTextPeek] = useState<null | {
    title: string;
    text: string;
    canEdit: boolean;
    onSave?: (nextText: string) => Promise<void>;
  }>(null);
  const [textPeekDraft, setTextPeekDraft] = useState('');
  const [textPeekSaving, setTextPeekSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTeam, setImportTeam] = useState<TrackerTeam>('abudhabi');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const truncate10 = (v?: string | null) => {
    const s = String(v || '').trim();
    if (!s) return '';
    return s.length <= 10 ? s : `${s.slice(0, 10)}…`;
  };

  // Persist view across page reloads
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tracker_view');
      if (saved === 'jobOpenings' || saved === 'candidateProfiles' || saved === 'followUps' || saved === 'managerSettings') return saved as any;
    }
    return 'jobOpenings';
  });

  const setViewPersisted = (v: ViewMode) => {
    setView(v);
    if (typeof window !== 'undefined') localStorage.setItem('tracker_view', v);
  };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [jobOpenings, setJobOpenings] = useState<TrackerJobOpening[]>([]);
  const [candidates, setCandidates] = useState<TrackerCandidate[]>([]);
  const [applications, setApplications] = useState<TrackerApplication[]>([]);
  const [followUps, setFollowUps] = useState<TrackerFollowUp[]>([]);

  const [filterStatus, setFilterStatus] = useState('all');
  // Location removed from Tracker
  const [search, setSearch] = useState('');
  const [followupSearch, setFollowupSearch] = useState('');
  const [followupStageFilter, setFollowupStageFilter] = useState('all');
  const [followupNextFrom, setFollowupNextFrom] = useState('');
  const [followupNextTo, setFollowupNextTo] = useState('');
  const [jobDateFrom, setJobDateFrom] = useState('');
  const [jobDateTo, setJobDateTo] = useState('');
  const [candDateFrom, setCandDateFrom] = useState('');
  const [candDateTo, setCandDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'latest' | 'oldest'>('latest');
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [editJob, setEditJob] = useState<TrackerJobOpening | null>(null);
  const [editApp, setEditApp] = useState<{ app: TrackerApplication; cand: TrackerCandidate } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteType, setConfirmDeleteType] = useState<'job' | 'candidate' | 'followup' | null>(null);
  const [editFollowUp, setEditFollowUp] = useState<{ mode: 'create' } | { mode: 'edit'; row: TrackerFollowUp } | null>(null);

  const [candidateStatusOptions, setCandidateStatusOptions] = useState<TrackerOption[]>([]);
  const [jobStatusOptions, setJobStatusOptions] = useState<TrackerOption[]>([]);
  const [recruiterOptions, setRecruiterOptions] = useState<TrackerOption[]>([]);
  const [accountManagerOptions, setAccountManagerOptions] = useState<TrackerOption[]>([]);
  const [recruitmentManagerOptions, setRecruitmentManagerOptions] = useState<TrackerOption[]>([]);
  const [requirementOptions, setRequirementOptions] = useState<TrackerOption[]>([]);
  const [followUpStageOptions, setFollowUpStageOptions] = useState<TrackerOption[]>([]);

  const canAccessManagerSettings = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'evp';
  const [msRecruiters, setMsRecruiters] = useState<TrackerOption[]>([]);
  const [msAccountManagers, setMsAccountManagers] = useState<TrackerOption[]>([]);
  const [msRecruitmentManagers, setMsRecruitmentManagers] = useState<TrackerOption[]>([]);
  const [msRequirements, setMsRequirements] = useState<TrackerOption[]>([]);
  const [msRequirementStatuses, setMsRequirementStatuses] = useState<TrackerOption[]>([]);
  const [msSelectionStatuses, setMsSelectionStatuses] = useState<TrackerOption[]>([]);
  const [msFollowUpStages, setMsFollowUpStages] = useState<TrackerOption[]>([]);
  const [msSendFollowupId, setMsSendFollowupId] = useState<string>('');
  const [msSendingFollowupReminder, setMsSendingFollowupReminder] = useState(false);
  const [msShowInactive, setMsShowInactive] = useState(false);
  const [msLoading, setMsLoading] = useState(false);
  const [msReminderTime, setMsReminderTime] = useState('09:00');
  const [msReminderTimeId, setMsReminderTimeId] = useState<string | null>(null);
  const [msReminderTimeSaving, setMsReminderTimeSaving] = useState(false);
  const [msAddOpen, setMsAddOpen] = useState<null | 'recruiter' | 'account_manager' | 'recruitment_manager' | 'requirement' | 'job_status' | 'candidate_status' | 'followup_stage'>(null);
  const [msEdit, setMsEdit] = useState<null | { id: string; kind: 'recruiter' | 'account_manager' | 'recruitment_manager' | 'requirement' | 'job_status' | 'candidate_status' | 'followup_stage'; value: string }>(null);
  const [msDraft, setMsDraft] = useState('');
  const [msEmailDraft, setMsEmailDraft] = useState('');
  const [msEmailEnabledDraft, setMsEmailEnabledDraft] = useState(true);
  const [msFollowupEmailTo, setMsFollowupEmailTo] = useState('');
  const [msFollowupEmailCc, setMsFollowupEmailCc] = useState('');
  const [msFollowupEmailSaving, setMsFollowupEmailSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      if (isAllTeamsView) {
        const [jobsDXB, rowsDXB, fusDXB, jobsAD, rowsAD, fusAD] = await Promise.all([
          trackerApi.listJobOpenings(token, 'dubai'),
          trackerApi.listCandidateRows(token, 'dubai').catch(() => [] as any[]),
          trackerApi.listFollowUps(token, 'dubai').catch(() => [] as TrackerFollowUp[]),
          trackerApi.listJobOpenings(token, 'abudhabi'),
          trackerApi.listCandidateRows(token, 'abudhabi').catch(() => [] as any[]),
          trackerApi.listFollowUps(token, 'abudhabi').catch(() => [] as TrackerFollowUp[]),
        ]);

        const candsDXB = rowsDXB
          .map((r) => r.candidate)
          .filter(Boolean)
          .map((c: any) => ({ ...c, id: `dubai:${c.id}`, __realId: c.id, __team: 'Dubai' }));
        const appsDXB = rowsDXB
          .map((r) => r.application)
          .filter(Boolean)
          .map((a: any) => ({ ...a, id: `dubai:${a.id}`, candidate_id: `dubai:${a.candidate_id}`, __realId: a.id, __team: 'Dubai' }));
        const candsAD = rowsAD
          .map((r) => r.candidate)
          .filter(Boolean)
          .map((c: any) => ({ ...c, id: `abudhabi:${c.id}`, __realId: c.id, __team: 'Abu Dhabi' }));
        const appsAD = rowsAD
          .map((r) => r.application)
          .filter(Boolean)
          .map((a: any) => ({
            ...a,
            id: `abudhabi:${a.id}`,
            candidate_id: `abudhabi:${a.candidate_id}`,
            __realId: a.id,
            __team: 'Abu Dhabi',
          }));

        setJobOpenings([
          ...jobsDXB.map((j: any) => ({ ...j, id: `dubai:${j.id}`, __realId: j.id, __team: 'Dubai' })),
          ...jobsAD.map((j: any) => ({ ...j, id: `abudhabi:${j.id}`, __realId: j.id, __team: 'Abu Dhabi' })),
        ] as any);
        setCandidates([...candsDXB, ...candsAD] as any);
        setApplications([...appsDXB, ...appsAD] as any);
        setFollowUps([
          ...fusDXB.map((f: any) => ({ ...f, id: `dubai:${f.id}`, __realId: f.id, __team: 'Dubai' })),
          ...fusAD.map((f: any) => ({ ...f, id: `abudhabi:${f.id}`, __realId: f.id, __team: 'Abu Dhabi' })),
        ] as any);
      } else {
        const [jobs, rows, fus] = await Promise.all([
          trackerApi.listJobOpenings(token, apiTeam),
          trackerApi.listCandidateRows(token, apiTeam).catch(() => [] as any[]),
          trackerApi.listFollowUps(token, apiTeam).catch(() => [] as TrackerFollowUp[]),
        ]);
        const cands = rows.map((r) => r.candidate).filter(Boolean);
        const apps = rows.map((r) => r.application).filter(Boolean);
        setJobOpenings(jobs); setCandidates(cands); setApplications(apps as any);
        setFollowUps(fus);
      }
    } catch (e: any) { setError(e?.message || 'Failed to load data'); }
    finally { setLoading(false); }
  }, [token, apiTeam, isAllTeamsView]);

  const loadOptions = useCallback(async () => {
    if (!token) return;
    try {
      const mergeByValue = (a: TrackerOption[], b: TrackerOption[], kind: string) => {
        const seen = new Set<string>();
        const out: TrackerOption[] = [];
        const add = (o: TrackerOption) => {
          const k = `${kind}::${(o.value || '').trim().toLowerCase()}`;
          if (seen.has(k)) return;
          seen.add(k);
          out.push({ ...o, id: `all:${kind}:${o.value}` } as any);
        };
        a.forEach(add);
        b.forEach(add);
        return out;
      };

      const [candStatuses, jobStatuses, recruiters, ams, rms, reqs, fuStages] = isAllTeamsView
        ? await Promise.all([
          Promise.all([
            trackerApi.listOptions(token, 'candidate_status', { team: 'dubai' }).catch(() => [] as TrackerOption[]),
            trackerApi.listOptions(token, 'candidate_status', { team: 'abudhabi' }).catch(() => [] as TrackerOption[]),
          ]).then(([a, b]) => mergeByValue(a, b, 'candidate_status')),
          Promise.all([
            trackerApi.listOptions(token, 'job_status', { team: 'dubai' }).catch(() => [] as TrackerOption[]),
            trackerApi.listOptions(token, 'job_status', { team: 'abudhabi' }).catch(() => [] as TrackerOption[]),
          ]).then(([a, b]) => mergeByValue(a, b, 'job_status')),
          Promise.all([
            trackerApi.listOptions(token, 'recruiter', { team: 'dubai' }).catch(() => [] as TrackerOption[]),
            trackerApi.listOptions(token, 'recruiter', { team: 'abudhabi' }).catch(() => [] as TrackerOption[]),
          ]).then(([a, b]) => mergeByValue(a, b, 'recruiter')),
          Promise.all([
            trackerApi.listOptions(token, 'account_manager', { team: 'dubai' }).catch(() => [] as TrackerOption[]),
            trackerApi.listOptions(token, 'account_manager', { team: 'abudhabi' }).catch(() => [] as TrackerOption[]),
          ]).then(([a, b]) => mergeByValue(a, b, 'account_manager')),
          Promise.all([
            trackerApi.listOptions(token, 'recruitment_manager', { team: 'dubai' }).catch(() => [] as TrackerOption[]),
            trackerApi.listOptions(token, 'recruitment_manager', { team: 'abudhabi' }).catch(() => [] as TrackerOption[]),
          ]).then(([a, b]) => mergeByValue(a, b, 'recruitment_manager')),
          Promise.all([
            trackerApi.listOptions(token, 'requirement', { team: 'dubai' }).catch(() => [] as TrackerOption[]),
            trackerApi.listOptions(token, 'requirement', { team: 'abudhabi' }).catch(() => [] as TrackerOption[]),
          ]).then(([a, b]) => mergeByValue(a, b, 'requirement')),
          Promise.all([
            trackerApi.listOptions(token, 'followup_stage', { team: 'dubai' }).catch(() => [] as TrackerOption[]),
            trackerApi.listOptions(token, 'followup_stage', { team: 'abudhabi' }).catch(() => [] as TrackerOption[]),
          ]).then(([a, b]) => mergeByValue(a, b, 'followup_stage')),
        ])
        : await Promise.all([
          trackerApi.listOptions(token, 'candidate_status', { team: apiTeam }).catch(() => [] as TrackerOption[]),
          trackerApi.listOptions(token, 'job_status', { team: apiTeam }).catch(() => [] as TrackerOption[]),
          trackerApi.listOptions(token, 'recruiter', { team: apiTeam }).catch(() => [] as TrackerOption[]),
          trackerApi.listOptions(token, 'account_manager', { team: apiTeam }).catch(() => [] as TrackerOption[]),
          trackerApi.listOptions(token, 'recruitment_manager', { team: apiTeam }).catch(() => [] as TrackerOption[]),
          trackerApi.listOptions(token, 'requirement', { team: apiTeam }).catch(() => [] as TrackerOption[]),
          trackerApi.listOptions(token, 'followup_stage', { team: apiTeam }).catch(() => [] as TrackerOption[]),
        ]);
      setCandidateStatusOptions(candStatuses);
      setJobStatusOptions(jobStatuses);
      setRecruiterOptions(recruiters);
      setAccountManagerOptions(ams);
      setRecruitmentManagerOptions(rms);
      setRequirementOptions(reqs);
      setFollowUpStageOptions(fuStages);
    } catch {
      // keep whatever we already have in state
    }
  }, [token, apiTeam, isAllTeamsView]);

  const loadManagerSettings = useCallback(async () => {
    if (!token || !canAccessManagerSettings) return;
    if (isAllTeamsView) return;
    setMsLoading(true);
    try {
      const [recs, ams, rms, reqs, reqStatuses, selStatuses, fuStages, reminderTimes, followupEmail] = await Promise.all([
        trackerApi.listOptions(token, 'recruiter', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.listOptions(token, 'account_manager', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.listOptions(token, 'recruitment_manager', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.listOptions(token, 'requirement', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.listOptions(token, 'job_status', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.listOptions(token, 'candidate_status', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.listOptions(token, 'followup_stage', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.listOptions(token, 'followup_reminder_send_time', { include_deleted: true, team: apiTeam }).catch(() => [] as TrackerOption[]),
        trackerApi.getFollowupEmailSettings(token, apiTeam).catch(() => ({ team: apiTeam, to: '', cc: '', enabled: false })),
      ]);
      setMsRecruiters(recs);
      setMsAccountManagers(ams);
      setMsRecruitmentManagers(rms);
      setMsRequirements(reqs);
      setMsRequirementStatuses(reqStatuses);
      setMsSelectionStatuses(selStatuses);
      setMsFollowUpStages(fuStages);
      setMsFollowupEmailTo(String((followupEmail as any)?.to || ''));
      setMsFollowupEmailCc(String((followupEmail as any)?.cc || ''));
      const rt = (reminderTimes || []).find((r) => !r.is_deleted) || reminderTimes?.[0] || null;
      setMsReminderTime(String(rt?.value || '09:00'));
      setMsReminderTimeId(rt?.id || null);
    } finally {
      setMsLoading(false);
    }
  }, [token, canAccessManagerSettings, apiTeam, isAllTeamsView]);

  useEffect(() => {
    if (view === 'managerSettings') loadManagerSettings();
  }, [view, loadManagerSettings]);

  // Guard persisted view: recruiters should not land on hidden tabs.
  useEffect(() => {
    if (!isRecruiterUser) return;
    if (view === 'candidateProfiles' || view === 'managerSettings') {
      setViewPersisted('followUps');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecruiterUser, view]);

  useEffect(() => {
    if (!textPeek) return;
    setTextPeekDraft(String(textPeek.text || ''));
  }, [textPeek]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), loadOptions()]);
  }, [refresh, loadOptions]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  const createOption = useCallback(
    async (kind: string, value: string) => {
      if (!token) return;
      if (isAllTeamsView) return;
      await trackerApi.createOption(token, kind, value, apiTeam);
      await loadOptions();
    },
    [token, loadOptions, apiTeam, isAllTeamsView]
  );

  const editOption = useCallback(
    async (kind: string, id: string, value: string) => {
      if (!token) return;
      // Ignore edits on fallback pseudo-items
      if (String(id).startsWith('fallback:')) return;
      if (isAllTeamsView) return;
      await trackerApi.updateOption(token, id, { value }, apiTeam);
      await loadOptions();
    },
    [token, loadOptions, apiTeam, isAllTeamsView]
  );

  const deleteOption = useCallback(
    async (kind: string, id: string) => {
      if (!token) return;
      if (String(id).startsWith('fallback:')) return;
      if (isAllTeamsView) return;
      await trackerApi.deleteOption(token, id, apiTeam);
      await loadOptions();
    },
    [token, loadOptions, apiTeam, isAllTeamsView]
  );

  const candById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  // Map candidate_id → first application (a candidate may appear multiple times if they have
  // multiple applications; for the flat table we show one row per candidate using their latest app)
  const appByCandId = useMemo(() => {
    const m = new Map<string, TrackerApplication>();
    // iterate oldest→newest so the latest app wins
    [...applications].reverse().forEach((a) => m.set(a.candidate_id, a));
    return m;
  }, [applications]);

  const candidateRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const fromD = candDateFrom ? new Date(candDateFrom) : null;
    const toD = candDateTo ? new Date(candDateTo) : null;
    if (fromD) fromD.setHours(0, 0, 0, 0);
    if (toD) toD.setHours(23, 59, 59, 999);
    return candidates
      .map((cand) => ({ cand, app: appByCandId.get(cand.id) ?? null }))
      .filter(({ app }) => filterStatus === 'all' || (app?.status ?? '') === filterStatus)
      .filter(({ cand, app }) => {
        if (!s) return true;
        return (
          cand.name.toLowerCase().includes(s) ||
          (app?.position || '').toLowerCase().includes(s) ||
          (app?.client || '').toLowerCase().includes(s) ||
          (app?.recruiter || '').toLowerCase().includes(s) ||
          (app?.account_manager || '').toLowerCase().includes(s) ||
          (app?.recruitment_manager || '').toLowerCase().includes(s) ||
          (app?.comment || '').toLowerCase().includes(s)
        );
      })
      .filter(({ app }) => {
        if (!fromD && !toD) return true;
        const d = app?.applied_date ? new Date(String(app.applied_date)) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (fromD && d < fromD) return false;
        if (toD && d > toD) return false;
        return true;
      })
      .sort((a, b) => {
        const ad = a.app?.applied_date ? new Date(a.app.applied_date).getTime() : 0;
        const bd = b.app?.applied_date ? new Date(b.app.applied_date).getTime() : 0;
        return sortOrder === 'latest' ? bd - ad : ad - bd;
      });
  }, [candidates, appByCandId, filterStatus, search, candDateFrom, candDateTo, sortOrder]);

  const visibleJobOpenings = useMemo(() => {
    const s = search.trim().toLowerCase();
    const fromD = jobDateFrom ? new Date(jobDateFrom) : null;
    const toD = jobDateTo ? new Date(jobDateTo) : null;
    if (fromD) fromD.setHours(0, 0, 0, 0);
    if (toD) toD.setHours(23, 59, 59, 999);
    return jobOpenings
      .filter((j) => filterStatus === 'all' || (j.status ?? '') === filterStatus)
      .filter((j) => {
        if (!s) return true;
        const client = (j as any).client || '';
        return (
          (j.title || '').toLowerCase().includes(s) ||
          String(client).toLowerCase().includes(s) ||
          (j.hiring_manager || '').toLowerCase().includes(s) ||
          (j.department || '').toLowerCase().includes(s)
        );
      })
      .filter((j) => {
        if (!fromD && !toD) return true;
        const d = (j as any).submission_date ? new Date(String((j as any).submission_date)) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (fromD && d < fromD) return false;
        if (toD && d > toD) return false;
        return true;
      })
      .sort((a, b) => {
        const ad = new Date(a.created_at || 0).getTime();
        const bd = new Date(b.created_at || 0).getTime();
        return bd - ad;
      });
  }, [jobOpenings, filterStatus, search, jobDateFrom, jobDateTo]);

  const visibleFollowUps = useMemo(() => {
    const q = followupSearch.trim().toLowerCase();
    const stage = followupStageFilter;
    const from = followupNextFrom ? new Date(followupNextFrom) : null;
    const to = followupNextTo ? new Date(followupNextTo) : null;
    if (from) from.setHours(0, 0, 0, 0);
    if (to) to.setHours(23, 59, 59, 999);

    return [...followUps]
      .filter((r) => {
        if (!q) return true;
        return (
          String(r.client_name || '').toLowerCase().includes(q) ||
          String(r.position || '').toLowerCase().includes(q) ||
          String(r.recruiter_name || '').toLowerCase().includes(q) ||
          String(r.account_manager || '').toLowerCase().includes(q) ||
          String(r.recruitment_manager || '').toLowerCase().includes(q) ||
          String(r.client_feedback || '').toLowerCase().includes(q) ||
          String(r.interview_feedback || '').toLowerCase().includes(q) ||
          String(r.remarks || '').toLowerCase().includes(q)
        );
      })
      .filter((r) => stage === 'all' || String(r.current_stage || '') === stage)
      .filter((r) => {
        if (!from && !to) return true;
        const d = r.next_follow_up_date ? new Date(r.next_follow_up_date) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .sort((a, b) => {
        const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bd - ad;
      });
  }, [followUps, followupSearch, followupStageFilter, followupNextFrom, followupNextTo]);

  const requirementCounts = useMemo(() => {
    const isClosed = (s?: string | null) => {
      const k = String(s || '').toLowerCase().trim();
      return k === 'closed' || k === 'cancelled';
    };
    const isHold = (s?: string | null) => {
      const k = String(s || '').toLowerCase().trim();
      return k === 'hold';
    };
    const isSubmitted = (s?: string | null) => {
      const k = String(s || '').toLowerCase().trim();
      return k === 'submitted';
    };
    const open = jobOpenings.filter((j) => !isClosed(j.status) && !isHold(j.status) && !isSubmitted(j.status)).length;
    const submitted = jobOpenings.filter((j) => isSubmitted(j.status)).length;
    const hold = jobOpenings.filter((j) => isHold(j.status)).length;
    const closed = jobOpenings.filter((j) => isClosed(j.status)).length;
    return { open, submitted, hold, closed };
  }, [jobOpenings]);

  const selectionCounts = useMemo(() => {
    const totalSelections = candidateRows.length;
    const joined = candidateRows.filter(({ app }) => isJoinedStatus(app?.status)).length;
    const backouts = candidateRows.filter(({ app }) => isBackoutStatus(_norm(app?.status))).length;
    const offerReleased = candidateRows.filter(({ app }) => isOfferReleasedStatus(_norm(app?.status))).length;
    const offerPending = candidateRows.filter(({ app }) => _norm(app?.status) === 'offer pending').length;
    return { totalSelections, offerPending, offerReleased, backouts, joined };
  }, [candidateRows, applications]);

  const followUpCounts = useMemo(() => {
    let feedbackPending = 0;
    let positionsClosed = 0;
    let overdue = 0;
    let holdCount = 0;
    let interviewScheduledCount = 0;
    for (const f of followUps) {
      const st = String(f.current_stage || '').trim();
      const k = _norm(st);
      if (k === 'positions closed' || k === 'position closed') positionsClosed += 1;
      if (k === 'feedback pending' || k === 'interview feedback pending') feedbackPending += 1;
      if (k === 'hold') holdCount += 1;
      if (k === 'interview' || (k.includes('interview') && k.includes('scheduled'))) interviewScheduledCount += 1;
      if (isOverdue(f.next_follow_up_date, st) || k === 'overdue follow-ups') overdue += 1;
    }
    return { feedbackPending, positionsClosed, overdue, hold: holdCount, interviewScheduled: interviewScheduledCount };
  }, [followUps]);

  const msCounts = useMemo(() => {
    const reqByRecruiter = new Map<string, number>();
    const reqByAM = new Map<string, number>();
    const reqByRM = new Map<string, number>();
    for (const j of jobOpenings) {
      const r = (j.hiring_manager || '').trim();
      const am = (j.department || '').trim();
      const rm = (j.recruitment_manager || '').trim();
      if (r) reqByRecruiter.set(r, (reqByRecruiter.get(r) || 0) + 1);
      if (am) reqByAM.set(am, (reqByAM.get(am) || 0) + 1);
      if (rm) reqByRM.set(rm, (reqByRM.get(rm) || 0) + 1);
    }

    const joiningsByRecruiter = new Map<string, number>();
    const joiningsByAM = new Map<string, number>();
    const joiningsByRM = new Map<string, number>();
    for (const a of applications) {
      if (!isJoinedStatus(a.status)) continue;
      const r = (a.recruiter || '').trim();
      const am = (a.account_manager || '').trim();
      const rm = (a.recruitment_manager || '').trim();
      if (r) joiningsByRecruiter.set(r, (joiningsByRecruiter.get(r) || 0) + 1);
      if (am) joiningsByAM.set(am, (joiningsByAM.get(am) || 0) + 1);
      if (rm) joiningsByRM.set(rm, (joiningsByRM.get(rm) || 0) + 1);
    }

    const fuByRecruiter = new Map<string, number>();
    const fuByRM = new Map<string, number>();
    for (const f of followUps) {
      const r = (f.recruiter_name || '').trim();
      const rm = (f.recruitment_manager || '').trim();
      if (r) fuByRecruiter.set(r, (fuByRecruiter.get(r) || 0) + 1);
      if (rm) fuByRM.set(rm, (fuByRM.get(rm) || 0) + 1);
    }

    return { reqByRecruiter, reqByAM, reqByRM, joiningsByRecruiter, joiningsByAM, joiningsByRM, fuByRecruiter, fuByRM };
  }, [jobOpenings, applications, followUps]);


  /* ── sidebar ── */
  const SidebarContent = (
    <>
      {/* Top action: Back to Dashboard for core-app roles, Logout for tracker-only (account_manager) */}
      <div className="px-3 pt-3 pb-2">
        {isAccountManager ? (
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors text-[13px] font-medium"
            title="Logout"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span>Logout</span>}
          </button>
        ) : (
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors text-[13px] font-medium"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span>Back to Dashboard</span>}
          </button>
        )}
      </div>

      {/* Brand */}
      <div className="px-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
            <Briefcase className="w-3.5 h-3.5 text-white" />
          </div>
          {sidebarOpen && (
            <div>
              <div className="text-[14px] font-bold text-white leading-tight">Candidate Tracker</div>
              <div className="text-[10px] text-blue-200 mt-0.5">Recruiting workspace</div>
            </div>
          )}
        </div>
      </div>

      <nav className="px-2 pt-3 space-y-0.5 flex-1">
        {([
          { id: 'jobOpenings', label: 'Requirement Status', icon: Briefcase, count: jobOpenings.length, show: true },
          // Recruiters should not see Selections & Joinings.
          { id: 'candidateProfiles', label: 'Selections & Joinings', icon: Users, count: candidates.length, show: !isRecruiterUser },
          { id: 'followUps', label: 'Follow-ups', icon: Shield, count: followUps.length, show: true },
          {
            id: 'managerSettings',
            label: 'Manager Settings',
            icon: Settings,
            count: 0,
            // Recruiters should not see Manager Settings; managers/admins/evp/account managers can.
            show: !isRecruiterUser && (user?.role === 'admin' || user?.role === 'manager' || user?.role === 'evp' || isAccountManager),
          },
        ] as const).filter((x) => x.show).map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            title={isRecruiterUser && id === 'jobOpenings' ? 'View only — editing is for managers and admins' : undefined}
            onClick={() => {
              setViewPersisted(id);
              setMobileSidebarOpen(false);
              setFilterStatus('all');
              setSearch('');
              setFollowupSearch('');
              setFollowupStageFilter('all');
              setFollowupNextFrom('');
              setFollowupNextTo('');
              setJobDateFrom('');
              setJobDateTo('');
              setCandDateFrom('');
              setCandDateTo('');
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all text-[13px] ${view === id ? 'bg-white text-brand-700 shadow-sm font-semibold' : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="flex-1 truncate">{label}</span>}
            {sidebarOpen && (
              <span className={`text-[11px] rounded-full px-1.5 py-0.5 font-bold tabular-nums ${view === id ? 'bg-brand-50 text-brand-700' : 'bg-white/15 text-white/90'
                }`}>
                {count}
              </span>
            )}
          </button>
        ))}

      </nav>

      <div className="px-2 pb-3 mt-auto">
        <button
          onClick={() => setSidebarOpen((s) => !s)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-white/60 hover:text-white text-xs transition-colors"
        >
          {sidebarOpen ? <><ChevronLeft className="w-3.5 h-3.5" /><span>Collapse</span></> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--app-bg)]">
      {/* Desktop sidebar — narrower */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-brand-700 transition-all duration-200 ease-in-out overflow-hidden ${sidebarOpen ? 'w-52' : 'w-[52px]'
          }`}
      >
        {SidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
          <aside className="relative w-64 flex flex-col bg-brand-700 shadow-xl z-10">
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — slim */}
        <header className="shrink-0 border-b border-slate-200 bg-white shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-[13px] font-semibold text-slate-800">
              {view === 'jobOpenings'
                ? 'Requirement Status'
                : view === 'candidateProfiles'
                  ? 'Selections & Joinings'
                  : view === 'followUps'
                    ? 'Follow-ups'
                    : 'Manager Settings'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {user && (
                <span className="hidden sm:block text-[13px] text-slate-600">
                  Welcome, <span className="font-semibold text-slate-900">{user.username}</span>
                </span>
              )}
              {loading && <Loader2 className="w-4 h-4 animate-spin text-brand-600" />}
              <button
                onClick={refreshAll}
                disabled={loading}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 transition-colors"
                title="Refresh data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-red-600 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </header>

        {/* Page toolbar */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-[var(--shadow-sm)]">
          {/* Row 1: title + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-[13px] text-slate-400 font-medium">
                  {view === 'candidateProfiles'
                    ? `${candidateRows.length} candidate${candidateRows.length !== 1 ? 's' : ''}`
                    : view === 'followUps'
                      ? `${followUps.length} follow-up${followUps.length !== 1 ? 's' : ''}`
                      : null}
                </p>
                {view === 'jobOpenings' && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <div className="w-[100px] h-[62px] rounded-lg border border-slate-200 bg-slate-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Total</div>
                      <div className="text-[20px] leading-none font-extrabold text-slate-900 tabular-nums">
                        {jobOpenings.length}
                      </div>
                    </div>
                    <div className="w-[92px] h-[62px] rounded-lg border border-transparent bg-brand-600 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-white uppercase tracking-wider">Open</div>
                      <div className="text-[20px] leading-none font-extrabold text-white tabular-nums">
                        {requirementCounts.open}
                      </div>
                    </div>
                    <div className="w-[92px] h-[62px] rounded-lg border border-emerald-200 bg-emerald-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Submitted</div>
                      <div className="text-[20px] leading-none font-extrabold text-emerald-800 tabular-nums">
                        {requirementCounts.submitted}
                      </div>
                    </div>
                    <div className="w-[92px] h-[62px] rounded-lg border border-amber-200 bg-amber-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Hold</div>
                      <div className="text-[20px] leading-none font-extrabold text-amber-800 tabular-nums">
                        {requirementCounts.hold}
                      </div>
                    </div>
                    <div className="w-[92px] h-[62px] rounded-lg border border-slate-200 bg-slate-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Closed</div>
                      <div className="text-[20px] leading-none font-extrabold text-slate-900 tabular-nums">
                        {requirementCounts.closed}
                      </div>
                    </div>
                  </div>
                )}
                {view === 'candidateProfiles' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="w-[150px] h-[62px] rounded-lg border border-blue-200 bg-blue-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Selections</div>
                      <div className="text-[20px] leading-none font-extrabold text-blue-800 tabular-nums">{selectionCounts.totalSelections}</div>
                    </div>
                    <div className="w-[140px] h-[62px] rounded-lg border border-brand-200 bg-brand-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-brand-700 uppercase tracking-wider">Offer pending</div>
                      <div className="text-[20px] leading-none font-extrabold text-brand-800 tabular-nums">{selectionCounts.offerPending}</div>
                    </div>
                    <div className="w-[140px] h-[62px] rounded-lg border border-amber-200 bg-amber-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Offer released</div>
                      <div className="text-[20px] leading-none font-extrabold text-amber-800 tabular-nums">{selectionCounts.offerReleased}</div>
                    </div>
                    <div className="w-[120px] h-[62px] rounded-lg border border-red-200 bg-red-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Backouts</div>
                      <div className="text-[20px] leading-none font-extrabold text-red-800 tabular-nums">{selectionCounts.backouts}</div>
                    </div>
                    <div className="w-[110px] h-[62px] rounded-lg border border-emerald-200 bg-emerald-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Joined</div>
                      <div className="text-[20px] leading-none font-extrabold text-emerald-800 tabular-nums">{selectionCounts.joined}</div>
                    </div>
                  </div>
                )}
                {view === 'followUps' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="w-[140px] h-[62px] rounded-lg border border-slate-200 bg-slate-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Feedback pending</div>
                      <div className="text-[20px] leading-none font-extrabold text-slate-900 tabular-nums">
                        {followUpCounts.feedbackPending}
                      </div>
                    </div>
                    <div className="w-[140px] h-[62px] rounded-lg border border-slate-200 bg-slate-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Position closed</div>
                      <div className="text-[20px] leading-none font-extrabold text-slate-900 tabular-nums">
                        {followUpCounts.positionsClosed}
                      </div>
                    </div>
                    <div className="w-[110px] h-[62px] rounded-lg border border-slate-200 bg-slate-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Overdue</div>
                      <div className="text-[20px] leading-none font-extrabold text-slate-400 tabular-nums">
                        {followUpCounts.overdue}
                      </div>
                    </div>
                    <div className="w-[110px] h-[62px] rounded-lg border border-amber-200 bg-amber-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Hold</div>
                      <div className="text-[20px] leading-none font-extrabold text-amber-800 tabular-nums">
                        {followUpCounts.hold}
                      </div>
                    </div>
                    <div className="w-[150px] h-[62px] rounded-lg border border-blue-200 bg-blue-50 flex flex-col justify-center px-3">
                      <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Interviews</div>
                      <div className="text-[20px] leading-none font-extrabold text-blue-800 tabular-nums">
                        {followUpCounts.interviewScheduled}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {isReadOnlyTracker && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-medium">
                  Read-only
                </span>
              )}
              {isRecruiterUser && view === 'jobOpenings' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] text-slate-600 font-medium">
                  Requirements: view only
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isAdminLike ? (
                <Select value={teamView} onValueChange={(v) => setTeamViewPersisted(v as any)}>
                  <SelectTrigger className="h-8 w-[170px] text-[13px] bg-white border-slate-200 text-slate-800">
                    <SelectValue placeholder="Team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dubai">Dubai</SelectItem>
                    <SelectItem value="abudhabi">Abu Dhabi</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {view === 'candidateProfiles' && isAdmin ? (
                <button
                  disabled={!token || loading}
                  onClick={() => setImportOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                  title="Upload Selections & Joinings Excel"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload Excel
                </button>
              ) : null}
              {view === 'jobOpenings' && canWriteJobs ? (
                <NewJobOpeningDialog
                  onCreated={refreshAll}
                  team={apiTeam}
                  jobStatusOptions={jobStatusOptions}
                  requirementOptions={requirementOptions}
                  recruiterOptions={recruiterOptions}
                  accountManagerOptions={accountManagerOptions}
                  recruitmentManagerOptions={recruitmentManagerOptions}
                  canManageOptions={canManageJobOptions}
                  onAddOption={createOption}
                  onEditOption={editOption}
                  onDeleteOption={deleteOption}
                />
              ) : null}
              {view === 'candidateProfiles' && canWriteCandidates ? (
                <NewCandidateDialog
                  onCreated={refreshAll}
                  team={apiTeam}
                  statusOptions={candidateStatusOptions}
                  recruiterOptions={recruiterOptions}
                  accountManagerOptions={accountManagerOptions}
                  recruitmentManagerOptions={recruitmentManagerOptions}
                  canManageOptions={canManageCandidateOptions}
                  onAddOption={createOption}
                  onEditOption={editOption}
                  onDeleteOption={deleteOption}
                />
              ) : null}
              <button
                disabled={!token || loading}
                onClick={async () => {
                  if (!token) return;
                  if (view === 'managerSettings') {
                    window.alert('Export is not available for Manager Settings.');
                    return;
                  }
                  if (isAllTeamsView) {
                    const [dxb, ad] = await Promise.all([
                      view === 'jobOpenings'
                        ? trackerApi.exportJobOpeningsXlsx(token, 'dubai')
                        : view === 'candidateProfiles'
                          ? trackerApi.exportCandidatesXlsx(token, 'dubai')
                          : trackerApi.exportFollowUpsXlsx(token, 'dubai'),
                      view === 'jobOpenings'
                        ? trackerApi.exportJobOpeningsXlsx(token, 'abudhabi')
                        : view === 'candidateProfiles'
                          ? trackerApi.exportCandidatesXlsx(token, 'abudhabi')
                          : trackerApi.exportFollowUpsXlsx(token, 'abudhabi'),
                    ]);
                    const base = view === 'jobOpenings' ? 'job_openings' : view === 'candidateProfiles' ? 'candidates' : 'follow_ups';
                    downloadBlob(dxb, `${base}_dubai.xlsx`);
                    downloadBlob(ad, `${base}_abudhabi.xlsx`);
                    return;
                  }

                  const blob =
                    view === 'jobOpenings'
                      ? await trackerApi.exportJobOpeningsXlsx(token, apiTeam)
                      : view === 'candidateProfiles'
                        ? await trackerApi.exportCandidatesXlsx(token, apiTeam)
                        : await trackerApi.exportFollowUpsXlsx(token, apiTeam);
                  downloadBlob(blob, view === 'jobOpenings' ? 'job_openings.xlsx' : view === 'candidateProfiles' ? 'candidates.xlsx' : 'follow_ups.xlsx');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>
          </div>

          {/* Row 2: filters (Requirement/Candidate only; Follow-ups & Manager Settings have their own) */}
          {view !== 'followUps' && view !== 'managerSettings' ? (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 w-[180px] text-[13px] bg-white border-slate-200 text-slate-800">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent className="max-h-64 overflow-y-auto">
                  <SelectItem value="all">All Status</SelectItem>
                  {(view === 'jobOpenings' ? jobStatusOptions : candidateStatusOptions).map((o) => (
                    <SelectItem key={o.id} value={o.value}>{o.value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={view === 'jobOpenings' ? 'Search role, client…' : 'Search name, position…'}
                  className="w-full h-8 pl-3 pr-8 text-[13px] border border-slate-200 rounded-lg bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* Date range filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400">
                  {view === 'jobOpenings' ? 'Req. Date' : 'Date'}
                </span>
                <input
                  type="date"
                  value={view === 'jobOpenings' ? jobDateFrom : candDateFrom}
                  onChange={(e) => view === 'jobOpenings' ? setJobDateFrom(e.target.value) : setCandDateFrom(e.target.value)}
                  aria-label="Date from"
                  className="h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 [color-scheme:light]"
                />
                <span className="text-[11px] text-slate-400">–</span>
                <input
                  type="date"
                  value={view === 'jobOpenings' ? jobDateTo : candDateTo}
                  onChange={(e) => view === 'jobOpenings' ? setJobDateTo(e.target.value) : setCandDateTo(e.target.value)}
                  aria-label="Date to"
                  className="h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 [color-scheme:light]"
                />
                {((view === 'jobOpenings' && (jobDateFrom || jobDateTo)) ||
                  (view === 'candidateProfiles' && (candDateFrom || candDateTo))) && (
                    <button
                      onClick={() => {
                        if (view === 'jobOpenings') { setJobDateFrom(''); setJobDateTo(''); }
                        else { setCandDateFrom(''); setCandDateTo(''); }
                      }}
                      className="h-8 px-2 text-[11px] text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg bg-white"
                    >
                      Clear
                    </button>
                  )}
              </div>
              {view === 'candidateProfiles' && (
                <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as any)}>
                  <SelectTrigger className="h-8 w-[100px] text-[12px] bg-white border-slate-200 text-slate-800">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">Latest</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}
        </div>

        {/* Content area — scrollable */}
        <div
          className={`flex-1 overflow-auto p-4 transition-opacity duration-150 ${loading && (jobOpenings.length > 0 || candidates.length > 0) ? 'opacity-60' : 'opacity-100'
            }`}
        >
          {error && (
            <div className="mb-3 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-[13px]">
              <X className="w-4 h-4 shrink-0" />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          )}

          {view === 'jobOpenings' ? (
            /* ────── Requirement Status table ────── */
            <div className="surface-panel overflow-hidden">
              <SyncedXScroll>
                <table className="table-premium w-full min-w-[1500px] text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 text-left w-[70px]">S.no</th>
                      {isAllTeamsView ? <th className="px-4 py-3 text-left w-[110px]">Team</th> : null}
                      <th className="px-4 py-3 text-left w-[220px]">Role</th>
                      <th className="px-4 py-3 text-left w-[160px]">Client</th>
                      <th className="px-4 py-3 text-left w-[155px]">Recruiter</th>
                      <th className="px-4 py-3 text-left w-[170px]">Recruiter Manager</th>
                      <th className="px-4 py-3 text-left w-[155px]">Account Manager</th>
                      <th className="px-4 py-3 text-left w-[140px]">Requirement Date</th>
                      <th className="px-4 py-3 text-left w-[140px]">Submission Date</th>
                      <th className="px-4 py-3 text-left w-[150px]">No of CVs Submitted</th>
                      <th className="px-4 py-3 text-left w-[170px]">Status</th>
                      <th className="px-4 py-3 text-left min-w-[260px]">Comments</th>
                      <th className="px-4 py-3 text-right w-[90px] sticky right-0 bg-slate-50">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleJobOpenings.length === 0 ? (
                      <tr>
                        <td colSpan={isAllTeamsView ? 14 : 13} className="px-5 py-16 text-center text-slate-400 text-[13px]">
                          {canWriteJobs
                            ? 'No requirements yet — click + New Requirement to add one.'
                            : 'No requirements yet.'}
                        </td>
                      </tr>
                    ) : visibleJobOpenings.map((j, idx) => (
                      <tr key={j.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap text-[12px]">{idx + 1}</td>
                        {isAllTeamsView ? (
                          <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-[12px]">{(j as any).__team || '—'}</td>
                        ) : null}

                        {/* Role — stored in title */}
                        <td className="px-4 py-2.5 font-semibold text-slate-900">{j.title}</td>
                        <td className="px-4 py-2.5 text-slate-600 text-[12px]">{j.client ? j.client : <span className="text-slate-300">—</span>}</td>
                        {/* Recruiter — stored in hiring_manager */}
                        <td className="px-3 py-2">
                          {canWriteJobs ? (
                            <ManagedSelect
                              label="Recruiter"
                              value={j.hiring_manager || ''}
                              disabled={!!rowBusy[j.id]}
                              canManage={false}
                              options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [j.id]: true }));
                                try { await trackerApi.updateJobOpening(token, j.id, { hiring_manager: v } as any, apiTeam); await refreshAll(); }
                                finally { setRowBusy((s) => ({ ...s, [j.id]: false })); }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : (
                            <span className="text-[12px] text-slate-600">{j.hiring_manager || '—'}</span>
                          )}
                        </td>
                        {/* Recruiter Manager (stored in recruitment_manager) */}
                        <td className="px-3 py-2">
                          {canWriteJobs ? (
                            <ManagedSelect
                              label="Recruiter Manager"
                              value={j.recruitment_manager || ''}
                              disabled={!!rowBusy[j.id]}
                              canManage={false}
                              options={recruitmentManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [j.id]: true }));
                                try { await trackerApi.updateJobOpening(token, j.id, { recruitment_manager: v } as any, apiTeam); await refreshAll(); }
                                finally { setRowBusy((s) => ({ ...s, [j.id]: false })); }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : (
                            <span className="text-[12px] text-slate-600">{j.recruitment_manager || '—'}</span>
                          )}
                        </td>

                        {/* Account Manager — stored in department */}
                        <td className="px-3 py-2">
                          {canWriteJobs ? (
                            <ManagedSelect
                              label="Account Manager"
                              value={j.department || ''}
                              disabled={!!rowBusy[j.id]}
                              canManage={false}
                              options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [j.id]: true }));
                                try { await trackerApi.updateJobOpening(token, j.id, { department: v } as any, apiTeam); await refreshAll(); }
                                finally { setRowBusy((s) => ({ ...s, [j.id]: false })); }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : (
                            <span className="text-[12px] text-slate-600">{j.department || '—'}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-[12px]">
                          {(j as any).req_date ? formatDate(String((j as any).req_date)) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-[12px]">
                          {(j as any).submission_date ? formatDate(String((j as any).submission_date)) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {canWriteJobs ? (
                            <input
                              key={`${j.id}:${String((j as any).updated_at || '')}`}
                              defaultValue={
                                (j as any).cvs_submitted_count !== undefined && (j as any).cvs_submitted_count !== null
                                  ? String((j as any).cvs_submitted_count)
                                  : ''
                              }
                              placeholder="0"
                              className="w-[60px] h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-center"
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                              onBlur={async (e) => {
                                if (!token) return;
                                const raw = String(e.currentTarget.value || '').trim();
                                const v = raw === '' ? null : Number(raw.replace(/[^\d]/g, ''));
                                if (Number.isNaN(v as any)) return;
                                setRowBusy((s) => ({ ...s, [j.id]: true }));
                                try { await trackerApi.updateJobOpening(token, j.id, { cvs_submitted_count: v } as any, apiTeam); await refreshAll(); }
                                finally { setRowBusy((s) => ({ ...s, [j.id]: false })); }
                              }}
                            />
                          ) : (
                            <span className="text-[12px] text-slate-700">{(j as any).cvs_submitted_count ?? '—'}</span>
                          )}
                        </td>
                        {/* Status */}
                        <td className="px-3 py-2">
                          {canWriteJobs ? (
                            <ManagedSelect
                              label="Status"
                              value={j.status || ''}
                              disabled={!!rowBusy[j.id]}
                              canManage={false}
                              options={jobStatusOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [j.id]: true }));
                                try { await trackerApi.updateJobOpening(token, j.id, { status: v } as any, apiTeam); await refreshAll(); }
                                finally { setRowBusy((s) => ({ ...s, [j.id]: false })); }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : (
                            <StatusBadge label={j.status} />
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 text-[12px]">
                          <button
                            className="text-left w-full hover:underline"
                            onClick={() =>
                              setTextPeek({
                                title: 'Comments',
                                text: String((j as any).comments || ''),
                                canEdit: canWriteJobs,
                                onSave: async (txt: string) => {
                                  if (!token) return;
                                  await trackerApi.updateJobOpening(token, j.id, { comments: txt || null } as any, apiTeam);
                                  await refreshAll();
                                },
                              })
                            }
                          >
                            {String((j as any).comments || '') ? (
                              <span className="line-clamp-2">{String((j as any).comments || '')}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right sticky right-0 bg-white">
                          <div className="flex items-center justify-end gap-1">
                            {canWriteJobs ? (
                              <>
                                <button
                                  onClick={() => setEditJob(j)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-brand-300 hover:text-brand-700 transition-colors"
                                >
                                  <Pencil className="w-3 h-3" /> Edit
                                </button>
                                <button
                                  onClick={() => { setConfirmDeleteId(j.id); setConfirmDeleteType('job'); }}
                                  disabled={!!rowBusy[j.id]}
                                  className="p-1 rounded-md border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors disabled:opacity-40"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SyncedXScroll>
            </div>
          ) : view === 'candidateProfiles' ? (
            /* ────── Selections & Joinings table ────── */
            <div className="surface-panel overflow-hidden">
              <SyncedXScroll>
                <table className="table-premium w-full min-w-[1100px] text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 text-left w-[110px]">Date</th>
                      {isAllTeamsView ? <th className="px-4 py-3 text-left w-[110px]">Team</th> : null}
                      <th className="px-4 py-3 text-left w-[155px]">Candidate</th>
                      <th className="px-4 py-3 text-left w-[145px]">Position</th>
                      <th className="px-4 py-3 text-left w-[130px]">Client</th>
                      <th className="px-4 py-3 text-left w-[170px]">Status</th>
                      <th className="px-4 py-3 text-left w-[145px]">Recruiter</th>
                      <th className="px-4 py-3 text-left w-[155px]">Account Manager</th>
                      <th className="px-4 py-3 text-left w-[170px]">Recruitment Manager</th>
                      <th className="px-4 py-3 text-left">Comment</th>
                      <th className="px-4 py-3 text-right w-[72px] sticky right-0 bg-slate-50">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidateRows.length === 0 ? (
                      <tr>
                        <td colSpan={isAllTeamsView ? 11 : 10} className="px-5 py-16 text-center text-slate-400 text-[13px]">
                          {canWriteCandidates
                            ? 'No candidates yet — click + New Candidate to add one.'
                            : 'No candidates yet.'}
                        </td>
                      </tr>
                    ) : candidateRows.map(({ cand, app }) => (
                      <tr key={cand.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-[12px]">
                          {app?.applied_date ? formatDate(String(app.applied_date)) : <span className="text-slate-300">—</span>}
                        </td>
                        {isAllTeamsView ? (
                          <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-[12px]">{(cand as any).__team || '—'}</td>
                        ) : null}
                        <td className="px-3 py-2">
                          {canWriteCandidates ? (
                            <input
                              key={`name-${cand.id}:${String(cand.updated_at || '')}`}
                              defaultValue={cand.name || ''}
                              placeholder="Name"
                              className="w-full min-w-[120px] h-8 px-2 text-[12px] font-semibold text-slate-900 border border-transparent hover:border-slate-200 focus:border-brand-500 rounded-lg bg-transparent hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all"
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                              onBlur={async (e) => {
                                if (!token) return;
                                const val = e.currentTarget.value.trim();
                                if (!val || val === cand.name) return;
                                setRowBusy((s) => ({ ...s, [cand.id]: true }));
                                try {
                                  await trackerApi.updateCandidate(token, cand.id, { name: val }, apiTeam);
                                  await refreshAll();
                                } finally {
                                  setRowBusy((s) => ({ ...s, [cand.id]: false }));
                                }
                              }}
                            />
                          ) : (
                            <span className="px-1 font-semibold text-slate-900 whitespace-nowrap">{cand.name}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 text-[12px]">{app?.position || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-slate-600 text-[12px]">{app?.client || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2">
                          {canWriteCandidates ? (
                            <ManagedSelect
                              label="Status"
                              value={app?.status || ''}
                              disabled={!!rowBusy[cand.id]}
                              canManage={false}
                              options={candidateStatusOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [cand.id]: true }));
                                try {
                                  const resolvedApp =
                                    app ??
                                    (await trackerApi.createApplication(token, {
                                      candidate_id: cand.id,
                                      status: 'MRF Pending',
                                    }, apiTeam));
                                  await trackerApi.updateApplication(token, resolvedApp.id, { status: v || null }, apiTeam);
                                  await refreshAll();
                                } finally {
                                  setRowBusy((s) => ({ ...s, [cand.id]: false }));
                                }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : app ? (
                            <StatusBadge label={app.status} />
                          ) : (
                            <span className="text-slate-300 text-[12px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {canWriteCandidates ? (
                            <ManagedSelect
                              label="Recruiter"
                              value={app?.recruiter || ''}
                              disabled={!!rowBusy[cand.id]}
                              canManage={false}
                              options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [cand.id]: true }));
                                try {
                                  const resolvedApp =
                                    app ??
                                    (await trackerApi.createApplication(token, {
                                      candidate_id: cand.id,
                                      status: 'MRF Pending',
                                    }, apiTeam));
                                  await trackerApi.updateApplication(token, resolvedApp.id, { recruiter: v || null }, apiTeam);
                                  await refreshAll();
                                } finally {
                                  setRowBusy((s) => ({ ...s, [cand.id]: false }));
                                }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : (
                            <span className="text-[12px] text-slate-600">{app?.recruiter || <span className="text-slate-300">—</span>}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {canWriteCandidates ? (
                            <ManagedSelect
                              label="Account Manager"
                              value={app?.account_manager || ''}
                              disabled={!!rowBusy[cand.id]}
                              canManage={false}
                              options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [cand.id]: true }));
                                try {
                                  const resolvedApp =
                                    app ??
                                    (await trackerApi.createApplication(token, {
                                      candidate_id: cand.id,
                                      status: 'MRF Pending',
                                    }, apiTeam));
                                  await trackerApi.updateApplication(token, resolvedApp.id, { account_manager: v || null }, apiTeam);
                                  await refreshAll();
                                } finally {
                                  setRowBusy((s) => ({ ...s, [cand.id]: false }));
                                }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : (
                            <span className="text-[12px] text-slate-600">{app?.account_manager || <span className="text-slate-300">—</span>}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {canWriteCandidates ? (
                            <ManagedSelect
                              label="Recruitment Manager"
                              value={app?.recruitment_manager || ''}
                              disabled={!!rowBusy[cand.id]}
                              canManage={false}
                              options={recruitmentManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                              onChange={async (v) => {
                                if (!token) return;
                                setRowBusy((s) => ({ ...s, [cand.id]: true }));
                                try {
                                  const resolvedApp =
                                    app ??
                                    (await trackerApi.createApplication(token, {
                                      candidate_id: cand.id,
                                      status: 'MRF Pending',
                                    }, apiTeam));
                                  await trackerApi.updateApplication(token, resolvedApp.id, { recruitment_manager: v || null }, apiTeam);
                                  await refreshAll();
                                } finally {
                                  setRowBusy((s) => ({ ...s, [cand.id]: false }));
                                }
                              }}
                              onAdd={noopAsync}
                              onEdit={noopAsync as any}
                              onDelete={noopAsync as any}
                            />
                          ) : (
                            <span className="text-[12px] text-slate-600">{app?.recruitment_manager || <span className="text-slate-300">—</span>}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 text-[12px] max-w-[200px]">
                          {app?.comment ? (
                            <button
                              type="button"
                              className="text-left text-[12px] text-slate-700 hover:text-brand-700 underline-offset-2 hover:underline"
                              title={canWriteCandidates ? 'Click to view & edit' : 'Click to view'}
                              onClick={async () => {
                                const current = String(app?.comment || '');
                                setTextPeek({
                                  title: 'Comment',
                                  text: current,
                                  canEdit: !!canWriteCandidates,
                                  onSave: canWriteCandidates
                                    ? async (nextText: string) => {
                                      if (!token) return;
                                      setRowBusy((s) => ({ ...s, [cand.id]: true }));
                                      try {
                                        const resolvedApp =
                                          app ??
                                          (await trackerApi.createApplication(
                                            token,
                                            { candidate_id: cand.id, status: 'MRF Pending' },
                                            apiTeam
                                          ));
                                        await trackerApi.updateApplication(token, resolvedApp.id, { comment: nextText || null }, apiTeam);
                                        await refreshAll();
                                      } finally {
                                        setRowBusy((s) => ({ ...s, [cand.id]: false }));
                                      }
                                    }
                                    : undefined,
                                });
                              }}
                            >
                              <span className="line-clamp-2">{app.comment}</span>
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right sticky right-0 bg-white">
                          <div className="flex items-center justify-end gap-1">
                            {canWriteCandidates ? (
                              <>
                                <button
                                  onClick={async () => {
                                    if (!token) return;
                                    let resolvedApp = app;
                                    if (!resolvedApp) {
                                      resolvedApp = await trackerApi.createApplication(token, {
                                        candidate_id: cand.id,
                                        status: 'MRF Pending',
                                      }, apiTeam);
                                      await refresh();
                                    }
                                    setEditApp({ app: resolvedApp, cand });
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-brand-300 hover:text-brand-700 transition-colors"
                                >
                                  <Pencil className="w-3 h-3" /> Edit
                                </button>
                                <button
                                  onClick={() => { setConfirmDeleteId(cand.id); setConfirmDeleteType('candidate'); }}
                                  disabled={!!rowBusy[cand.id]}
                                  className="p-1 rounded-md border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors disabled:opacity-40"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SyncedXScroll>
            </div>
          ) : view === 'followUps' ? (
            /* ────── Follow-ups table ────── */
            <div className="surface-panel overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-[13px] text-slate-600">
                      Default sort: <span className="font-semibold text-slate-800">Next Follow-up Date (ASC)</span>
                    </div>
                    {canWriteFollowUps ? (
                      <Button
                        size="sm"
                        onClick={() => setEditFollowUp({ mode: 'create' })}
                        className="bg-brand-600 text-white gap-1.5 hover:bg-brand-700"
                      >
                        <Plus className="w-4 h-4 text-white" />
                        <span className="text-white">New Follow-up</span>
                      </Button>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Search — fixed narrow width */}
                    <div className="relative w-[190px] shrink-0">
                      <input
                        value={followupSearch}
                        onChange={(e) => setFollowupSearch(e.target.value)}
                        placeholder="Search follow-ups…"
                        className="h-8 w-full pl-3 pr-8 text-[13px] border border-slate-200 rounded-lg bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                      />
                      {followupSearch ? (
                        <button
                          onClick={() => setFollowupSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          aria-label="Clear follow-up search"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {/* Stage filter */}
                    <Select value={followupStageFilter} onValueChange={setFollowupStageFilter}>
                      <SelectTrigger className="h-8 w-[170px] text-[13px] bg-white border-slate-200 text-slate-800 shrink-0">
                        <SelectValue placeholder="Current Stage" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 overflow-y-auto pointer-events-auto">
                        <SelectItem value="all">All Stages</SelectItem>
                        {(followUpStageOptions?.length ? followUpStageOptions : (FOLLOW_UP_STAGE_OPTIONS.map((s) => ({ id: `stage:${s}`, value: s })) as any)).map((o: any) => (
                          <SelectItem key={o.id} value={o.value}>{o.value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Date range — label + two pickers in one row */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-400 shrink-0">Next Follow-up</span>
                      <input
                        type="date"
                        value={followupNextFrom}
                        onChange={(e) => setFollowupNextFrom(e.target.value)}
                        className="h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 [color-scheme:light]"
                        aria-label="Next Follow-up Date from"
                      />
                      <span className="text-[11px] text-slate-400">–</span>
                      <input
                        type="date"
                        value={followupNextTo}
                        onChange={(e) => setFollowupNextTo(e.target.value)}
                        className="h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 [color-scheme:light]"
                        aria-label="Next Follow-up Date to"
                      />
                      {(followupNextFrom || followupNextTo) && (
                        <button
                          onClick={() => { setFollowupNextFrom(''); setFollowupNextTo(''); }}
                          className="h-8 px-2 text-[11px] text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg bg-white"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <SyncedXScroll>
                <table className="table-premium w-full min-w-[1500px] text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 text-left w-[160px]">Client Name</th>
                      {isAllTeamsView ? <th className="px-4 py-3 text-left w-[110px]">Team</th> : null}
                      <th className="px-4 py-3 text-left w-[160px]">Position</th>
                      <th className="px-4 py-3 text-left w-[160px]">Recruiter Name</th>
                      <th className="px-4 py-3 text-left w-[170px]">Account Manager</th>
                      <th className="px-4 py-3 text-left w-[170px]">Recruitment Manager</th>
                      <th className="px-4 py-3 text-left w-[140px]">CV Submitted Date</th>
                      <th className="px-4 py-3 text-left w-[190px]">Current Stage</th>
                      <th className="px-4 py-3 text-left w-[140px]">Follow Up Date</th>
                      <th className="px-4 py-3 text-left w-[150px]">Next Follow-up Date</th>
                      <th className="px-4 py-3 text-left w-[170px]">Last Reminder Sent</th>
                      <th className="px-4 py-3 text-left w-[130px]">Interview Date</th>
                      <th className="px-4 py-3 text-left w-[220px]">Client Feedback</th>
                      <th className="px-4 py-3 text-left w-[220px]">Interview Feedback</th>
                      <th className="px-4 py-3 text-left w-[220px]">Remarks</th>
                      <th className="px-4 py-3 text-right w-[90px] sticky right-0 bg-slate-50">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleFollowUps.length === 0 ? (
                      <tr>
                        <td colSpan={isAllTeamsView ? 16 : 15} className="px-5 py-16 text-center text-slate-400 text-[13px]">
                          {canWriteFollowUps
                            ? 'No follow-ups yet — click + New Follow-up to add one.'
                            : 'No follow-ups yet.'}
                        </td>
                      </tr>
                    ) : visibleFollowUps.map((r) => {
                      const overdue = isOverdue(r.next_follow_up_date, r.current_stage);
                      return (
                        <tr
                          key={r.id}
                          className={`transition-colors group ${overdue ? 'bg-red-50 hover:bg-red-50' : 'hover:bg-blue-50/20'
                            }`}
                        >
                          <td className="px-4 py-2.5 font-semibold text-slate-900">{r.client_name}</td>
                          {isAllTeamsView ? (
                            <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-[12px]">{(r as any).__team || '—'}</td>
                          ) : null}
                          <td className="px-4 py-2.5 text-slate-700">{r.position || <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2">
                            {canWriteFollowUps ? (
                              <ManagedSelect
                                label="Recruiter"
                                value={r.recruiter_name || ''}
                                disabled={!!rowBusy[r.id]}
                                canManage={false}
                                options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
                                onChange={async (v) => {
                                  if (!token) return;
                                  setRowBusy((s) => ({ ...s, [r.id]: true }));
                                  try { await trackerApi.updateFollowUp(token, r.id, { recruiter_name: v } as any, apiTeam); await refresh(); }
                                  finally { setRowBusy((s) => ({ ...s, [r.id]: false })); }
                                }}
                                onAdd={noopAsync}
                                onEdit={noopAsync as any}
                                onDelete={noopAsync as any}
                              />
                            ) : (
                              <span className="text-[12px] text-slate-700">{r.recruiter_name || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {canWriteFollowUps ? (
                              <ManagedSelect
                                label="Account Manager"
                                value={r.account_manager || ''}
                                disabled={!!rowBusy[r.id]}
                                canManage={false}
                                options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                                onChange={async (v) => {
                                  if (!token) return;
                                  setRowBusy((s) => ({ ...s, [r.id]: true }));
                                  try { await trackerApi.updateFollowUp(token, r.id, { account_manager: v } as any, apiTeam); await refresh(); }
                                  finally { setRowBusy((s) => ({ ...s, [r.id]: false })); }
                                }}
                                onAdd={noopAsync}
                                onEdit={noopAsync as any}
                                onDelete={noopAsync as any}
                              />
                            ) : (
                              <span className="text-[12px] text-slate-700">{r.account_manager || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {canWriteFollowUps ? (
                              <ManagedSelect
                                label="Recruitment Manager"
                                value={r.recruitment_manager || ''}
                                disabled={!!rowBusy[r.id]}
                                canManage={false}
                                options={recruitmentManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                                onChange={async (v) => {
                                  if (!token) return;
                                  setRowBusy((s) => ({ ...s, [r.id]: true }));
                                  try { await trackerApi.updateFollowUp(token, r.id, { recruitment_manager: v } as any, apiTeam); await refresh(); }
                                  finally { setRowBusy((s) => ({ ...s, [r.id]: false })); }
                                }}
                                onAdd={noopAsync}
                                onEdit={noopAsync as any}
                                onDelete={noopAsync as any}
                              />
                            ) : (
                              <span className="text-[12px] text-slate-700">{r.recruitment_manager || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 text-[12px] whitespace-nowrap">{r.cv_submitted_date ? formatDate(String(r.cv_submitted_date)) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5">
                            {canWriteFollowUps ? (
                              <ManagedSelect
                                label="Current Stage"
                                value={r.current_stage || ''}
                                disabled={!!rowBusy[r.id]}
                                canManage={false}
                                options={(followUpStageOptions?.length ? followUpStageOptions : (FOLLOW_UP_STAGE_OPTIONS.map((s) => ({ id: `stage:${s}`, value: s })) as any)).map((o: any) => ({ id: o.id, value: o.value }))}
                                onChange={async (v) => {
                                  if (!token) return;
                                  setRowBusy((s) => ({ ...s, [r.id]: true }));
                                  try { await trackerApi.updateFollowUp(token, r.id, { current_stage: v } as any, apiTeam); await refresh(); }
                                  finally { setRowBusy((s) => ({ ...s, [r.id]: false })); }
                                }}
                                onAdd={noopAsync}
                                onEdit={noopAsync as any}
                                onDelete={noopAsync as any}
                              />
                            ) : (
                              <span className={`inline-flex items-center px-2 py-1 rounded-md border text-[11px] font-semibold ${stageBadgeClass(r.current_stage, overdue)}`}>
                                {overdue && r.current_stage !== 'Overdue Follow-ups' ? `Overdue Follow-ups` : r.current_stage}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 text-[12px] whitespace-nowrap">{r.last_follow_up_date ? formatDate(String(r.last_follow_up_date)) : <span className="text-slate-300">—</span>}</td>
                          <td className={`px-4 py-2.5 text-[12px] whitespace-nowrap ${overdue ? 'text-red-700 font-semibold' : 'text-slate-700'}`}>
                            {r.next_follow_up_date ? formatDate(String(r.next_follow_up_date)) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 text-[12px] whitespace-nowrap">
                            {r.reminder_last_sent_at ? (
                              <span title={formatDateTime(String(r.reminder_last_sent_at))}>{formatDateTime(String(r.reminder_last_sent_at))}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 text-[12px] whitespace-nowrap">{r.interview_date ? formatDate(String(r.interview_date)) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-700">
                            {r.client_feedback ? (
                              <button
                                type="button"
                                className="text-left text-[12px] text-slate-700 hover:text-brand-700 underline-offset-2 hover:underline"
                                title={canWriteFollowUps ? 'Click to view & edit' : 'Click to view'}
                                onClick={() => setTextPeek({
                                  title: 'Client Feedback',
                                  text: String(r.client_feedback),
                                  canEdit: !!canWriteFollowUps,
                                  onSave: canWriteFollowUps ? async (nextText: string) => {
                                    if (!token) return;
                                    setRowBusy((s) => ({ ...s, [r.id]: true }));
                                    try { await trackerApi.updateFollowUp(token, r.id, { client_feedback: nextText || null } as any, apiTeam); await refresh(); }
                                    finally { setRowBusy((s) => ({ ...s, [r.id]: false })); }
                                  } : undefined,
                                })}
                              >
                                {truncate10(r.client_feedback)}
                              </button>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">
                            {r.interview_feedback ? (
                              <button
                                type="button"
                                className="text-left text-[12px] text-slate-700 hover:text-brand-700 underline-offset-2 hover:underline"
                                title={canWriteFollowUps ? 'Click to view & edit' : 'Click to view'}
                                onClick={() => setTextPeek({
                                  title: 'Interview Feedback',
                                  text: String(r.interview_feedback),
                                  canEdit: !!canWriteFollowUps,
                                  onSave: canWriteFollowUps ? async (nextText: string) => {
                                    if (!token) return;
                                    setRowBusy((s) => ({ ...s, [r.id]: true }));
                                    try { await trackerApi.updateFollowUp(token, r.id, { interview_feedback: nextText || null } as any, apiTeam); await refresh(); }
                                    finally { setRowBusy((s) => ({ ...s, [r.id]: false })); }
                                  } : undefined,
                                })}
                              >
                                {truncate10(r.interview_feedback)}
                              </button>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">
                            {r.remarks ? (
                              <button
                                type="button"
                                className="text-left text-[12px] text-slate-700 hover:text-brand-700 underline-offset-2 hover:underline"
                                title={canWriteFollowUps ? 'Click to view & edit' : 'Click to view'}
                                onClick={() => setTextPeek({
                                  title: 'Remarks',
                                  text: String(r.remarks),
                                  canEdit: !!canWriteFollowUps,
                                  onSave: canWriteFollowUps ? async (nextText: string) => {
                                    if (!token) return;
                                    setRowBusy((s) => ({ ...s, [r.id]: true }));
                                    try { await trackerApi.updateFollowUp(token, r.id, { remarks: nextText || null } as any, apiTeam); await refresh(); }
                                    finally { setRowBusy((s) => ({ ...s, [r.id]: false })); }
                                  } : undefined,
                                })}
                              >
                                {truncate10(r.remarks)}
                              </button>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right sticky right-0 bg-white">
                            <div className="flex items-center justify-end gap-1">
                              {canWriteFollowUps ? (
                                <>
                                  <button
                                    onClick={() => setEditFollowUp({ mode: 'edit', row: r })}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-brand-300 hover:text-brand-700 transition-colors"
                                  >
                                    <Pencil className="w-3 h-3" /> Edit
                                  </button>
                                  <button
                                    onClick={() => { setConfirmDeleteId(r.id); setConfirmDeleteType('followup'); }}
                                    className="p-1 rounded-md border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SyncedXScroll>
            </div>
          ) : (
            /* ────── Manager Settings ────── */
            <div className="surface-panel overflow-hidden">
              {!canAccessManagerSettings ? (
                <div className="p-6 text-[13px] text-slate-600">
                  You don’t have access to Manager Settings.
                </div>
              ) : (
                <div className="p-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-[14px] font-bold text-slate-900">Manager Settings</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">
                        Central master list for Recruiters, Account Managers, and Recruitment Managers.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-[12px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={msShowInactive}
                          onChange={(e) => setMsShowInactive(e.target.checked)}
                        />
                        Show inactive
                      </label>
                      {isAdmin && teamView === 'dubai' ? (
                        <Button
                          variant="outline"
                          disabled={!token || msLoading}
                          className="h-8 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                          onClick={async () => {
                            if (!token) return;
                            if (!window.confirm('This will CLEAR ALL Dubai Tracker data (Requirement Status, Selections & Joinings, Follow-ups, and Manager Settings). Abu Dhabi data will NOT be affected. Continue?')) return;
                            try {
                              await trackerApi.clearTeam(token, 'dubai', 'CLEAR');
                              window.alert('Dubai tracker data cleared.');
                              await refreshAll();
                              await loadManagerSettings();
                            } catch (e: any) {
                              window.alert(e?.message || 'Failed to clear Dubai data');
                            }
                          }}
                          title="Clear Dubai tracker tables only"
                        >
                          Clear Dubai Data
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        onClick={loadManagerSettings}
                        disabled={!token || msLoading}
                        className="h-8"
                      >
                        {msLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Refresh
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 mt-5">
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-[13px] font-bold text-slate-800">Follow-up Reminders</div>
                          <div className="text-[12px] text-slate-500 mt-0.5">
                            Uses Manager Settings "To" email(s). CC is built automatically from the Follow-up row selections (Recruiter + Account Manager + Recruitment Manager) plus optional default CC. Enable sending with{' '}
                            <code className="px-1 py-0.5 bg-slate-100 rounded">SEND_EMAIL_REMINDER_FOLLOWUP=true</code>.
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="rounded-lg border border-slate-200 bg-white p-3 mb-3">
                          <div className="text-[12px] font-semibold text-slate-800">Email recipients (Manager Settings)</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Set default To/CC emails for follow-up reminders. To is required. CC is optional (comma-separated).
                          </div>
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                              <div className="text-[11px] font-semibold text-slate-600 mb-1">To</div>
                              <input
                                value={msFollowupEmailTo}
                                onChange={(e) => setMsFollowupEmailTo(e.target.value)}
                                placeholder="to@example.com, to2@example.com"
                                className="h-9 w-full px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                              />
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold text-slate-600 mb-1">Default CC (optional)</div>
                              <input
                                value={msFollowupEmailCc}
                                onChange={(e) => setMsFollowupEmailCc(e.target.value)}
                                placeholder="cc@example.com, cc2@example.com"
                                className="h-9 w-full px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                              />
                            </div>
                          </div>
                          <div className="mt-2 flex justify-end">
                            <Button
                              disabled={!token || msFollowupEmailSaving || !msFollowupEmailTo.trim()}
                              className="bg-brand-600 text-white hover:bg-brand-700"
                              onClick={async () => {
                                if (!token) return;
                                const to = msFollowupEmailTo.trim();
                                const cc = msFollowupEmailCc.trim();
                                if (!to) return;
                                setMsFollowupEmailSaving(true);
                                try {
                                  await trackerApi.setFollowupEmailSettings(token, { to, cc }, apiTeam);
                                  window.alert('Follow-up email recipients saved.');
                                  await loadManagerSettings();
                                } catch (e: any) {
                                  const msg =
                                    e?.response?.data?.detail ??
                                    e?.response?.data?.error ??
                                    e?.message ??
                                    'Failed to save follow-up email settings';
                                  window.alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
                                } finally {
                                  setMsFollowupEmailSaving(false);
                                }
                              }}
                            >
                              {msFollowupEmailSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2 text-white" /> : <Save className="w-4 h-4 mr-2 text-white" />}
                              <span className="text-white">Save recipients</span>
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-3 mb-3">
                          <div className="text-[12px] font-semibold text-slate-800">Send time (UAE)</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Choose the daily time reminders should be sent for this team (Dubai/Abu Dhabi). Changing the time today will send again at the new time.
                          </div>
                          <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
                            <input
                              type="time"
                              value={msReminderTime}
                              onChange={(e) => setMsReminderTime(e.target.value)}
                              className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 w-full sm:w-[160px]"
                            />
                            <Button
                              disabled={!token || msReminderTimeSaving || !msReminderTime}
                              className="bg-brand-600 text-white hover:bg-brand-700"
                              onClick={async () => {
                                if (!token) return;
                                const v = (msReminderTime || '').trim();
                                if (!v) return;
                                setMsReminderTimeSaving(true);
                                try {
                                  if (msReminderTimeId) {
                                    await trackerApi.updateOption(token, msReminderTimeId, { value: v }, apiTeam);
                                  } else {
                                    const created = await trackerApi.createOption(token, 'followup_reminder_send_time', v, apiTeam);
                                    setMsReminderTimeId(created.id);
                                  }
                                  window.alert('Reminder send time saved.');
                                  await loadManagerSettings();
                                } catch (e: any) {
                                  const msg =
                                    e?.response?.data?.detail ??
                                    e?.response?.data?.error ??
                                    e?.message ??
                                    'Failed to save reminder time';
                                  window.alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
                                } finally {
                                  setMsReminderTimeSaving(false);
                                }
                              }}
                            >
                              {msReminderTimeSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2 text-white" /> : <Save className="w-4 h-4 mr-2 text-white" />}
                              <span className="text-white">Save time</span>
                            </Button>
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-[12px] font-semibold text-slate-800">Send reminder now</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Select a Follow-up row and send an email (To/CC resolved automatically from the row).
                          </div>
                          <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
                            <div className="flex-1">
                              <Select value={msSendFollowupId} onValueChange={setMsSendFollowupId}>
                                <SelectTrigger className="h-9 bg-white border-slate-300 text-slate-900">
                                  <SelectValue placeholder="Select follow-up…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(followUps || [])
                                    .slice()
                                    .sort((a, b) => {
                                      const ad = a.next_follow_up_date ? new Date(a.next_follow_up_date).getTime() : Number.POSITIVE_INFINITY;
                                      const bd = b.next_follow_up_date ? new Date(b.next_follow_up_date).getTime() : Number.POSITIVE_INFINITY;
                                      return ad - bd;
                                    })
                                    .slice(0, 200)
                                    .map((f) => {
                                      const label = `${f.client_name}${f.position ? ` • ${f.position}` : ''}${f.next_follow_up_date ? ` • Next: ${formatDate(f.next_follow_up_date)}` : ''}`;
                                      return (
                                        <SelectItem key={f.id} value={f.id}>
                                          {label}
                                        </SelectItem>
                                      );
                                    })}
                                </SelectContent>
                              </Select>
                              <div className="text-[10px] text-slate-400 mt-1">
                                Showing up to 200 follow-ups (sorted by Next Follow-up Date).
                              </div>
                            </div>
                            <Button
                              disabled={!token || !msSendFollowupId || msSendingFollowupReminder}
                              className="bg-brand-600 hover:bg-brand-700 !text-white h-9"
                              onClick={async () => {
                                if (!token || !msSendFollowupId) return;
                                setMsSendingFollowupReminder(true);
                                try {
                                  await trackerApi.sendFollowupReminderNow(token, msSendFollowupId, undefined, apiTeam);
                                  window.alert('Reminder email sent.');
                                  await refresh();
                                } catch (e: any) {
                                  const msg =
                                    e?.response?.data?.detail ??
                                    e?.response?.data?.error ??
                                    e?.message ??
                                    'Failed to send reminder';
                                  window.alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
                                } finally {
                                  setMsSendingFollowupReminder(false);
                                }
                              }}
                              title="Send reminder email now"
                            >
                              {msSendingFollowupReminder ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                              Send now
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {([
                      { kind: 'recruiter', label: 'Recruiters', rows: msRecruiters },
                      { kind: 'account_manager', label: 'Account Managers', rows: msAccountManagers },
                      { kind: 'recruitment_manager', label: 'Recruitment Managers', rows: msRecruitmentManagers },
                      { kind: 'job_status', label: 'Requirement Status (Status)', rows: msRequirementStatuses },
                      { kind: 'candidate_status', label: 'Selections & Joinings (Status)', rows: msSelectionStatuses },
                      { kind: 'followup_stage', label: 'Follow-ups (Current Stage)', rows: msFollowUpStages },
                    ] as const).map((sec) => {
                      const rows = (sec.rows || []).filter((r) => msShowInactive || !r.is_deleted);
                      const inactiveCount = (sec.rows || []).filter((r) => r.is_deleted).length;
                      const showsEmail = sec.kind === 'recruiter' || sec.kind === 'account_manager' || sec.kind === 'recruitment_manager';
                      const showsReminder = sec.kind === 'account_manager';
                      const colSpan = 1 + (showsEmail ? 1 : 0) + (showsReminder ? 1 : 0) + 1 + 1;
                      return (
                        <div key={sec.kind} className="rounded-lg border border-slate-200 overflow-hidden">
                          <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
                            <div className="text-[13px] font-bold text-slate-800">{sec.label}</div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!token || inactiveCount === 0}
                                onClick={async () => {
                                  if (!token) return;
                                  if (!window.confirm(`Permanently delete ${inactiveCount} inactive entr${inactiveCount === 1 ? 'y' : 'ies'}? This only cleans tracker settings; historical records stay unchanged.`)) return;
                                  await trackerApi.purgeInactiveOptions(token, sec.kind);
                                  await loadManagerSettings();
                                  await loadOptions();
                                }}
                                className="h-8"
                                title="Permanently delete inactive (soft-deleted) names"
                              >
                                Purge inactive
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setMsAddOpen(sec.kind);
                                  setMsDraft('');
                                  setMsEmailDraft('');
                                  setMsEmailEnabledDraft(true);
                                }}
                                className="bg-brand-600 text-white h-8 hover:bg-brand-700"
                                disabled={!token}
                              >
                                <Plus className="w-4 h-4 text-white mr-1" /> Add
                              </Button>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="table-premium w-full text-[13px]">
                              <thead>
                                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  <th className="px-3 py-2 text-left">Name</th>
                                  {showsEmail ? (
                                    <th className="px-3 py-2 text-left">Email</th>
                                  ) : null}
                                  {showsReminder ? (
                                    <th className="px-3 py-2 text-left w-[120px]">Reminder</th>
                                  ) : null}
                                  <th className="px-3 py-2 text-left w-[70px]">Active</th>
                                  <th className="px-3 py-2 text-right w-[90px]">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {rows.length === 0 ? (
                                  <tr>
                                    <td colSpan={colSpan} className="px-3 py-8 text-center text-slate-400">No entries</td>
                                  </tr>
                                ) : rows.map((r) => (
                                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-3 py-2 font-semibold text-slate-900">{r.value}</td>
                                    {showsEmail ? (
                                      <td className="px-3 py-2 text-[12px] text-slate-700">{r.email || '—'}</td>
                                    ) : null}
                                    {sec.kind === 'account_manager' ? (
                                      <td className="px-3 py-2">
                                        <button
                                          className={`px-2 py-1 rounded-md border text-[11px] font-semibold ${(r.email_enabled ?? true)
                                              ? 'border-green-200 text-green-700 hover:bg-green-50'
                                              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                                            }`}
                                          title="Toggle sending reminders for this Account Manager"
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (!token) return;
                                            await trackerApi.updateOption(token, r.id, { email_enabled: !(r.email_enabled ?? true) });
                                            await loadManagerSettings();
                                            await loadOptions();
                                          }}
                                        >
                                          {(r.email_enabled ?? true) ? 'ON' : 'OFF'}
                                        </button>
                                      </td>
                                    ) : null}
                                    <td className="px-3 py-2 text-[12px] text-slate-700">{r.is_deleted ? 'No' : 'Yes'}</td>
                                    <td className="px-3 py-2 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => {
                                            setMsEdit({ id: r.id, kind: sec.kind, value: r.value });
                                            setMsDraft(r.value);
                                            setMsEmailDraft(String(r.email || ''));
                                            setMsEmailEnabledDraft(Boolean(r.email_enabled ?? true));
                                          }}
                                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-brand-300 hover:text-brand-700 transition-colors"
                                        >
                                          <Pencil className="w-3 h-3" /> Edit
                                        </button>
                                        <button
                                          onClick={async () => {
                                            if (!token) return;
                                            if (!window.confirm('Mark as inactive? Historical records will stay unchanged.')) return;
                                            await trackerApi.deleteOption(token, r.id);
                                            await loadManagerSettings();
                                            await loadOptions();
                                          }}
                                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add dialog */}
                  {msAddOpen ? (
                    <Dialog open onOpenChange={(o) => { if (!o) setMsAddOpen(null); }}>
                      <DialogContent className="sm:max-w-md bg-white text-slate-900">
                        <DialogHeader>
                          <DialogTitle className="text-slate-900">Add {msAddOpen.replace('_', ' ')}</DialogTitle>
                          <DialogDescription>Add a new active name.</DialogDescription>
                        </DialogHeader>
                        <div className="pt-2">
                          <Input value={msDraft} onChange={(e) => setMsDraft(e.target.value)} placeholder="Name" />
                        </div>
                        {msAddOpen === 'account_manager' || msAddOpen === 'recruitment_manager' ? (
                          <div className="pt-2">
                            <Input value={msEmailDraft} onChange={(e) => setMsEmailDraft(e.target.value)} placeholder="Email (optional)" />
                          </div>
                        ) : null}
                        {msAddOpen === 'account_manager' ? (
                          <label className="flex items-center gap-2 pt-2 text-[12px] text-slate-700">
                            <input
                              type="checkbox"
                              checked={msEmailEnabledDraft}
                              onChange={(e) => setMsEmailEnabledDraft(e.target.checked)}
                            />
                            Send reminder (ON/OFF)
                          </label>
                        ) : null}
                        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                          <Button variant="outline" onClick={() => setMsAddOpen(null)}>Cancel</Button>
                          <Button
                            className="bg-brand-600 text-white hover:bg-brand-700"
                            disabled={!token || !msDraft.trim()}
                            onClick={async () => {
                              if (!token) return;
                              await trackerApi.createOption(
                                token,
                                msAddOpen,
                                msDraft.trim(),
                                apiTeam,
                                msAddOpen === 'recruiter' || msAddOpen === 'account_manager' || msAddOpen === 'recruitment_manager'
                                  ? {
                                    email: msEmailDraft.trim() || null,
                                    email_enabled: msAddOpen === 'account_manager' ? msEmailEnabledDraft : true,
                                  }
                                  : undefined
                              );
                              setMsAddOpen(null);
                              await loadManagerSettings();
                              await loadOptions();
                            }}
                          >
                            Create
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  ) : null}

                  {/* Edit dialog */}
                  {msEdit ? (
                    <Dialog open onOpenChange={(o) => { if (!o) setMsEdit(null); }}>
                      <DialogContent className="sm:max-w-md bg-white text-slate-900">
                        <DialogHeader>
                          <DialogTitle className="text-slate-900">Edit name</DialogTitle>
                          <DialogDescription>Rename this entry. Historical rows remain unchanged until you edit them.</DialogDescription>
                        </DialogHeader>
                        <div className="pt-2">
                          <Input value={msDraft} onChange={(e) => setMsDraft(e.target.value)} placeholder="Name" />
                        </div>
                        {msEdit.kind === 'recruiter' || msEdit.kind === 'account_manager' || msEdit.kind === 'recruitment_manager' ? (
                          <div className="pt-2">
                            <Input value={msEmailDraft} onChange={(e) => setMsEmailDraft(e.target.value)} placeholder="Email (optional)" />
                          </div>
                        ) : null}
                        {msEdit.kind === 'account_manager' ? (
                          <label className="flex items-center gap-2 pt-2 text-[12px] text-slate-700">
                            <input
                              type="checkbox"
                              checked={msEmailEnabledDraft}
                              onChange={(e) => setMsEmailEnabledDraft(e.target.checked)}
                            />
                            Send reminder (ON/OFF)
                          </label>
                        ) : null}
                        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                          <Button variant="outline" onClick={() => setMsEdit(null)}>Cancel</Button>
                          <Button
                            className="bg-brand-600 text-white hover:bg-brand-700"
                            disabled={!token || !msDraft.trim()}
                            onClick={async () => {
                              if (!token) return;
                              await trackerApi.updateOption(token, msEdit.id, {
                                value: msDraft.trim(),
                                ...(msEdit.kind === 'recruiter' || msEdit.kind === 'account_manager' || msEdit.kind === 'recruitment_manager'
                                  ? { email: msEmailDraft.trim() || null }
                                  : {}),
                                ...(msEdit.kind === 'account_manager' ? { email_enabled: msEmailEnabledDraft } : {}),
                              });
                              setMsEdit(null);
                              await loadManagerSettings();
                              await loadOptions();
                            }}
                          >
                            <Save className="w-4 h-4 mr-2 text-white" />
                            <span className="text-white">Save</span>
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <EditJobOpeningDialog
        job={editJob}
        onClose={() => setEditJob(null)}
        onSaved={refreshAll}
        team={apiTeam}
        jobStatusOptions={jobStatusOptions}
        requirementOptions={requirementOptions}
        recruiterOptions={recruiterOptions}
        accountManagerOptions={accountManagerOptions}
        recruitmentManagerOptions={recruitmentManagerOptions}
        canManageOptions={canManageJobOptions}
        onAddOption={createOption}
        onEditOption={editOption}
        onDeleteOption={deleteOption}
      />
      <EditApplicationDialog
        app={editApp?.app ?? null}
        cand={editApp?.cand ?? null}
        onClose={() => setEditApp(null)}
        onSaved={refreshAll}
        team={apiTeam}
        statusOptions={candidateStatusOptions}
        recruiterOptions={recruiterOptions}
        accountManagerOptions={accountManagerOptions}
        canManageOptions={canManageCandidateOptions}
        onAddOption={createOption}
        onEditOption={editOption}
        onDeleteOption={deleteOption}
      />
      {editFollowUp ? (
        <FollowUpDialog
          mode={editFollowUp.mode}
          initial={editFollowUp.mode === 'edit' ? editFollowUp.row : undefined}
          team={apiTeam}
          recruiterOptions={recruiterOptions}
          accountManagerOptions={accountManagerOptions}
          recruitmentManagerOptions={recruitmentManagerOptions}
          followUpStageOptions={followUpStageOptions}
          onClose={() => setEditFollowUp(null)}
          onSaved={refresh}
        />
      ) : null}

<TextPeekDialog
        textPeek={textPeek}
        textPeekDraft={textPeekDraft}
        textPeekSaving={textPeekSaving}
        onClose={() => setTextPeek(null)}
        onDraftChange={setTextPeekDraft}
        onSave={async () => {
          if (!textPeek?.onSave) return;
          setTextPeekSaving(true);
          try {
            await textPeek.onSave(textPeekDraft);
            setTextPeek(null);
          } catch (e: any) {
            const msg =
              e?.response?.data?.detail ??
              e?.response?.data?.error ??
              e?.message ??
              'Failed to save';
            window.alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
          } finally {
            setTextPeekSaving(false);
          }
        }}
      />

      <ImportSelectionsModal
        open={importOpen}
        importTeam={importTeam}
        importFile={importFile}
        importBusy={importBusy}
        token={token}
        onOpenChange={(o) => {
          if (!o) {
            setImportOpen(false);
            setImportFile(null);
          }
        }}
        onImportTeamChange={setImportTeam}
        onImportFileChange={setImportFile}
        onImport={async () => {
          if (!token || !importFile) return;
          setImportBusy(true);
          try {
            await trackerApi.importSelectionsXlsx(token, importTeam, importFile);
            await refreshAll();
            setImportOpen(false);
            setImportFile(null);
            window.alert('Import completed.');
          } catch (e: any) {
            window.alert(e?.message || 'Import failed');
          } finally {
            setImportBusy(false);
          }
        }}
        onCancel={() => {
          setImportOpen(false);
          setImportFile(null);
        }}
      />

      <DeleteConfirmDialog
        confirmDeleteId={confirmDeleteId}
        confirmDeleteType={confirmDeleteType}
        token={token}
        apiTeam={apiTeam}
        rowBusy={rowBusy}
        onCancel={() => {
          setConfirmDeleteId(null);
          setConfirmDeleteType(null);
        }}
        onConfirm={async () => {
          if (!token || !confirmDeleteId) return;
          setRowBusy((s) => ({ ...s, [confirmDeleteId]: true }));
          try {
            if (confirmDeleteType === 'job') {
              await trackerApi.deleteJobOpening(token, confirmDeleteId, apiTeam);
            } else if (confirmDeleteType === 'candidate') {
              await trackerApi.deleteCandidate(token, confirmDeleteId, apiTeam);
            } else {
              await trackerApi.deleteFollowUp(token, confirmDeleteId, apiTeam);
            }
            await refresh();
          } finally {
            setRowBusy((s) => ({ ...s, [confirmDeleteId]: false }));
            setConfirmDeleteId(null);
            setConfirmDeleteType(null);
          }
        }}
      />
    </div>
  );
}
