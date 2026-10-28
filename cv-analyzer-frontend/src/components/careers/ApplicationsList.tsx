'use client';

import React, { useMemo, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  User,
  FileText,
  X,
  Loader2,
  MessageSquare,
  Save,
  Eye,
  DollarSign,
  Search,
  ArrowUpDown,
  Filter,
} from 'lucide-react';
import { useCareersStore } from '@/stores/careersStore';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import ContactActions from '@/components/common/ContactActions';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/page';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import FilterSidebar, { buildFilterGroup, buildFixedFilterGroup } from '@/components/common/FilterSidebar';
import { NOTICE_PERIOD_OPTIONS } from '@/components/careers/JobApplicationForm';

const FilePreviewModal = dynamic(
  () => import('@/components/ui/file-preview-modal').then((mod) => mod.FilePreviewModal),
  { ssr: false }
);

function MatchScorePill({ score }: { score: number }) {
  const variant = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
  return <Badge variant={variant}>{Math.round(score)}%</Badge>;
}

function IconButton({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50 ${className || ''}`}
    >
      {children}
    </button>
  );
}

export default function ApplicationsList() {
  const { applications, isLoading, selectedJob, viewingCVData, setViewingCVData, loadJobApplications } = useCareersStore();
  const { setCareersMatchData } = useAppStore();
  const { user } = useAuthStore();
  const [downloadingCV, setDownloadingCV] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email_application' | 'other'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'salary_high' | 'salary_low'>('recent');
  // Sidebar checkbox filters (Naukri-Gulf-style): group key -> selected values.
  const [sidebarFilters, setSidebarFilters] = useState<Record<string, string[]>>({});

  const toggleSidebarFilter = (groupKey: string, value: string) => {
    setSidebarFilters((prev) => {
      const current = prev[groupKey] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [groupKey]: next };
    });
  };
  const clearSidebarFilters = () => setSidebarFilters({});

  // Note editing state
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState<string | null>(null);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const handleDownloadCV = async (cvId: string) => {
    setDownloadingCV(cvId);
    try {
      const { blob, filename } = await api.downloadCV(cvId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename; // Use the filename from server response
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download CV:', error);
    } finally {
      setDownloadingCV(null);
    }
  };

  const [loadingCVData, setLoadingCVData] = useState(false);

  // Note handling functions
  const handleEditNote = (cvId: string, currentNote: string = '') => {
    setEditingNote(cvId);
    setNoteText(currentNote);
  };

  const handleSaveNote = async (cvId: string) => {
    if (!noteText.trim()) return;

    setSavingNote(cvId);
    try {
      await api.addOrUpdateNote(cvId, noteText.trim(), user?.username || 'anonymous');
      setEditingNote(null);
      setNoteText('');

      // Reload applications to get updated note data
      if (selectedJob) {
        await loadJobApplications(selectedJob.job_id);
      }
    } catch (error) {
      console.error('Failed to save note:', error);
      alert('Failed to save note. Please try again.');
    } finally {
      setSavingNote(null);
    }
  };

  const handleCancelNote = () => {
    setEditingNote(null);
    setNoteText('');
  };

  const handleViewDetails = async (cvId: string, filename: string) => {
    setLoadingCVData(true);
    setDetailNotes([]);
    setEditingNoteIndex(null);
    setEditNoteText('');
    setNewNoteText('');
    try {
      const cvData = await api.getCVDetails(cvId);
      const jobApplicationFromList = applications.find((app) => app.application_id === cvId);
      const jobApplication = (cvData as any).job_application || jobApplicationFromList;
      const content = {
        candidate: cvData.candidate,
        structured_info: cvData.structured_info,
        text_info: cvData.text_info,
        upload_date: (cvData as any).upload_date,
        job_application: jobApplication
          ? {
              applicant_name: jobApplicationFromList?.applicant_name,
              applicant_email: jobApplicationFromList?.applicant_email,
              applicant_phone: jobApplicationFromList?.applicant_phone,
              application_date: jobApplicationFromList?.application_date,
              expected_salary: jobApplicationFromList?.expected_salary ?? (jobApplication as any).expected_salary,
              application_status: (jobApplication as any).application_status,
              years_of_experience: (jobApplication as any).years_of_experience,
            }
          : null,
      };
      setViewingCVData({ cvId, filename, content: JSON.stringify(content) });
    } catch (error) {
      console.error('Failed to load CV data:', error);
      setViewingCVData({ cvId, filename, content: 'Failed to load CV content' });
    } finally {
      setLoadingCVData(false);
    }
  };

  const [detailNotes, setDetailNotes] = useState<any[]>([]);
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [savingPanelNote, setSavingPanelNote] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ cvId: string; fileName: string } | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Load PDF via download API (works for job applications; avoids CORS and ensures file is available)
  useEffect(() => {
    if (!pdfPreview) {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(null);
      }
      setPdfLoadError(null);
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    setPdfLoadError(null);
    (async () => {
      try {
        const { blob } = await api.downloadCV(pdfPreview.cvId);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
      } catch (e) {
        if (!cancelled) {
          setPdfLoadError(e instanceof Error ? e.message : 'Failed to load PDF');
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfPreview?.cvId]);

  const closePdfPreview = () => {
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
    setPdfPreview(null);
    setPdfLoadError(null);
    setPdfLoading(false);
  };

  useEffect(() => {
    if (!viewingCVData?.cvId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getCVNotes(viewingCVData.cvId);
        if (!cancelled) setDetailNotes(res.notes || []);
      } catch {
        if (!cancelled) setDetailNotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewingCVData?.cvId]);

  const handlePanelAddNote = async () => {
    if (!viewingCVData?.cvId || !newNoteText.trim() || !user?.username) return;
    setSavingPanelNote(true);
    try {
      await api.addOrUpdateNote(viewingCVData.cvId, newNoteText.trim(), user.username);
      const res = await api.getCVNotes(viewingCVData.cvId);
      setDetailNotes(res.notes || []);
      setNewNoteText('');
      if (selectedJob) await loadJobApplications(selectedJob.job_id);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingPanelNote(false);
    }
  };

  const handlePanelSaveEditNote = async () => {
    if (editingNoteIndex == null || !viewingCVData?.cvId || !editNoteText.trim() || !user?.username) return;
    setSavingPanelNote(true);
    try {
      await api.addOrUpdateNote(viewingCVData.cvId, editNoteText.trim(), user.username);
      const res = await api.getCVNotes(viewingCVData.cvId);
      setDetailNotes(res.notes || []);
      setEditingNoteIndex(null);
      setEditNoteText('');
    } finally {
      setSavingPanelNote(false);
    }
  };

  const handlePanelDeleteNote = async (hrUser: string) => {
    if (!viewingCVData?.cvId || !user?.username || !window.confirm('Delete this note?')) return;
    try {
      await api.deleteCVNote(viewingCVData.cvId, hrUser);
      const res = await api.getCVNotes(viewingCVData.cvId);
      setDetailNotes(res.notes || []);
      if (selectedJob) await loadJobApplications(selectedJob.job_id);
    } catch (e) {
      console.error(e);
    }
  };

  const previewFileName = (filename: string, displayName: string) => {
    const base = filename || displayName || 'document';
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  };



  // Sidebar filter groups, derived from the current applicant list so counts
  // and available options always reflect what's actually on this job.
  const filterGroups = useMemo(() => [
    buildFilterGroup('location', 'Location', applications || [], (a: any) => a?.location),
    buildFixedFilterGroup('notice_period', 'Notice period', applications || [], (a: any) => a?.notice_period, NOTICE_PERIOD_OPTIONS),
  ], [applications]);

  const filteredApplications = useMemo(() => {
    let list = applications || [];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((a: any) => {
        const name = String(a?.applicant_name || '').toLowerCase();
        const email = String(a?.applicant_email || '').toLowerCase();
        const phone = String(a?.applicant_phone || '').toLowerCase();
        const file = String(a?.cv_filename || '').toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || file.includes(q);
      });
    }
    if (sourceFilter !== 'all') {
      list = list.filter((a: any) => {
        const src = a?.source;
        if (sourceFilter === 'email_application') return src === 'email_application';
        return src !== 'email_application';
      });
    }
    // Sidebar checkbox filters: within a group values are OR'd, across groups AND'd.
    for (const [groupKey, selectedValues] of Object.entries(sidebarFilters)) {
      if (!selectedValues || selectedValues.length === 0) continue;
      list = list.filter((a: any) => {
        const raw = a?.[groupKey];
        const value = raw && String(raw).trim() ? String(raw).trim() : 'Not specified';
        return selectedValues.includes(value);
      });
    }
    const byDate = (s?: string) => {
      const t = s ? Date.parse(s) : 0;
      return Number.isFinite(t) ? t : 0;
    };
    const bySalary = (n: any) => (typeof n === 'number' && Number.isFinite(n) ? n : -1);
    const sorted = [...list].sort((a: any, b: any) => {
      if (sortBy === 'recent') return byDate(b?.application_date) - byDate(a?.application_date);
      if (sortBy === 'salary_high') return bySalary(b?.expected_salary) - bySalary(a?.expected_salary);
      if (sortBy === 'salary_low') return bySalary(a?.expected_salary) - bySalary(b?.expected_salary);
      return 0;
    });
    return sorted;
  }, [applications, query, sourceFilter, sortBy, sidebarFilters]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={User}
          title="No applicants yet"
          hint="Share the job posting link to start receiving applications."
        />
      </div>
    );
  }

  const totalCount = applications.length;
  const visibleCount = filteredApplications.length;
  const naukriCount = applications.filter((a: any) => a?.source === 'email_application').length;
  const withSalaryCount = applications.filter((a: any) => typeof a?.expected_salary === 'number').length;

  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-6">
      <FilterSidebar
        groups={filterGroups}
        selected={sidebarFilters}
        onToggle={toggleSidebarFilter}
        onClearAll={clearSidebarFilters}
      />

      <div className="min-w-0 flex-1 space-y-4">
      {/* Controls */}
      <div className="toolbar-bar flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-slate-900">Applicants</span>
            <span className="text-[13px] text-slate-500">
              Showing {visibleCount} of {totalCount}
              {naukriCount > 0 ? ` · Naukri: ${naukriCount}` : ''}
              {withSalaryCount > 0 ? ` · Salary: ${withSalaryCount}` : ''}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Search, filter, and open a candidate to review their details, match score, and PDF.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, phone, filename…"
              className="field-input w-full pl-9 pr-3"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as any)}
                className="field-input text-slate-700"
                title="Filter by source"
              >
                <option value="all">All sources</option>
                <option value="email_application">Naukri (email)</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <ArrowUpDown className="h-4 w-4 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="field-input text-slate-700"
                title="Sort"
              >
                <option value="recent">Most recent</option>
                <option value="salary_high">Salary (high → low)</option>
                <option value="salary_low">Salary (low → high)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <Table className="table-premium min-w-[880px]">
        <THead>
          <TR>
            <TH>Candidate</TH>
            <TH>Email</TH>
            <TH>Applied</TH>
            <TH>Location</TH>
            <TH>Notice period</TH>
            <TH>Expected salary</TH>
            <TH>Match</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {filteredApplications.map((application) => {
            return (
              <TR key={application.application_id}>
                <TD>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100">
                      <User className="h-4 w-4 text-slate-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="block truncate font-medium text-slate-900">{application.applicant_name}</span>
                        {application.source === 'email_application' && (
                          <span className="chip chip-neutral">Naukri</span>
                        )}
                      </div>
                      {application.cv_filename && (
                        <p className="max-w-[160px] truncate text-[12px] text-slate-400" title={application.cv_filename}>
                          {application.cv_filename}
                        </p>
                      )}
                    </div>
                  </div>
                </TD>
                <TD>
                  <a
                    href={`mailto:${application.applicant_email}`}
                    className="block max-w-[200px] truncate text-brand-600 hover:underline"
                    title={application.applicant_email}
                  >
                    {application.applicant_email}
                  </a>
                  {application.applicant_phone && (
                    <p className="mt-0.5 text-[12px] text-slate-500">{application.applicant_phone}</p>
                  )}
                  <ContactActions
                    email={application.applicant_email}
                    phone={application.applicant_phone}
                    variant="icons"
                    className="mt-1.5"
                  />
                </TD>
                <TD className="whitespace-nowrap text-slate-600">
                  {formatDate(application.application_date)}
                </TD>
                <TD className="whitespace-nowrap text-slate-600">
                  {application.location || <span className="text-slate-400">—</span>}
                </TD>
                <TD className="whitespace-nowrap text-slate-600">
                  {application.notice_period || <span className="text-slate-400">—</span>}
                </TD>
                <TD>
                  {application.expected_salary != null ? (
                    <span className="whitespace-nowrap font-medium text-slate-900">
                      AED {application.expected_salary.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TD>
                <TD>
                  {typeof application.match_score === 'number' ? (
                    <MatchScorePill score={application.match_score <= 1 ? application.match_score * 100 : application.match_score} />
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TD>
                <TD>
                  <div className="flex items-center justify-end gap-0.5">
                    <IconButton
                      title="View details"
                      onClick={() => handleViewDetails(application.application_id, application.cv_filename)}
                      className="hover:text-brand-600"
                    >
                      <Eye className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      title="View PDF"
                      onClick={() => {
                        const name = application.applicant_name || 'document';
                        const fn = previewFileName(application.cv_filename, name);
                        setPdfPreview({ cvId: application.application_id, fileName: fn });
                      }}
                      className="hover:text-brand-600"
                    >
                      <FileText className="h-4 w-4" />
                    </IconButton>
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      </div>

      {/* Right-side panel: Candidate details & notes */}
      {viewingCVData && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-950/30"
            onClick={() => {
              setViewingCVData(null);
              setEditingNoteIndex(null);
              setEditNoteText('');
              setNewNoteText('');
            }}
            aria-hidden
          />
          <div className="animate-page-enter fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-white shadow-[var(--shadow-md)] sm:max-w-lg">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3.5">
              <h2 className="truncate pr-2 text-[15px] font-semibold text-slate-900">Candidate details</h2>
              <button
                type="button"
                onClick={() => {
                  setViewingCVData(null);
                  setEditingNoteIndex(null);
                  setEditNoteText('');
                  setNewNoteText('');
                }}
                className="rounded p-1 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {loadingCVData ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
                  <p className="mt-2 text-[13px] text-slate-500">Loading details…</p>
                </div>
              ) : (
                (() => {
                  try {
                    const data = JSON.parse(viewingCVData.content);
                    const candidate = data.candidate;
                    const structured = data.structured_info;
                    const jobApplication = data.job_application;
                    const skills = candidate?.skills || structured?.skills_sentences || [];
                    const responsibilities = candidate?.responsibilities || structured?.responsibility_sentences || [];
                    const displayName = jobApplication?.applicant_name || candidate?.full_name || 'Unknown';
                    const fileName = previewFileName(viewingCVData.filename, displayName);
                    return (
                      <>
                        <div className="surface-panel p-4">
                          <h3 className="text-[15px] font-semibold text-slate-900">
                            {displayName}
                          </h3>
                          <p className="mt-1 text-[13px] text-slate-600">
                            {candidate?.job_title || '—'}
                          </p>
                          <p className="mt-1 text-[12px] text-slate-500">
                            {candidate?.years_of_experience ?? '—'} years · {skills.length} skills
                          </p>
                          {structured?.category && (
                            <p className="mt-1 text-[12px] text-slate-500">Category: {structured.category}</p>
                          )}
                          {jobApplication?.expected_salary != null && (
                            <p className="mt-2 flex items-center gap-1 text-[13px] font-medium text-slate-800">
                              <DollarSign className="h-4 w-4 text-slate-400" />
                              Salary asked: AED {Number(jobApplication.expected_salary).toLocaleString()}
                            </p>
                          )}
                          <Button
                            variant="primary"
                            size="sm"
                            className="mt-3 w-full"
                            icon={<Eye className="h-4 w-4" />}
                            onClick={() => setPdfPreview({ cvId: viewingCVData.cvId, fileName })}
                          >
                            View full PDF
                          </Button>
                        </div>
                        <div className="surface-panel p-4">
                          <h4 className="section-label mb-2">Skills</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {skills.slice(0, 30).map((s: string, i: number) => (
                              <span key={i} className="chip chip-brand">{s}</span>
                            ))}
                            {skills.length > 30 && <span className="text-[12px] text-slate-500">+{skills.length - 30} more</span>}
                          </div>
                        </div>
                        <div className="surface-panel p-4">
                          <h4 className="section-label mb-2">Responsibilities</h4>
                          <ul className="list-inside list-disc space-y-1 text-[13px] text-slate-600">
                            {responsibilities.slice(0, 15).map((r: string, i: number) => (
                              <li key={i} className="line-clamp-2">{r}</li>
                            ))}
                          </ul>
                        </div>
                      </>
                    );
                  } catch {
                    return (
                      <p className="text-[13px] text-slate-500">Failed to load details.</p>
                    );
                  }
                })()
              )}
            </div>
          </div>
        </>
      )}

      {pdfPreview && (
        pdfLoading ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50">
            <div className="surface-panel flex flex-col items-center gap-3 p-6">
              <Loader2 className="h-10 w-10 animate-spin text-brand-600" />
              <p className="text-[13px] text-slate-700">Loading PDF…</p>
            </div>
          </div>
        ) : pdfLoadError ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50">
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-white p-6">
              <p className="text-[13px] text-red-600">{pdfLoadError}</p>
              <Button onClick={closePdfPreview} variant="secondary">Close</Button>
            </div>
          </div>
        ) : pdfBlobUrl ? (
          <FilePreviewModal
            isOpen
            onClose={closePdfPreview}
            fileUrl={pdfBlobUrl}
            fileName={pdfPreview.fileName}
            fileId={pdfPreview.cvId}
            fileType="application/pdf"
          />
        ) : null
      )}
    </div>
  );
}
