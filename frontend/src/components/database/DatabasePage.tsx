'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  Users,
  FileText,
  RefreshCw,
  Search,
  Target,
  Eye,
  Loader2,
  Trash2,
  MessageSquare,
  X,
  Code2,
  Save,
  FileText as FileTextIcon,
  GripVertical,
  Upload,
  Copy,
  Check,
  Code,
  SlidersHorizontal,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { Segmented } from '@/components/ui/segmented';
import { Avatar } from '@/components/ui/avatar';
import { CVListItem, JDListItem } from '@/lib/types';
import { CandidatesListSkeleton, JobsTableSkeleton } from '@/components/skeletons';
import AdvancedSearchModal from '@/components/database/AdvancedSearchModal';
import ContactActions from '@/components/common/ContactActions';
import CandidateCard from '@/components/database/CandidateCard';
import FilterSidebar, { type FilterGroupDef } from '@/components/common/FilterSidebar';

const FilePreviewModal = dynamic(
  () => import('@/components/ui/file-preview-modal').then((mod) => mod.FilePreviewModal),
  { ssr: false }
);

const ITEMS_PER_PAGE = 200;   // same as the API page size (200 per call)
const CATEGORY_ALL = '__all__';

function getCVDisplay(cv: CVListItem) {
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
    gender: cv.gender || null,
    languages,
    location: cv.location || null,
    nationality: cv.nationality || null,
  };
}

function getJDDisplay(jd: JDListItem) {
  return {
    title: jd.job_title || jd.filename || 'Untitled',
    skillsCount: jd.skills_count ?? 0,
    skillKeywords: (jd.skill_keywords && jd.skill_keywords.length > 0)
      ? jd.skill_keywords
      : (jd.skills || []).slice(0, 12),
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

  const [search, setSearch] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [searchModalMode, setSearchModalMode] = useState<'keywords' | 'boolean'>('keywords');
  const [activeFolder, setActiveFolder] = useState<string>(CATEGORY_ALL);
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [folderCVs, setFolderCVs] = useState<Record<string, { items: CVListItem[]; total: number | null }>>({});
  const [loadingFolderCVs, setLoadingFolderCVs] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
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
  const [notesSummary, setNotesSummary] = useState<Record<string, number>>({});
  const [detailCV, setDetailCV] = useState<any>(null);
  const [detailNotes, setDetailNotes] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
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
  const [serverSearchCVs, setServerSearchCVs] = useState<{ items: CVListItem[]; total: number | null }>({
    items: [],
    total: null,
  });
  const [serverSearching, setServerSearching] = useState(false);
  /** Left filter rail: multi-select facets */
  const [sidebarFilters, setSidebarFilters] = useState<Record<string, string[]>>({
    category: [],
    location: [],
    nationality: [],
  });
  const [locationFacets, setLocationFacets] = useState<{ value: string; count: number }[]>([]);
  const [nationalityFacets, setNationalityFacets] = useState<{ value: string; count: number }[]>([]);
  const [geoFilterCVs, setGeoFilterCVs] = useState<CVListItem[] | null>(null);
  const [geoFilterLoading, setGeoFilterLoading] = useState(false);

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
    if (cvs.length === 0) return;
    const ids = cvs.map((c) => c.id).filter(Boolean);
    if (ids.length === 0) return;
    api.getNotesSummary(ids).then((r) => {
      const next: Record<string, number> = {};
      (r.summaries || []).forEach((s: any) => {
        if (s.cv_id && (s.notes_count || 0) > 0) next[s.cv_id] = s.notes_count;
      });
      setNotesSummary(next);
    }).catch(() => { });
  }, [cvs]);

  useEffect(() => {
    if (!detailCVId) {
      setDetailCV(null);
      setDetailNotes([]);
      return;
    }
    setDetailLoading(true);
    Promise.all([
      api.getCVDetails(detailCVId),
      api.getCVNotes(detailCVId),
    ]).then(([cvRes, notesRes]) => {
      setDetailCV(cvRes);
      setDetailNotes(notesRes.notes || []);
    }).catch(() => {
      setDetailCV(null);
      setDetailNotes([]);
    }).finally(() => setDetailLoading(false));
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

  /** Facet counts for location / nationality (whole DB). */
  useEffect(() => {
    if (view !== 'candidates') return;
    let cancelled = false;
    Promise.all([
      api.getCVSearchFacet('location'),
      api.getCVSearchFacet('nationality'),
    ])
      .then(([loc, nat]) => {
        if (cancelled) return;
        setLocationFacets(loc.values || []);
        setNationalityFacets(nat.values || []);
      })
      .catch(() => {
        if (cancelled) return;
        setLocationFacets([]);
        setNationalityFacets([]);
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

  /** Server-side geo filter when location/nationality checkboxes are used. */
  useEffect(() => {
    const locations = sidebarFilters.location || [];
    const nationalities = sidebarFilters.nationality || [];
    if (locations.length === 0 && nationalities.length === 0) {
      setGeoFilterCVs(null);
      setGeoFilterLoading(false);
      return;
    }
    let cancelled = false;
    setGeoFilterLoading(true);
    (async () => {
      try {
        const collected: CVListItem[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const res = await api.searchCVsAdvanced({
            locations: locations.length ? locations : undefined,
            nationalities: nationalities.length ? nationalities : undefined,
            limit: 100,
            cursor,
          });
          collected.push(...(res.results || []));
          cursor = res.next_cursor;
          pages += 1;
        } while (cursor && pages < 10 && !cancelled);
        if (!cancelled) setGeoFilterCVs(collected);
      } catch {
        if (!cancelled) setGeoFilterCVs([]);
      } finally {
        if (!cancelled) setGeoFilterLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sidebarFilters.location, sidebarFilters.nationality]);

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

  // Server-side search across ALL CVs (avoids missing results due to local 200/50-item pagination)
  useEffect(() => {
    if (!isServerSearchMode) {
      setServerSearchCVs({ items: [], total: null });
      setServerSearching(false);
      return;
    }

    let cancelled = false;
    setServerSearching(true);
    const t = setTimeout(() => {
      const offset = (page - 1) * ITEMS_PER_PAGE;
      const category = activeFolder === CATEGORY_ALL ? undefined : activeFolder;
      api
        .listCVs({ q: search.trim(), category, limit: ITEMS_PER_PAGE, offset })
        .then((res) => {
          if (cancelled) return;
          setServerSearchCVs({ items: res.cvs ?? [], total: typeof res.total === 'number' ? res.total : null });
        })
        .catch(() => {
          if (cancelled) return;
          setServerSearchCVs({ items: [], total: 0 });
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
  }, [search, activeFolder, page, isServerSearchMode]);

  const filteredCVs = useMemo(() => {
    if (isServerSearchMode) {
      return serverSearchCVs.items;
    }

    const selectedCategories = sidebarFilters.category || [];
    let list: CVListItem[];

    if (geoFilterCVs) {
      list = geoFilterCVs;
    } else if (activeFolder === CATEGORY_ALL) {
      list = cvs;
    } else {
      list = folderCVs[activeFolder]?.items ?? [];
    }

    // Multi-category (or geo results): filter by category when any checked
    if (selectedCategories.length > 0) {
      list = list.filter((cv) => {
        const cat = (cv.category || 'General').trim() || 'General';
        return selectedCategories.includes(cat);
      });
    }

    if (notesFilter === 'with_notes') {
      list = list.filter((cv) => (notesSummary[cv.id] ?? 0) > 0);
    } else if (notesFilter === 'without_notes') {
      list = list.filter((cv) => (notesSummary[cv.id] ?? 0) === 0);
    }
    return list;
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
  ]);

  const filteredJDs = useMemo(() => {
    if (!search.trim()) return jds;
    const q = search.toLowerCase();
    return jds.filter(
      (jd) =>
        jd.job_title?.toLowerCase().includes(q) ||
        jd.filename?.toLowerCase().includes(q) ||
        jd.id.toLowerCase().includes(q)
    );
  }, [jds, search]);

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

  // When not searching, the server knows the true total for folders; client may have partial list loaded.
  // Geo facet results are a finite client list, page against that length.
  const totalItemsForPaging = geoFilterCVs
    ? filteredCVs.length
    : (activeTotalCount ?? filteredCVs.length);
  const totalPages = Math.ceil(totalItemsForPaging / ITEMS_PER_PAGE) || 1;
  const paginatedCVs = useMemo(() => {
    if (isServerSearchMode) return filteredCVs;
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredCVs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredCVs, page]);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) setPage(1);
  }, [page, totalPages]);

  const toggleCV = (id: string) => {
    if (selectedCVs.includes(id)) deselectCV(id);
    else selectCV(id);
  };

  const allOnPageSelected = paginatedCVs.length > 0 && paginatedCVs.every((cv) => selectedCVs.includes(cv.id));

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
    // In server-search mode, pagination is handled by (page -> API fetch) not by loading more into memory.
    if (isServerSearchMode) return;
    if (activeFolder === CATEGORY_ALL) return loadMoreCVs();
    return loadFolderCVPage(activeFolder, activeLoadedCount);
  };

  const handleNextPage = async () => {
    if (isServerSearchMode) {
      if (page < totalPages) setPage((p) => Math.min(totalPages, p + 1));
      return;
    }
    const nextPageEndIndex = page * ITEMS_PER_PAGE;
    const hasNextPageLocally = filteredCVs.length > nextPageEndIndex;

    // If we already have enough items locally to render the next page, just advance.
    if (hasNextPageLocally) {
      setPage((p) => Math.min(totalPages, p + 1));
      return;
    }

    // Otherwise, fetch more from server if we know there's more to load, then advance.
    if (activeTotalCount != null && activeLoadedCount < activeTotalCount) {
      await loadMoreActiveFolder();
      setPage((p) => Math.min(totalPages, p + 1));
      return;
    }

    // Fallback: if totals are unknown, still allow advancing within computed pages.
    if (page < totalPages) {
      setPage((p) => Math.min(totalPages, p + 1));
    }
  };

  const pagingStart = paginatedCVs.length > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
  const pagingEnd = paginatedCVs.length > 0 ? (page - 1) * ITEMS_PER_PAGE + paginatedCVs.length : 0;

  const openPreview = (id: string, type: 'cv' | 'jd', name: string, item?: CVListItem | JDListItem) => {
    const rawName = item?.filename || name;
    void handlePreviewFile(id, type, rawName);
  };

  const handleAddNote = async () => {
    if (!detailCVId || !newNoteText.trim() || !user?.username) return;
    setSavingNote(true);
    try {
      await api.addOrUpdateNote(detailCVId, newNoteText.trim(), user.username);
      const res = await api.getCVNotes(detailCVId);
      setDetailNotes(res.notes || []);
      setNotesSummary((prev) => ({ ...prev, [detailCVId]: (res.notes || []).length }));
      setNewNoteText('');
    } catch (e) {
      console.error(e);
    } finally {
      setSavingNote(false);
    }
  };

  const handleSaveEditNote = async () => {
    if (editingNoteIndex == null || !detailCVId || !editNoteText.trim() || !user?.username) return;
    setSavingNote(true);
    try {
      await api.addOrUpdateNote(detailCVId, editNoteText.trim(), user.username);
      const res = await api.getCVNotes(detailCVId);
      setDetailNotes(res.notes || []);
      setEditingNoteIndex(null);
      setEditNoteText('');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (hrUser: string) => {
    if (!detailCVId || !user?.username || !window.confirm('Delete this note?')) return;
    try {
      await api.deleteCVNote(detailCVId, hrUser);
      const res = await api.getCVNotes(detailCVId);
      setDetailNotes(res.notes || []);
      setNotesSummary((prev) => ({ ...prev, [detailCVId]: (res.notes || []).length }));
    } catch (e) {
      console.error(e);
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
        label: 'Location',
        options: locationFacets.map((f) => ({ value: f.value, label: f.value, count: f.count })),
      },
      {
        key: 'nationality',
        label: 'Nationality',
        options: nationalityFacets.map((f) => ({ value: f.value, label: f.value, count: f.count })),
      },
    ];
  }, [folderList, locationFacets, nationalityFacets]);

  const toggleSidebarFilter = (groupKey: string, value: string) => {
    setPage(1);
    setSidebarFilters((prev) => {
      const current = prev[groupKey] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [groupKey]: next };
    });
  };

  const clearSidebarFilters = () => {
    setPage(1);
    setSidebarFilters({ category: [], location: [], nationality: [] });
  };

  const cvCount = totalCVs ?? cvs.length;
  const jdCount = totalJDs ?? jds.length;
  const cvLoading =
    ((loadingStates.cvs.isLoading || loadingFolderCVs[activeFolder] || geoFilterLoading) &&
      paginatedCVs.length === 0);
  const jdLoading = loadingStates.jds.isLoading && jds.length === 0;

  const renderCandidateCard = (cv: CVListItem, index: number) => {
    const d = getCVDisplay(cv);
    return (
      <CandidateCard
        key={cv.id}
        cv={cv}
        display={d}
        index={index}
        selected={selectedCVs.includes(cv.id)}
        matchedKeywords={cv.matched_keywords || []}
        onToggleSelect={() => toggleCV(cv.id)}
        onOpenDetails={() => setDetailCVId(cv.id)}
        onPreview={() => openPreview(cv.id, 'cv', d.name, cv)}
        onDelete={() => handleDeleteCV(cv.id)}
      />
    );
  };

  const renderCandidatesBody = () => {
    if (cvLoading) {
      return <CandidatesListSkeleton />;
    }

    if (filteredCVs.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title={
            search
              ? 'No candidates match your search'
              : (sidebarFilters.category?.length || sidebarFilters.location?.length || sidebarFilters.nationality?.length)
                ? 'No candidates match these filters'
                : 'No CVs yet'
          }
          hint={
            !search &&
            !(sidebarFilters.category?.length || sidebarFilters.location?.length || sidebarFilters.nationality?.length)
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
              aria-label="Select all on this page"
            />
            {allOnPageSelected ? 'Deselect this page' : 'Select this page'}
          </label>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {pagingStart > 0 && (
              <span className="tabular-nums">
                {pagingStart}–{pagingEnd} of {(geoFilterCVs ? filteredCVs.length : totalItemsForPaging).toLocaleString()}
              </span>
            )}
            {selectedCVs.length > 0 && (
              <button type="button" onClick={() => deselectAllCVs()} className="font-semibold text-navy-600 hover:underline">
                Clear {selectedCVs.length} selected
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          {paginatedCVs.map((cv, i) => renderCandidateCard(cv, pagingStart + i))}
        </div>

        {(totalPages > 1 || (activeTotalCount != null && activeLoadedCount < activeTotalCount && !geoFilterCVs)) && (
          <div className="mt-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <p className="text-[13px] text-slate-500 tabular-nums">
                Showing {pagingStart}–{pagingEnd} of {(geoFilterCVs ? filteredCVs.length : totalItemsForPaging).toLocaleString()}
              </p>
              <Button variant="secondary" size="sm" onClick={selectAllInFolder}>
                {allOnPageSelected ? 'Deselect page' : 'Select page'}
              </Button>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  Previous
                </Button>
                <span className="min-w-[88px] text-center text-xs font-semibold text-slate-600 tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={page >= totalPages && !(activeTotalCount != null && activeLoadedCount < activeTotalCount && !geoFilterCVs)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
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
                else { setView(t.id); setPage(1); }
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
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
              onChange={(v) => { setNotesFilter(v); setPage(1); }}
              items={[
                { value: 'all', label: 'All' },
                { value: 'with_notes', label: 'With notes' },
                { value: 'without_notes', label: 'No notes' },
              ]}
            />

            {totalPages > 1 && (
              <div className="ml-auto flex items-center gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  Prev
                </Button>
                <span className="min-w-[88px] text-center text-xs font-semibold text-slate-600 tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={page >= totalPages && !(activeTotalCount != null && activeLoadedCount < activeTotalCount && !geoFilterCVs)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {view === 'candidates' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 px-1">
          <span className="text-[13px] font-medium text-slate-700 tabular-nums">
            {(geoFilterCVs ? filteredCVs.length : totalItemsForPaging).toLocaleString()} candidates
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
          onViewDetails={(cvId) => {
            setShowAdvancedSearch(false);
            setDetailCVId(cvId);
          }}
        />
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
            <Table>
              <THead>
                <TR>
                  <TH className="w-14">S.No</TH>
                  <TH>Job title</TH>
                  <TH className="w-28">Uploaded</TH>
                  <TH className="w-[280px] text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filteredJDs.map((jd, jdIndex) => {
                  const d = getJDDisplay(jd);
                  const isSelected = selectedJD === jd.id;
                  return (
                    <TR key={jd.id} className={isSelected ? 'bg-navy-50/60 hover:bg-navy-50/80' : undefined}>
                      <TD className="w-14 text-xs font-semibold tabular-nums text-slate-500">{jdIndex + 1}</TD>
                      <TD>
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-navy-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            {isSelected ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setDetailJDId(jd.id)}
                              className="block max-w-[360px] truncate text-left text-[13px] font-semibold text-slate-900 hover:text-navy-600"
                              title={d.title}
                            >
                              {d.title}
                            </button>
                            <p className="max-w-[360px] truncate text-xs text-slate-400" title={jd.filename || ''}>{jd.filename || '-'}</p>
                          </div>
                        </div>
                      </TD>
                      <TD className="text-slate-500">{formatDate(jd.upload_date)}</TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => selectJD(isSelected ? null : jd.id)}
                            className={`mr-1 inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors ${
                              isSelected
                                ? 'bg-navy-600 text-white hover:bg-navy-700'
                                : 'border border-surface-strong bg-white text-slate-700 hover:border-navy-300 hover:bg-navy-50 hover:text-navy-700'
                            }`}
                            title={isSelected ? 'Deselect this job description' : 'Use this job description for matching'}
                          >
                            {isSelected ? <><Check className="h-3.5 w-3.5" /> Selected</> : <><Target className="h-3.5 w-3.5" /> Use for match</>}
                          </button>
                          <button onClick={() => openPreview(jd.id, 'jd', d.title, jd)} title="View raw document" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900">
                            <FileTextIcon className="h-4 w-4 text-indigo-600" />
                          </button>
                          <button onClick={() => setDetailJDId(jd.id)} title="View details & analysis" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900">
                            <Eye className="h-4 w-4 text-blue-600" />
                          </button>
                          <button onClick={() => handleDeleteJD(jd.id)} title="Delete" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600">
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {totalJDs != null && jds.length < totalJDs && (
              <div className="mt-3">
                <Button variant="secondary" className="w-full" onClick={() => loadMoreJDs()} loading={loadingStates.jds.isLoading}>
                  Load more job descriptions ({jds.length} of {totalJDs} loaded)
                </Button>
              </div>
            )}
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
            onClick={() => { setDetailCVId(null); setEditingNoteIndex(null); setNewNoteText(''); setEditNoteText(''); }}
            aria-hidden
          />
          <div
            className="fixed inset-y-0 right-0 z-[999] flex w-full flex-col border-l border-slate-200 bg-white shadow-xl sm:w-[var(--detail-w)]"
            style={{ ['--detail-w' as string]: `${detailWidth}px` }}
          >
            <button
              type="button"
              aria-label="Drag to widen details"
              title="Drag to see more"
              onPointerDown={onDetailDragStart}
              className="absolute -left-3 top-1/2 z-10 hidden h-11 w-6 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm hover:border-navy-400 sm:flex"
            >
              <GripVertical className="h-4 w-4 text-slate-400" />
            </button>
            <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Candidate details &amp; notes</h2>
              <button
                type="button"
                onClick={() => { setDetailCVId(null); setEditingNoteIndex(null); setNewNoteText(''); setEditNoteText(''); }}
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
                      if (!email && !phone) return null;
                      return (
                        <ContactActions
                          email={email}
                          phone={phone}
                          privacy
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
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const skills = detailCV.candidate?.skills || detailCV.structured_info?.skills_sentences || [];
                        return (
                          <>
                            {skills.slice(0, 30).map((s: string, i: number) => (
                              <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                                {s}
                              </span>
                            ))}
                            {skills.length > 30 && <span className="text-xs text-slate-500">+{skills.length - 30} more</span>}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Responsibilities</h4>
                    <ul className="space-y-1.5">
                      {(detailCV.candidate?.responsibilities || detailCV.structured_info?.responsibility_sentences || []).slice(0, 15).map((r: string, i: number) => (
                        <li key={i} className="flex gap-2 text-[13px] text-slate-700">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-navy-300" />
                          <span className="line-clamp-2">{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                      <MessageSquare className="h-4 w-4" /> Notes ({detailNotes.length})
                    </h4>
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {detailNotes.length === 0 ? (
                        <p className="text-[13px] text-slate-500">No notes yet. Add one below.</p>
                      ) : (
                        detailNotes.map((note: any, i: number) => (
                          <div key={i} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                            {editingNoteIndex === i ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editNoteText}
                                  onChange={(e) => setEditNoteText(e.target.value)}
                                  className="w-full resize-none rounded-md border border-slate-300 p-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                                  rows={2}
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={handleSaveEditNote} loading={savingNote} icon={<Save />}>
                                    Save
                                  </Button>
                                  <Button size="sm" variant="secondary" onClick={() => { setEditingNoteIndex(null); setEditNoteText(''); }}>Cancel</Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="text-[13px] text-slate-800">{note.note}</p>
                                <div className="mt-2 flex items-center justify-between">
                                  <span className="text-xs text-slate-500">{note.hr_user} • {note.updated_at ? new Date(note.updated_at).toLocaleDateString() : ''}</span>
                                  {note.hr_user === user?.username && (
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        className="text-xs text-brand-600 hover:underline"
                                        onClick={() => { setEditingNoteIndex(i); setEditNoteText(note.note || ''); }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="text-xs text-red-600 hover:underline"
                                        onClick={() => handleDeleteNote(note.hr_user)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <textarea
                        value={newNoteText}
                        onChange={(e) => setNewNoteText(e.target.value)}
                        placeholder="Add a note..."
                        className="w-full resize-none rounded-md border border-slate-300 p-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                        rows={2}
                      />
                      <Button
                        size="sm"
                        className="mt-2"
                        onClick={handleAddNote}
                        loading={savingNote}
                        disabled={savingNote || !newNoteText.trim()}
                        icon={<MessageSquare />}
                      >
                        Add note
                      </Button>
                    </div>
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
            className="fixed inset-y-0 right-0 z-[999] flex w-full flex-col border-l border-slate-200 bg-white shadow-xl sm:w-[var(--detail-w)]"
            style={{ ['--detail-w' as string]: `${detailWidth}px` }}
          >
            <button
              type="button"
              aria-label="Drag to widen details"
              title="Drag to see more"
              onPointerDown={onDetailDragStart}
              className="absolute -left-3 top-1/2 z-10 hidden h-11 w-6 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm hover:border-navy-400 sm:flex"
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

                  {/* Skills, clean keyword chips (e.g. AWS, Python), not the raw
                      skill sentences used internally for embedding/matching. */}
                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                      <Code className="h-4 w-4 text-slate-400" /> Skills
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(detailJD.job_requirements?.skill_keywords || []).length > 0 ? (
                        detailJD.job_requirements.skill_keywords.map((s: string, i: number) => (
                          <span key={i} className="rounded-md bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-700">
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-[13px] text-slate-400">No skills extracted for this JD.</span>
                      )}
                    </div>
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
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-600"
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
                      <pre className="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11.5px] leading-relaxed text-slate-700">
                        {detailJD.job_requirements?.boolean_search_string || detailJD.boolean_search_string}
                      </pre>
                    </div>
                  )}
                  <div className="rounded-xl border border-surface-border bg-white p-4 shadow-card">
                    <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Responsibilities</h4>
                    <ul className="space-y-1.5">
                      {(detailJD.job_requirements?.responsibilities || detailJD.structured_info?.responsibilities || []).slice(0, 15).map((r: string, i: number) => (
                        <li key={i} className="flex gap-2 text-[13px] text-slate-700">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-navy-300" />
                          <span className="line-clamp-2">{r}</span>
                        </li>
                      ))}
                    </ul>
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
