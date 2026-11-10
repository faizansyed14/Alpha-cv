'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Users,
  FileText,
  RefreshCw,
  Search,
  Loader2,
  X,
  Code2,
  GripVertical,
  Upload,
  Copy,
  Check,
  Code,
  SlidersHorizontal,
} from '@/components/icons';
import { useRouter } from 'next/navigation';
import { canUseAgents, linkedinHref } from '@/lib/agentLinks';
import { useAppStore } from '@/stores/appStore';
import { useSavedCvsStore } from '@/stores/savedCvsStore';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';
import { Segmented } from '@/components/ui/segmented';
import { Avatar } from '@/components/ui/avatar';
import { CVAdvancedSearchParams, CVListItem, JDListItem, CVSearchResult } from '@/lib/types';
import { CandidatesListSkeleton, JobsTableSkeleton } from '@/components/skeletons';
import AdvancedSearchModal from '@/components/database/AdvancedSearchModal';
import ContactActions from '@/components/common/ContactActions';
import CandidateCard from '@/components/database/CandidateCard';
import JobCard from '@/components/database/JobCard';
import FilterSidebar, { type FilterGroupDef } from '@/components/common/FilterSidebar';
import { restoreScroll, saveScroll, SCROLL_KEYS } from '@/lib/scrollRestore';

const FilePreviewModal = dynamic(
  () => import('@/components/ui/file-preview-modal').then((mod) => mod.FilePreviewModal),
  { ssr: false }
);

const ITEMS_PER_PAGE = 200;   // same as the API page size (200 per call)
const CATEGORY_ALL = '__all__';

export function getCVDisplay(cv: CVListItem) {
  const contactEmail =
    cv.email ||
    (cv as any).job_application?.applicant_email ||
    null;
  const contactPhone =
    cv.phone ||
    (cv as any).job_application?.applicant_phone ||
    null;
  const skills = (cv.skills && cv.skills.length > 0)
    ? cv.skills.filter(Boolean).slice(0, 20)
    : [];
  const skillKeywords = (cv.skill_keywords && cv.skill_keywords.length > 0)
    ? cv.skill_keywords.filter(Boolean).slice(0, 20)
    : [];
  const languages = Array.isArray(cv.languages)
    ? cv.languages.filter((l): l is string => typeof l === 'string' && !!l.trim())
    : [];
  const certifications = Array.isArray(cv.certifications)
    ? cv.certifications.filter((c): c is string => typeof c === 'string' && !!c.trim())
    : [];
  return {
    name: cv.full_name || cv.filename || 'Unknown',
    title: cv.job_title || '-',
    years: cv.years_of_experience ?? '-',
    skillsCount: cv.skills_count ?? skills.length,
    category: (cv as CVListItem & { category?: string }).category ?? 'General',
    filename: cv.filename || '',
    expectedSalary: (cv as any).job_application?.expected_salary ?? (cv as any).expected_salary ?? '-',
    appliedJob: cv.applied_job_title || null,
    isApplication: !!cv.is_job_application,
    matchScore: typeof cv.match_score === 'number' ? cv.match_score : null,
    isTopForJob: !!cv.is_top_for_job,
    matchRank: cv.match_rank ?? null,
    skills,
    skillKeywords,
    email: contactEmail,
    phone: contactPhone,
    linkedin: cv.linkedin_url || null,
    github: cv.github_url || null,
    gender: cv.gender || null,
    languages,
    certifications,
    location: cv.location || null,
    nationality: cv.nationality || null,
  };
}

function getJDDisplay(jd: JDListItem) {
  const skills = (jd.skills && jd.skills.length > 0) ? jd.skills.filter(Boolean).slice(0, 20) : [];
  const skillKeywords = (jd.skill_keywords && jd.skill_keywords.length > 0)
    ? jd.skill_keywords.filter(Boolean).slice(0, 20)
    : skills.slice(0, 12);
  return {
    title: jd.job_title || jd.filename || 'Untitled',
    filename: jd.filename || '',
    years: jd.years_of_experience ?? '-',
    skillsCount: jd.skills_count ?? skills.length,
    skills,
    skillKeywords,
    responsibilitiesCount: jd.responsibilities_count ?? 0,
    uploadDate: formatDate(jd.upload_date),
  };
}

function formatDate(dateString?: string) {
  if (!dateString || dateString === 'Unknown') return '-';
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return '-';
  }
}

interface DatabasePageProps {
  /** When set, the page shows ONLY this view and hides the Candidates/Jobs switch. */
  lockedView?: 'candidates' | 'jobs';
}

const DETAIL_MIN = 380;
const DETAIL_MAX = 880;
const DETAIL_DEFAULT = 560;
const DETAIL_WIDTH_KEY = 'alphacv.detailWidth';

export default function DatabasePage({ lockedView }: DatabasePageProps = {}) {
  const { go } = useWorkspaceNav();
  const router = useRouter();
  const {
    cvs,
    jds,
    totalCVs,
    totalJDs,
    selectedCVs,
    selectedJD,
    loadCVs,
    loadJDs,
    loadMoreCVs,
    loadMoreJDs,
    selectCV,
    deselectCV,
    selectJD,
    deselectAllCVs,
    deleteCV,
    deleteJD,
    loadingStates, databaseActiveTab,
  } = useAppStore();
  const { user } = useAuthStore();
  const savedIds = useSavedCvsStore((st) => st.ids);
  const saveCvs = useSavedCvsStore((st) => st.save);
  const unsaveCvs = useSavedCvsStore((st) => st.unsave);
  const canSave = user?.role !== 'account_manager';
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const toggleSaved = (id: string) => {
    const wasSaved = savedIds.includes(id);
    void (wasSaved ? unsaveCvs([id]) : saveCvs([id])).catch(() => setSaveNotice('Could not update your saved CVs. Please try again.'));
  };

  const saveSelected = async () => {
    const before = savedIds.length;
    try {
      await saveCvs(selectedCVs);
      const added = useSavedCvsStore.getState().ids.length - before;
      setSaveNotice(added > 0 ? `${added.toLocaleString()} CV${added === 1 ? '' : 's'} added to Saved CVs` : 'Those CVs are already in Saved CVs');
    } catch {
      setSaveNotice('Could not save the selected CVs. Please try again.');
    }
    setTimeout(() => setSaveNotice(null), 4000);
  };

  const [search, setSearch] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [searchModalMode, setSearchModalMode] = useState<'keywords' | 'boolean'>('keywords');
  const [activeFolder, setActiveFolder] = useState<string>(CATEGORY_ALL);
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [folderCVs, setFolderCVs] = useState<Record<string, { items: CVListItem[]; total: number | null }>>({});
  const [loadingFolderCVs, setLoadingFolderCVs] = useState<Record<string, boolean>>({});
  // Document preview, same approach as the Matching page (always render the
  // original file as a PDF via a blob URL; the modal sniffs the bytes so DOCX
  // and text also work).
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ isOpen: boolean; url: string; name: string; id: string; type: 'cv' | 'jd' | '' }>({
    isOpen: false, url: '', name: '', id: '', type: '',
  });
  const [previewLoadError, setPreviewLoadError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [view, setView] = useState<'candidates' | 'jobs'>(
    lockedView ?? (databaseActiveTab === 'jds' ? 'jobs' : 'candidates')
  );

  // Keep the view in sync when this page is mounted in "locked" mode (Candidates/Jobs routes).
  useEffect(() => {
    if (lockedView) setView(lockedView);
  }, [lockedView]);
  const [detailCVId, setDetailCVId] = useState<string | null>(null);
  const [notesSummary, setNotesSummary] = useState<
    Record<string, { count: number; text: string | null; author: string | null }>
  >({});
  const [cardNoteSavingId, setCardNoteSavingId] = useState<string | null>(null);
  const [detailCV, setDetailCV] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailJDId, setDetailJDId] = useState<string | null>(null);
  const [detailJD, setDetailJD] = useState<any>(null);
  const [detailJDLoading, setDetailJDLoading] = useState(false);
  const [booleanCopied, setBooleanCopied] = useState(false);
  const [notesFilter, setNotesFilter] = useState<'all' | 'with_notes' | 'without_notes'>('all');
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT);

  useEffect(() => {
    const saved = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
    if (saved >= DETAIL_MIN && saved <= DETAIL_MAX) setDetailWidth(saved);
  }, []);

  const onDetailDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = detailWidth;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      setDetailWidth(Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, startW - (ev.clientX - startX))));
    };
    const up = (ev: PointerEvent) => {
      const next = Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, startW - (ev.clientX - startX)));
      setDetailWidth(next);
      localStorage.setItem(DETAIL_WIDTH_KEY, String(next));
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [serverSearchCVs, setServerSearchCVs] = useState<{ items: CVListItem[]; total: number | null; more: boolean }>({
    items: [],
    total: null,
    more: false,
  });
  const [serverSearching, setServerSearching] = useState(false);
  const [loadingMoreSearch, setLoadingMoreSearch] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  /** Left filter rail: multi-select facets */
  const [sidebarFilters, setSidebarFilters] = useState<Record<string, string[]>>({
    category: [],
    location: [],
    nationality: [],
    language: [],
  });
  const [locationFacets, setLocationFacets] = useState<{ value: string; count: number; members?: string[] }[]>([]);
  const [nationalityFacets, setNationalityFacets] = useState<{ value: string; count: number }[]>([]);
  const [languageFacets, setLanguageFacets] = useState<{ value: string; count: number }[]>([]);
  const [geoFilterCVs, setGeoFilterCVs] = useState<CVListItem[] | null>(null);
  const [geoFilterLoading, setGeoFilterLoading] = useState(false);
  /** Paging of the server-filtered lists (checkbox filters, advanced search): the next page is fetched when the reader gets to the end. */
  const [geoCursor, setGeoCursor] = useState<string | null>(null);
  const [geoTotal, setGeoTotal] = useState<{ count: number; estimate: boolean } | null>(null);
  const [advancedCursor, setAdvancedCursor] = useState<string | null>(null);
  const [loadingMoreFiltered, setLoadingMoreFiltered] = useState(false);
  const geoQueryRef = useRef<CVAdvancedSearchParams | null>(null);
  /** Job descriptions found by the server for the search box (every JD, not only the ones loaded so far). */
  const [serverJDs, setServerJDs] = useState<JDListItem[] | null>(null);
  const [jdSearchMore, setJdSearchMore] = useState(false);
  const [loadingMoreJDs, setLoadingMoreJDs] = useState(false);
  /** Advanced / boolean search results shown in place of the normal CV list. */
  const [advancedResults, setAdvancedResults] = useState<CVSearchResult[] | null>(null);
  const [advancedSearching, setAdvancedSearching] = useState(false);
  const [advancedTotal, setAdvancedTotal] = useState<{ count: number; estimate: boolean } | null>(null);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  /** Last submitted advanced query — kept so boolean string can be edited above results. */
  const [advancedQuery, setAdvancedQuery] = useState<CVAdvancedSearchParams | null>(null);
  const [booleanEdit, setBooleanEdit] = useState('');

  // Open the document preview. Identical to the Matching page: fetch the
  // original file as an authenticated blob, hand the modal a blob URL, and
  // force a ".pdf" name (the modal sniffs the real bytes anyway). We never
  // rename the preview from a Content-Disposition header, that was what made
  // this page fall back to dumping raw bytes as text.
  const handlePreviewFile = async (id: string, type: 'cv' | 'jd', rawName?: string) => {
    const base = (rawName || (type === 'cv' ? 'document' : 'job-description')).trim();
    const name = base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;

    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewLoadError(null);
    setPreviewLoading(true);
    setPreviewData({ isOpen: true, url: '', name, id, type });

    try {
      const blob = type === 'cv'
        ? (await api.downloadCV(id)).blob
        : await api.downloadStorageFile('jd', id);
      if (!blob || blob.size === 0) throw new Error('Document is empty');
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
      setPreviewData({ isOpen: true, url, name, id, type });
    } catch (e) {
      setPreviewLoadError(e instanceof Error ? e.message : 'Failed to load document');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewData({ isOpen: false, url: '', name: '', id: '', type: '' });
    setPreviewLoadError(null);
    setPreviewLoading(false);
  };

  useEffect(() => {
    loadCVs();
    loadJDs();
  }, [loadCVs, loadJDs]);

  useEffect(() => {
    const pool =
      advancedResults && advancedResults.length > 0
        ? advancedResults
        : geoFilterCVs && geoFilterCVs.length > 0
          ? geoFilterCVs
          : activeFolder !== CATEGORY_ALL
            ? (folderCVs[activeFolder]?.items ?? [])
            : cvs;
    const ids = pool.map((c) => c.id).filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    api.getNotesSummary(ids).then((r) => {
      if (cancelled) return;
      setNotesSummary((prev) => {
        const next = { ...prev };
        (r.summaries || []).forEach((s: any) => {
          if (!s.cv_id) return;
          const count = Number(s.notes_count || 0);
          if (count <= 0) {
            delete next[s.cv_id];
            return;
          }
          const latest = s.latest_note;
          const text =
            typeof latest === 'string'
              ? latest
              : typeof latest?.note === 'string'
                ? latest.note
                : null;
          const author =
            typeof latest === 'object' && latest && typeof latest.hr_user === 'string'
              ? latest.hr_user
              : null;
          next[s.cv_id] = { count, text, author };
        });
        return next;
      });
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [cvs, geoFilterCVs, activeFolder, folderCVs, advancedResults]);

  useEffect(() => {
    if (!detailCVId) {
      setDetailCV(null);
      return;
    }
    setDetailLoading(true);
    api
      .getCVDetails(detailCVId)
      .then(setDetailCV)
      .catch(() => setDetailCV(null))
      .finally(() => setDetailLoading(false));
  }, [detailCVId]);

  useEffect(() => {
    if (!detailJDId) {
      setDetailJD(null);
      return;
    }
    setDetailJDLoading(true);
    api
      .getJDDetails(detailJDId)
      .then(setDetailJD)
      .catch(() => setDetailJD(null))
      .finally(() => setDetailJDLoading(false));
  }, [detailJDId]);

  useEffect(() => {
    let cancelled = false;
    api
      .getCategories()
      .then((r) => {
        if (!cancelled) setCategories(r.categories || {});
      })
      .catch(() => {
        if (!cancelled) setCategories({});
      });
    return () => { cancelled = true; };
  }, [cvs.length]);

  /** Facet counts for location / nationality / language (whole DB). */
  useEffect(() => {
    if (view !== 'candidates') return;
    let cancelled = false;
    Promise.all([
      api.getCVSearchFacet('location'),
      api.getCVSearchFacet('nationality'),
      api.getCVSearchFacet('languages'),
    ])
      .then(([loc, nat, lang]) => {
        if (cancelled) return;
        setLocationFacets(loc.values || []);
        setNationalityFacets(nat.values || []);
        setLanguageFacets(lang.values || []);
      })
      .catch(() => {
        if (cancelled) return;
        setLocationFacets([]);
        setNationalityFacets([]);
        setLanguageFacets([]);
      });
    return () => { cancelled = true; };
  }, [view, cvs.length]);

  /** Keep folder loader in sync when exactly one category is checked. */
  useEffect(() => {
    const selected = sidebarFilters.category || [];
    if (selected.length === 1) {
      setActiveFolder(selected[0]);
    } else {
      setActiveFolder(CATEGORY_ALL);
    }
  }, [sidebarFilters.category]);

  /** Server-side filter: the checkboxes (location, nationality, language, two or more categories) and the notes filter. */
  const notesParam: 'with' | 'without' | undefined = notesFilter === 'with_notes' ? 'with' : notesFilter === 'without_notes' ? 'without' : undefined;
  useEffect(() => {
    const locations = sidebarFilters.location || [];
    const nationalities = sidebarFilters.nationality || [];
    const languages = sidebarFilters.language || [];
    const cats = sidebarFilters.category || [];
    // with an advanced search on screen the notes filter is part of that search instead (see below)
    const active = locations.length > 0 || nationalities.length > 0 || languages.length > 0 || cats.length >= 2 || (!!notesParam && !advancedQuery);
    if (!active) {
      geoQueryRef.current = null;
      setGeoFilterCVs(null);
      setGeoCursor(null);
      setGeoTotal(null);
      setGeoFilterLoading(false);
      return;
    }
    const query: CVAdvancedSearchParams = {
      // the filter lists countries; search the locations stored behind the ticked ones
      locations: locations.length ? locations.flatMap((c) => locationFacets.find((f) => f.value === c)?.members || [c]) : undefined,
      nationalities: nationalities.length ? nationalities : undefined,
      languages: languages.length ? languages : undefined,
      categories: cats.length ? cats : undefined,
      notes: advancedQuery ? undefined : notesParam,
      limit: 100,
    };
    geoQueryRef.current = query;
    let cancelled = false;
    setGeoFilterLoading(true);
    (async () => {
      try {
        const res = await api.searchCVsAdvanced({ ...query, cursor: null });
        if (cancelled) return;
        setGeoFilterCVs(res.results || []);
        setGeoCursor(res.next_cursor);
        setGeoTotal(res.total != null ? { count: res.total, estimate: !!res.total_is_estimate } : null);
      } catch {
        if (cancelled) return;
        setGeoFilterCVs([]);
        setGeoCursor(null);
        setGeoTotal({ count: 0, estimate: false });
      } finally {
        if (!cancelled) setGeoFilterLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarFilters.location, sidebarFilters.nationality, sidebarFilters.language, sidebarFilters.category, notesParam, advancedQuery === null]);

  // With an advanced search on screen, a change of the notes filter runs that same search again with the filter added (the server applies it).
  const skipFirstNotes = useRef(true);
  useEffect(() => {
    if (skipFirstNotes.current) {
      skipFirstNotes.current = false;
      return;
    }
    if (!advancedQuery || advancedQuery.notes === notesParam) return;
    void runAdvancedSearch({ ...advancedQuery, notes: notesParam });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesParam]);

  const loadFolderCVPage = async (category: string, offset: number) => {
    setLoadingFolderCVs((s) => ({ ...s, [category]: true }));
    try {
      const res = await api.listCVs({ category, limit: ITEMS_PER_PAGE, offset });
      setFolderCVs((s) => {
        const prev = s[category]?.items ?? [];
        const nextItems = offset === 0 ? res.cvs : [...prev, ...res.cvs];
        const nextTotal = typeof res.total === 'number' ? res.total : (s[category]?.total ?? null);
        return { ...s, [category]: { items: nextItems, total: nextTotal } };
      });
    } catch {
      // swallow here; UI already handles "no candidates" states
    } finally {
      setLoadingFolderCVs((s) => ({ ...s, [category]: false }));
    }
  };

  useEffect(() => {
    if (activeFolder === CATEGORY_ALL) return;
    if ((folderCVs[activeFolder]?.items?.length ?? 0) > 0) return;
    loadFolderCVPage(activeFolder, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder]);

  const isServerSearchMode = !!search.trim();

  // Server-side search across ALL CVs: the first page here, the next pages as the reader scrolls (loadMoreRows)
  useEffect(() => {
    if (!isServerSearchMode) {
      setServerSearchCVs({ items: [], total: null, more: false });
      setServerSearching(false);
      return;
    }

    let cancelled = false;
    setServerSearching(true);
    const t = setTimeout(() => {
      const category = activeFolder === CATEGORY_ALL ? undefined : activeFolder;
      api
        .listCVs({ q: search.trim(), category, limit: ITEMS_PER_PAGE, offset: 0 })
        .then((res) => {
          if (cancelled) return;
          const found = res.cvs ?? [];
          setServerSearchCVs({ items: found, total: typeof res.total === 'number' ? res.total : null, more: found.length >= ITEMS_PER_PAGE });
        })
        .catch(() => {
          if (cancelled) return;
          setServerSearchCVs({ items: [], total: 0, more: false });
        })
        .finally(() => {
          if (cancelled) return;
          setServerSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, activeFolder, isServerSearchMode]);

  const loadMoreSearch = async () => {
    if (loadingMoreSearch || !serverSearchCVs.more) return;
    setLoadingMoreSearch(true);
    setLoadMoreFailed(false);
    try {
      const category = activeFolder === CATEGORY_ALL ? undefined : activeFolder;
      const res = await api.listCVs({ q: search.trim(), category, limit: ITEMS_PER_PAGE, offset: serverSearchCVs.items.length });
      const found = res.cvs ?? [];
      setServerSearchCVs((prev) => ({
        items: [...prev.items, ...found],
        total: typeof res.total === 'number' ? res.total : prev.total,
        more: found.length >= ITEMS_PER_PAGE,
      }));
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMoreSearch(false);
    }
  };

  const filteredCVs = useMemo(() => {
    if (advancedResults) return advancedResults;      // the server applied the search and the notes filter

    if (isServerSearchMode) {
      return serverSearchCVs.items;
    }

    let list: CVListItem[];

    if (geoFilterCVs) {
      list = geoFilterCVs;
    } else if (activeFolder === CATEGORY_ALL) {
      list = cvs;
    } else {
      list = folderCVs[activeFolder]?.items ?? [];
    }

    return list;      // categories, locations, nationalities, languages and notes were applied by the server
  }, [
    cvs,
    activeFolder,
    folderCVs,
    isServerSearchMode,
    serverSearchCVs.items,
    notesFilter,
    notesSummary,
    sidebarFilters.category,
    geoFilterCVs,
    advancedResults,
  ]);

  const runAdvancedSearch = async (query: CVAdvancedSearchParams) => {
    setShowAdvancedSearch(false);
    setAdvancedQuery(query);
    setBooleanEdit(query.boolean_query || '');
    setAdvancedSearching(true);
    setAdvancedError(null);
    setAdvancedResults(null);
    setAdvancedTotal(null);
    setAdvancedCursor(null);
    try {
      // The first page only; the next ones are fetched when the reader reaches the end (see loadMoreFiltered), so every match is reachable.
      const res = await api.searchCVsAdvanced({ ...query, limit: query.limit || 100, cursor: null });
      const found = res.results || [];
      setAdvancedResults(found);
      setAdvancedCursor(res.next_cursor);
      setAdvancedTotal(res.total != null ? { count: res.total, estimate: !!res.total_is_estimate } : { count: found.length, estimate: false });
    } catch (e: any) {
      setAdvancedResults([]);
      setAdvancedTotal({ count: 0, estimate: false });
      setAdvancedError(
        (typeof e?.detail === 'string' && e.detail) ||
          (typeof e?.message === 'string' && e.message) ||
          'Search failed',
      );
    } finally {
      setAdvancedSearching(false);
    }
  };

  const rerunBooleanFromTop = () => {
    const text = booleanEdit.trim();
    if (!text) return;
    const base = advancedQuery || {};
    void runAdvancedSearch({
      ...base,
      keywords: undefined,
      boolean_query: text,
      limit: base.limit || 100,
    });
  };

  const clearAdvancedSearch = () => {
    setAdvancedResults(null);
    setAdvancedCursor(null);
    setAdvancedTotal(null);
    setAdvancedError(null);
    setAdvancedSearching(false);
    setAdvancedQuery(null);
    setBooleanEdit('');
  };

  // Typing in the search box on the job descriptions tab asks the server, which searches every JD (not only the ones loaded so far).
  useEffect(() => {
    const q = search.trim();
    if (view !== 'jobs' || !q) {
      setServerJDs(null);
      setJdSearchMore(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .listJDs({ q, limit: 200, offset: 0 })
        .then((res) => {
          if (cancelled) return;
          setServerJDs(res.jds ?? []);
          setJdSearchMore((res.jds ?? []).length >= 200);
        })
        .catch(() => { if (!cancelled) { setServerJDs([]); setJdSearchMore(false); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, view]);

  const loadMoreJDSearch = async () => {
    if (loadingMoreJDs || !jdSearchMore || !serverJDs) return;
    setLoadingMoreJDs(true);
    try {
      const res = await api.listJDs({ q: search.trim(), limit: 200, offset: serverJDs.length });
      const found = res.jds ?? [];
      setServerJDs((prev) => [...(prev ?? []), ...found]);
      setJdSearchMore(found.length >= 200);
    } catch {
      setJdSearchMore(false);
    } finally {
      setLoadingMoreJDs(false);
    }
  };

  const filteredJDs = useMemo(() => {
    if (!search.trim()) return jds;
    if (serverJDs) return serverJDs;
    const q = search.toLowerCase();       // until the server answers
    return jds.filter(
      (jd) =>
        jd.job_title?.toLowerCase().includes(q) ||
        jd.filename?.toLowerCase().includes(q) ||
        jd.id.toLowerCase().includes(q)
    );
  }, [jds, search, serverJDs]);

  const activeTotalCount =
    isServerSearchMode
      ? serverSearchCVs.total
      : activeFolder === CATEGORY_ALL
        ? totalCVs
        : (categories[activeFolder] ?? folderCVs[activeFolder]?.total ?? null);

  const activeLoadedCount =
    isServerSearchMode
      ? serverSearchCVs.items.length
      : activeFolder === CATEGORY_ALL
        ? cvs.length
        : (folderCVs[activeFolder]?.items?.length ?? 0);

  // Every mode shows ALL the rows loaded so far; the next page is fetched when the reader scrolls to the end of the list.
  const filteredTotal = advancedResults
    ? (advancedTotal?.count ?? advancedResults.length)
    : geoFilterCVs
      ? (geoTotal?.count ?? geoFilterCVs.length)
      : null;
  const moreOnServer = advancedResults ? !!advancedCursor : geoFilterCVs ? !!geoCursor : false;
  const filteredIsEstimate = advancedResults ? !!advancedTotal?.estimate : geoFilterCVs ? !!geoTotal?.estimate : false;
  const totalItemsForPaging = isServerSearchMode
    ? Math.max(serverSearchCVs.total ?? 0, serverSearchCVs.items.length)
    : filteredTotal != null
      ? Math.max(filteredTotal, filteredCVs.length)
      : (activeTotalCount ?? filteredCVs.length);
  const pagedTotalLabel = totalItemsForPaging.toLocaleString() + (filteredIsEstimate ? '+' : '');
  const paginatedCVs = filteredCVs;
  const allOnPageSelected = paginatedCVs.length > 0 && paginatedCVs.every((cv) => selectedCVs.includes(cv.id));

  // Instant restore before paint — list should appear already at the saved spot.
  useLayoutEffect(() => {
    if (view !== 'candidates' || paginatedCVs.length === 0) return;
    return restoreScroll(SCROLL_KEYS.candidates) || undefined;
  }, [view, paginatedCVs.length]);

  const toggleCV = (id: string) => {
    if (selectedCVs.includes(id)) deselectCV(id);
    else selectCV(id);
  };

  const selectAllInFolder = () => {
    if (allOnPageSelected) {
      paginatedCVs.forEach((cv) => deselectCV(cv.id));
    } else {
      paginatedCVs.forEach((cv) => {
        if (!selectedCVs.includes(cv.id)) selectCV(cv.id);
      });
    }
  };

  const loadMoreActiveFolder = async () => {
    if (activeFolder === CATEGORY_ALL) return loadMoreCVs();
    return loadFolderCVPage(activeFolder, activeLoadedCount);
  };

  const loadMoreFiltered = async () => {
    if (loadingMoreFiltered) return;
    setLoadingMoreFiltered(true);
    try {
      if (advancedResults && advancedCursor && advancedQuery) {
        const res = await api.searchCVsAdvanced({ ...advancedQuery, limit: advancedQuery.limit || 100, cursor: advancedCursor });
        setAdvancedResults((prev) => [...(prev || []), ...(res.results || [])]);
        setAdvancedCursor(res.next_cursor);
      } else if (!advancedResults && geoFilterCVs && geoCursor && geoQueryRef.current) {
        const res = await api.searchCVsAdvanced({ ...geoQueryRef.current, cursor: geoCursor });
        setGeoFilterCVs((prev) => [...(prev || []), ...(res.results || [])]);
        setGeoCursor(res.next_cursor);
      }
    } catch {
      // keep what is loaded; the reader can press Next again
    } finally {
      setLoadingMoreFiltered(false);
    }
  };

  const hasMoreRows = isServerSearchMode
    ? serverSearchCVs.more
    : advancedResults || geoFilterCVs
      ? moreOnServer
      : activeTotalCount != null && activeLoadedCount < activeTotalCount;
  const loadingMoreRows = isServerSearchMode
    ? loadingMoreSearch || serverSearching
    : advancedResults || geoFilterCVs
      ? loadingMoreFiltered || advancedSearching || geoFilterLoading
      : !!loadingFolderCVs[activeFolder] || loadingStates.cvs.isLoading;
  const loadMoreRows = async () => {
    if (isServerSearchMode) return loadMoreSearch();
    if (advancedResults || geoFilterCVs) return loadMoreFiltered();
    return loadMoreActiveFolder();
  };

  const openPreview = (id: string, type: 'cv' | 'jd', name: string, item?: CVListItem | JDListItem) => {
    const rawName = item?.filename || name;
    void handlePreviewFile(id, type, rawName);
  };

  const syncNotesSummaryForCv = (cvId: string, notes: any[]) => {
    const list = Array.isArray(notes) ? notes : [];
    if (list.length === 0) {
      setNotesSummary((prev) => {
        const next = { ...prev };
        delete next[cvId];
        return next;
      });
      return;
    }
    const latest = [...list].sort((a, b) =>
      String(b?.updated_at || b?.created_at || '').localeCompare(String(a?.updated_at || a?.created_at || '')),
    )[0];
    const text = typeof latest?.note === 'string' ? latest.note : null;
    const author = typeof latest?.hr_user === 'string' ? latest.hr_user : null;
    setNotesSummary((prev) => ({ ...prev, [cvId]: { count: list.length, text, author } }));
  };

  const handleCardSaveNote = async (cvId: string, text: string) => {
    if (!user?.username || !text.trim()) return;
    setCardNoteSavingId(cvId);
    try {
      await api.addOrUpdateNote(cvId, text.trim(), user.username);
      const res = await api.getCVNotes(cvId);
      syncNotesSummaryForCv(cvId, res.notes || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCardNoteSavingId(null);
    }
  };

  const handleCardDeleteNote = async (cvId: string, hrUser?: string | null) => {
    const author = hrUser || user?.username;
    if (!author) return;
    setCardNoteSavingId(cvId);
    try {
      await api.deleteCVNote(cvId, author);
      const res = await api.getCVNotes(cvId);
      syncNotesSummaryForCv(cvId, res.notes || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCardNoteSavingId(null);
    }
  };

  const handleDeleteCV = async (id: string) => {
    if (!window.confirm('Delete this CV? This cannot be undone.')) return;
    await deleteCV(id);
  };

  const handleDeleteJD = async (id: string) => {
    if (!window.confirm('Delete this job description? This cannot be undone.')) return;
    await deleteJD(id);
  };

  const folderList = useMemo(() => {
    const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    return entries;
  }, [categories]);

  const filterGroups: FilterGroupDef[] = useMemo(() => {
    const categoryOptions = folderList.map(([value, count]) => ({
      value,
      label: value,
      count,
    }));
    return [
      { key: 'category', label: 'Category', options: categoryOptions },
      {
        key: 'location',
        label: 'Country',
        options: locationFacets.map((f) => ({ value: f.value, label: f.value, count: f.count })),
      },
      {
        key: 'nationality',
        label: 'Nationality',
        options: nationalityFacets.map((f) => ({ value: f.value, label: f.value, count: f.count })),
      },
      {
        key: 'language',
        label: 'Language',
        options: languageFacets.map((f) => ({ value: f.value, label: f.value, count: f.count })),
      },
    ];
  }, [folderList, locationFacets, nationalityFacets, languageFacets]);

  const toggleSidebarFilter = (groupKey: string, value: string) => {
    setSidebarFilters((prev) => {
      const current = prev[groupKey] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [groupKey]: next };
    });
  };

  const clearSidebarFilters = () => {
    setSidebarFilters({ category: [], location: [], nationality: [], language: [] });
  };

  const cvCount = totalCVs ?? cvs.length;
  const jdCount = totalJDs ?? jds.length;
  const cvLoading =
    advancedSearching ||
    ((loadingStates.cvs.isLoading || loadingFolderCVs[activeFolder] || geoFilterLoading) &&
      paginatedCVs.length === 0 &&
      !advancedResults);
  const jdLoading = loadingStates.jds.isLoading && jds.length === 0;

  const renderCandidateCard = (cv: CVListItem, index: number) => {
    const d = getCVDisplay(cv);
    const noteMeta = notesSummary[cv.id];
    return (
      <CandidateCard
        key={cv.id}
        cv={cv}
        display={d}
        index={index}
        selected={selectedCVs.includes(cv.id)}
        matchedKeywords={cv.matched_keywords || []}
        noteText={noteMeta?.text || null}
        noteAuthor={noteMeta?.author || null}
        noteSaving={cardNoteSavingId === cv.id}
        onToggleSelect={() => toggleCV(cv.id)}
        onOpenDetails={() => {
          saveScroll(SCROLL_KEYS.candidates, cv.id);
          router.push(`/candidates/${cv.id}`);
        }}
        onPreview={() => openPreview(cv.id, 'cv', d.name, cv)}
        onDelete={() => handleDeleteCV(cv.id)}
        saved={canSave ? savedIds.includes(cv.id) : undefined}
        onToggleSave={canSave ? () => toggleSaved(cv.id) : undefined}
        onSaveNote={(text) => handleCardSaveNote(cv.id, text)}
        onDeleteNote={() => handleCardDeleteNote(cv.id, noteMeta?.author)}
      />
    );
  };

  const renderCandidatesBody = () => {
    if (advancedSearching) {
      return (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
            <div className="px-5 pb-3 pt-4">
              <p className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
                Searching {cvCount > 0 ? `${cvCount.toLocaleString()} CVs` : 'your CVs'}
              </p>
              <p className="mt-0.5 text-[12.5px] text-slate-500">Checking every CV against your search. Matches appear here as soon as they are found.</p>
            </div>
            <div className="search-track"><div className="search-bar" /></div>
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="search-sheen relative flex gap-3.5 overflow-hidden rounded-2xl border border-surface-border bg-white p-5" style={{ animationDelay: `${i * 140}ms` }}>
              <div className="h-12 w-12 shrink-0 rounded-full bg-slate-100" />
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="h-3.5 w-1/3 rounded bg-slate-100" />
                <div className="h-3 w-1/2 rounded bg-slate-100" />
                <div className="flex gap-2 pt-1">
                  <div className="h-5 w-16 rounded-full bg-slate-100" />
                  <div className="h-5 w-20 rounded-full bg-slate-100" />
                  <div className="h-5 w-14 rounded-full bg-slate-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (cvLoading) {
      return <CandidatesListSkeleton />;
    }

    if (filteredCVs.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title={
            advancedResults
              ? 'No candidates match this search'
              : search
              ? 'No candidates match your search'
              : (sidebarFilters.category?.length || sidebarFilters.location?.length || sidebarFilters.nationality?.length || sidebarFilters.language?.length)
                ? 'No candidates match these filters'
                : 'No CVs yet'
          }
          hint={
            !search &&
            !(sidebarFilters.category?.length || sidebarFilters.location?.length || sidebarFilters.nationality?.length || sidebarFilters.language?.length)
              ? 'Upload CVs from the Upload tab to build your database.'
              : undefined
          }
        />
      );
    }

    return (
      <>
        <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-[13px] font-medium text-slate-700">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={selectAllInFolder}
              className="h-4 w-4 cursor-pointer rounded accent-navy-600"
              aria-label="Select all loaded candidates"
            />
            {allOnPageSelected ? 'Deselect all loaded' : 'Select all loaded'}
          </label>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="tabular-nums">
              {paginatedCVs.length.toLocaleString()} of {pagedTotalLabel}
            </span>
            {selectedCVs.length > 0 && canSave && (
              <button type="button" onClick={() => void saveSelected()} className="font-semibold text-navy-600 hover:underline">
                Save {selectedCVs.length} selected
              </button>
            )}
            {selectedCVs.length > 0 && (
              <button type="button" onClick={() => deselectAllCVs()} className="font-semibold text-navy-600 hover:underline">
                Clear {selectedCVs.length} selected
              </button>
            )}
            {saveNotice && <span className="font-medium text-emerald-700" role="status">{saveNotice}</span>}
          </div>
        </div>

        <div className="space-y-2.5">
          {paginatedCVs.map((cv, i) => renderCandidateCard(cv, i))}
        </div>

        <InfiniteScrollSentinel
          hasMore={hasMoreRows}
          loading={loadingMoreRows}
          error={loadMoreFailed}
          itemCount={paginatedCVs.length}
          onLoadMore={() => { setLoadMoreFailed(false); return loadMoreRows(); }}
        />
      </>
    );
  };

  const pageTitle = 'Talent database';

  const viewTabs = [
    { id: 'candidates' as const, label: 'Candidates', icon: Users, count: cvCount },
    { id: 'jobs' as const, label: 'Job descriptions', icon: FileText, count: jdCount },
  ];

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <PageHeader
        title={pageTitle}
        description={
          view === 'candidates'
            ? 'Select candidates, then pick a job description to match them against.'
            : 'Pick the job description to match your selected candidates against.'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => { loadCVs(); loadJDs(); }} icon={<RefreshCw />}>
              Refresh
            </Button>
            {view === 'candidates' && (
              <>
                <Button variant="secondary" icon={<Code2 />} onClick={() => { setSearchModalMode('boolean'); setShowAdvancedSearch(true); }}>
                  Boolean search
                </Button>
                <Button variant="secondary" icon={<SlidersHorizontal />} onClick={() => { setSearchModalMode('keywords'); setShowAdvancedSearch(true); }}>
                  Advanced search
                </Button>
              </>
            )}
            <Button variant="primary" icon={<Upload />} onClick={() => go('upload')}>
              Upload
            </Button>
          </>
        }
      />

      {/* Switch between the two halves of a match */}
      <div className="mb-4 flex items-center gap-1 border-b border-surface-border">
        {viewTabs.map((t) => {
          const active = view === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (lockedView) go(t.id);
                else { setView(t.id); }
              }}
              className={`relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-semibold transition-colors ${
                active ? 'border-navy-600 text-navy-700' : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              <span className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${active ? 'bg-navy-50 text-navy-700' : 'bg-slate-100 text-slate-500'}`}>
                {t.count.toLocaleString()}
              </span>
              {t.id === 'candidates' && selectedCVs.length > 0 && (
                <span className="rounded-full bg-navy-600 px-2 py-0.5 text-[11px] text-white tabular-nums">{selectedCVs.length} selected</span>
              )}
              {t.id === 'jobs' && selectedJD && (
                <span className="rounded-full bg-navy-600 px-2 py-0.5 text-[11px] text-white">1 selected</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="toolbar-bar">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={view === 'candidates' ? 'Search candidates by name, title, skill…' : 'Search job descriptions…'}
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="h-9 w-full rounded-lg border border-transparent bg-slate-50 pl-9 pr-9 text-[13px] text-slate-900 placeholder:text-slate-400 transition-colors hover:bg-slate-100/70 focus:border-navy-500 focus:bg-white focus:outline-none focus:shadow-glow"
          />
          {view === 'candidates' && serverSearching && search.trim() ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
          ) : null}
        </div>

        {view === 'candidates' && (
          <>
            <Segmented
              size="sm"
              value={notesFilter}
              onChange={(v) => { setNotesFilter(v); }}
              items={[
                { value: 'all', label: 'All' },
                { value: 'with_notes', label: 'With notes' },
                { value: 'without_notes', label: 'No notes' },
              ]}
            />

          </>
        )}
      </div>

      {view === 'candidates' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 px-1">
          <span className="text-[13px] font-medium text-slate-700 tabular-nums">
            {pagedTotalLabel} candidates
          </span>
          {Object.entries(sidebarFilters).flatMap(([group, vals]) =>
            (vals || []).map((v) => (
              <button
                key={`${group}:${v}`}
                type="button"
                onClick={() => toggleSidebarFilter(group, v)}
                className="inline-flex items-center gap-1 rounded-md bg-navy-50 px-2 py-0.5 text-[11.5px] font-medium text-navy-700 hover:bg-navy-100"
                title="Remove filter"
              >
                {group[0].toUpperCase() + group.slice(1)}: {v} <X className="h-3 w-3" />
              </button>
            )),
          )}
        </div>
      )}

      {showAdvancedSearch && (
        <AdvancedSearchModal
          initialMode={searchModalMode}
          onClose={() => setShowAdvancedSearch(false)}
          onSubmit={(query) => {
            void runAdvancedSearch(query);
          }}
        />
      )}

      {view === 'candidates' && (advancedResults || advancedError) && !advancedSearching && (
        <div className="mb-4 space-y-3 rounded-xl border border-navy-100 bg-navy-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-navy-900">
                {advancedError
                  ? 'Search failed'
                  : `Showing ${filteredCVs.length.toLocaleString()} match${filteredCVs.length === 1 ? '' : 'es'}${
                      advancedTotal
                        ? ` · ${advancedTotal.estimate ? 'up to ' : ''}${advancedTotal.count.toLocaleString()} in database`
                        : ''
                    }`}
              </p>
              <p className="mt-0.5 text-[12px] text-navy-700/80">
                {advancedError || 'Edit the boolean string below and search again, or clear to return to all candidates.'}
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={clearAdvancedSearch}>
              Clear search
            </Button>
          </div>

          {(Boolean(advancedQuery?.boolean_query) || booleanEdit.trim().length > 0) && (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-700">
                Boolean string
              </label>
              <textarea
                value={booleanEdit}
                onChange={(e) => setBooleanEdit(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    rerunBooleanFromTop();
                  }
                }}
                rows={3}
                spellCheck={false}
                placeholder={'("Cloud Engineer") AND ("Azure" OR "Terraform") NOT intern'}
                className="field-input w-full resize-y bg-white font-mono text-[12px] leading-relaxed"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={<Search className="h-3.5 w-3.5" />}
                  onClick={rerunBooleanFromTop}
                  disabled={!booleanEdit.trim()}
                >
                  Search again
                </Button>
                <span className="text-[11px] text-navy-600/70">Ctrl+Enter to search</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* JD sidebar selector hint + content */}
      {view === 'jobs' ? (
        jdLoading ? (
          <JobsTableSkeleton />
        ) : filteredJDs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={search ? 'No job descriptions match your search' : 'No job descriptions yet'}
            hint="Upload JDs from the Upload tab to start matching candidates."
          />
        ) : (
          <>
            <div className="space-y-2.5">
              {filteredJDs.map((jd, jdIndex) => {
                const d = getJDDisplay(jd);
                const isSelected = selectedJD === jd.id;
                return (
                  <JobCard
                    key={jd.id}
                    display={d}
                    index={jdIndex + 1}
                    selected={isSelected}
                    showLinkedIn={canUseAgents(user?.role)}
                    onSelect={() => selectJD(isSelected ? null : jd.id)}
                    onOpenDetails={() => setDetailJDId(jd.id)}
                    onPreview={() => openPreview(jd.id, 'jd', d.title, jd)}
                    onDelete={() => handleDeleteJD(jd.id)}
                    onLinkedIn={() => router.push(linkedinHref({ jdId: jd.id, jdTitle: d.title }))}
                  />
                );
              })}
            </div>
            <InfiniteScrollSentinel
              hasMore={search.trim() ? jdSearchMore : totalJDs != null && jds.length < totalJDs}
              loading={search.trim() ? loadingMoreJDs : loadingStates.jds.isLoading}
              itemCount={filteredJDs.length}
              onLoadMore={search.trim() ? loadMoreJDSearch : () => loadMoreJDs()}
            />
          </>
        )
      ) : (
        <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start">
          <FilterSidebar
            groups={filterGroups}
            selected={sidebarFilters}
            onToggle={toggleSidebarFilter}
            onClearAll={clearSidebarFilters}
            className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
          />
          <div className="min-w-0 flex-1">{renderCandidatesBody()}</div>
        </div>
      )}

      {/* Detail panel: full CV + notes + View PDF */}
      {detailCVId && (
        <>
          <div
            className="fixed inset-0 z-[998] bg-slate-900/40"
            onClick={() => setDetailCVId(null)}
            aria-hidden
          />
          <div
            className="fixed inset-y-0 right-0 z-[999] flex w-full flex-col border-l border-surface-border bg-white shadow-xl sm:w-[var(--detail-w)]"
            style={{ ['--detail-w' as string]: `${detailWidth}px` }}
          >
            <button
              type="button"
              aria-label="Drag to widen details"
              title="Drag to see more"
              onPointerDown={onDetailDragStart}
              className="absolute -left-3 top-1/2 z-10 hidden h-11 w-6 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-md border border-surface-border bg-white shadow-sm hover:border-navy-400 sm:flex"
            >
              <GripVertical className="h-4 w-4 text-slate-400" />
            </button>
            <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Candidate details</h2>
              <button
                type="button"
                onClick={() => setDetailCVId(null)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">
              {detailLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-[13px] text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading details...
                </div>
              ) : detailCV ? (
                <>
                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <div className="flex items-center gap-3">
                      <Avatar name={detailCV.candidate?.full_name || detailCV.structured_info?.full_name} size="lg" />
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-semibold text-slate-900">
                          {detailCV.candidate?.full_name || detailCV.structured_info?.full_name || 'Unknown'}
                        </h3>
                        <p className="truncate text-[13px] text-slate-500">
                          {detailCV.candidate?.job_title || detailCV.structured_info?.job_title || '-'}
                        </p>
                      </div>
                    </div>
                    {(() => {
                      const email =
                        detailCV.job_application?.applicant_email ||
                        detailCV.structured_info?.contact_info?.email ||
                        detailCV.structured_info?.email ||
                        detailCV.candidate?.contact_info?.email ||
                        null;
                      const phone =
                        detailCV.job_application?.applicant_phone ||
                        detailCV.structured_info?.contact_info?.phone ||
                        detailCV.structured_info?.phone ||
                        detailCV.candidate?.contact_info?.phone ||
                        null;
                      const linkedin = detailCV.candidate?.linkedin_url || detailCV.structured_info?.linkedin_url || detailCV.structured_info?.contact_info?.linkedin || null;
                      const github = detailCV.candidate?.github_url || detailCV.structured_info?.github_url || detailCV.structured_info?.contact_info?.github || null;
                      if (!email && !phone && !linkedin && !github) return null;
                      return (
                        <ContactActions
                          email={email}
                          phone={phone}
                          linkedin={linkedin}
                          github={github}
                          className="mt-2"
                        />
                      );
                    })()}
                    <dl className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <dt className="section-label">Experience</dt>
                        <dd className="mt-0.5 text-[13px] text-slate-900">
                          {detailCV.candidate?.years_of_experience ?? detailCV.structured_info?.years_of_experience ?? '-'} years
                        </dd>
                      </div>
                      <div>
                        <dt className="section-label">Skills</dt>
                        <dd className="mt-0.5 text-[13px] text-slate-900">
                          {(detailCV.candidate?.skills || detailCV.structured_info?.skills_sentences || []).length}
                        </dd>
                      </div>
                      <div>
                        <dt className="section-label">Category</dt>
                        <dd className="mt-0.5 text-[13px] text-slate-900">{detailCV.structured_info?.category ?? 'General'}</dd>
                      </div>
                      {(detailCV.candidate?.gender || detailCV.structured_info?.gender) ? (
                        <div>
                          <dt className="section-label">Gender</dt>
                          <dd className="mt-0.5 text-[13px] text-slate-900">
                            {detailCV.candidate?.gender || detailCV.structured_info?.gender}
                          </dd>
                        </div>
                      ) : null}
                      {(() => {
                        const langs = detailCV.candidate?.languages || detailCV.structured_info?.languages || [];
                        if (!Array.isArray(langs) || langs.length === 0) return null;
                        return (
                          <div>
                            <dt className="section-label">Languages</dt>
                            <dd className="mt-0.5 text-[13px] text-slate-900">{langs.join(', ')}</dd>
                          </div>
                        );
                      })()}
                      {(() => {
                        const certs = detailCV.candidate?.certifications || detailCV.structured_info?.certifications || [];
                        if (!Array.isArray(certs) || certs.length === 0) return null;
                        return (
                          <div className="col-span-full">
                            <dt className="section-label">Certifications</dt>
                            <dd className="mt-1 flex flex-wrap gap-1.5">
                              {certs.map((c: string) => (
                                <span key={c} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[12px] font-medium text-amber-900">{c}</span>
                              ))}
                            </dd>
                          </div>
                        );
                      })()}
                      {(() => {
                        const es = detailCV.job_application?.expected_salary ||
                                   detailCV.candidate?.expected_salary ||
                                   detailCV.structured_info?.expected_salary;
                        return es ? (
                          <div>
                            <dt className="section-label">Expected salary</dt>
                            <dd className="mt-0.5 text-[13px] font-medium text-green-600">{es}</dd>
                          </div>
                        ) : null;
                      })()}
                    </dl>
                  </div>

                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Skills</h4>
                    {(() => {
                      const skills = (detailCV.candidate?.skills || detailCV.structured_info?.skills_sentences || [])
                        .filter(Boolean)
                        .slice(0, 20);
                      if (!skills.length) {
                        return <p className="text-[13px] text-slate-400">No skills extracted.</p>;
                      }
                      return (
                        <ol className="space-y-2">
                          {skills.map((s: string, i: number) => (
                            <li key={i} className="flex gap-2.5 text-[13px] text-slate-700">
                              <span className="w-6 shrink-0 tabular-nums text-[12px] font-semibold text-navy-600">{i + 1}.</span>
                              <span className="min-w-0 whitespace-pre-wrap break-words leading-relaxed">{s}</span>
                            </li>
                          ))}
                        </ol>
                      );
                    })()}
                  </div>

                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Responsibilities</h4>
                    {(() => {
                      const resps = (detailCV.candidate?.responsibilities || detailCV.structured_info?.responsibility_sentences || [])
                        .filter(Boolean)
                        .slice(0, 20);
                      if (!resps.length) {
                        return <p className="text-[13px] text-slate-400">No responsibilities extracted.</p>;
                      }
                      return (
                        <ol className="space-y-2">
                          {resps.map((r: string, i: number) => (
                            <li key={i} className="flex gap-2.5 text-[13px] text-slate-700">
                              <span className="w-6 shrink-0 tabular-nums text-[12px] font-semibold text-navy-600">{i + 1}.</span>
                              <span className="min-w-0 whitespace-pre-wrap break-words leading-relaxed">{r}</span>
                            </li>
                          ))}
                        </ol>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">Failed to load details.</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* JD detail panel */}
      {detailJDId && (
        <>
          <div
            className="fixed inset-0 z-[998] bg-slate-900/40"
            onClick={() => setDetailJDId(null)}
            aria-hidden
          />
          <div
            className="fixed inset-y-0 right-0 z-[999] flex w-full flex-col border-l border-surface-border bg-white shadow-xl sm:w-[var(--detail-w)]"
            style={{ ['--detail-w' as string]: `${detailWidth}px` }}
          >
            <button
              type="button"
              aria-label="Drag to widen details"
              title="Drag to see more"
              onPointerDown={onDetailDragStart}
              className="absolute -left-3 top-1/2 z-10 hidden h-11 w-6 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-md border border-surface-border bg-white shadow-sm hover:border-navy-400 sm:flex"
            >
              <GripVertical className="h-4 w-4 text-slate-400" />
            </button>
            <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Job description details</h2>
              <button
                type="button"
                onClick={() => setDetailJDId(null)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">
              {detailJDLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-[13px] text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading JD...
                </div>
              ) : detailJD ? (
                <>
                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {detailJD.job_requirements?.job_title || detailJD.structured_info?.job_title || detailJD.filename || 'Untitled'}
                    </h3>
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {detailJD.job_requirements?.years_of_experience ?? detailJD.structured_info?.years_of_experience ?? '-'} years experience required
                    </p>
                  </div>

                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                      <Code className="h-4 w-4 text-slate-400" /> Skills
                    </h4>
                    {(() => {
                      const skills = (
                        detailJD.job_requirements?.skills ||
                        detailJD.structured_info?.skills_sentences ||
                        detailJD.structured_info?.skills ||
                        detailJD.job_requirements?.skill_keywords ||
                        []
                      )
                        .filter(Boolean)
                        .slice(0, 20);
                      if (!skills.length) {
                        return <p className="text-[13px] text-slate-400">No skills extracted for this JD.</p>;
                      }
                      return (
                        <ol className="space-y-2">
                          {skills.map((s: string, i: number) => (
                            <li key={i} className="flex gap-2.5 text-[13px] text-slate-700">
                              <span className="w-6 shrink-0 tabular-nums text-[12px] font-semibold text-navy-600">{i + 1}.</span>
                              <span className="min-w-0 whitespace-pre-wrap break-words leading-relaxed">{s}</span>
                            </li>
                          ))}
                        </ol>
                      );
                    })()}
                  </div>

                  {/* Naukri Gulf boolean search string, copy straight into a job-portal search box. */}
                  {(detailJD.job_requirements?.boolean_search_string || detailJD.boolean_search_string) && (
                    <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                          <Search className="h-4 w-4 text-slate-400" /> Boolean search string
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            const value = detailJD.job_requirements?.boolean_search_string || detailJD.boolean_search_string || '';
                            navigator.clipboard?.writeText(value);
                            setBooleanCopied(true);
                            setTimeout(() => setBooleanCopied(false), 2000);
                          }}
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-surface-border bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-600"
                        >
                          {booleanCopied ? (
                            <>
                              <Check className="h-3 w-3 text-green-600" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                      <p className="mb-1 text-[11px] text-slate-400">
                        Paste into Naukri Gulf (or any job portal) candidate search.
                      </p>
                      <pre className="whitespace-pre-wrap break-words rounded-md border border-surface-border bg-slate-50 p-2.5 font-mono text-[11.5px] leading-relaxed text-slate-700">
                        {detailJD.job_requirements?.boolean_search_string || detailJD.boolean_search_string}
                      </pre>
                    </div>
                  )}
                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Responsibilities</h4>
                    {(() => {
                      const resps = (
                        detailJD.job_requirements?.responsibilities ||
                        detailJD.structured_info?.responsibility_sentences ||
                        detailJD.structured_info?.responsibilities ||
                        []
                      )
                        .filter(Boolean)
                        .slice(0, 20);
                      if (!resps.length) {
                        return <p className="text-[13px] text-slate-400">No responsibilities extracted.</p>;
                      }
                      return (
                        <ol className="space-y-2">
                          {resps.map((r: string, i: number) => (
                            <li key={i} className="flex gap-2.5 text-[13px] text-slate-700">
                              <span className="w-6 shrink-0 tabular-nums text-[12px] font-semibold text-navy-600">{i + 1}.</span>
                              <span className="min-w-0 whitespace-pre-wrap break-words leading-relaxed">{r}</span>
                            </li>
                          ))}
                        </ol>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">Failed to load JD.</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Document preview, same flow as the Matching page. */}
      {previewData.isOpen && (previewLoading || previewLoadError) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-surface-border bg-white p-6 shadow-xl">
            {previewLoadError ? (
              <>
                <p className="text-[13px] text-red-600">{previewLoadError}</p>
                <Button onClick={closePreview} variant="secondary">Close</Button>
              </>
            ) : (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
                <p className="text-[13px] text-slate-700">Loading document…</p>
              </>
            )}
          </div>
        </div>
      ) : null}
      <FilePreviewModal
        isOpen={previewData.isOpen && !previewLoading && !previewLoadError && !!previewBlobUrl}
        onClose={closePreview}
        fileUrl={previewData.url}
        fileName={previewData.name}
        fileId={previewData.id}
        docType={previewData.type === 'jd' ? 'jd' : 'cv'}
      />


    </div>
  );
}
