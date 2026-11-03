'use client';

import { useMemo, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  User,
  Users,
  FileText,
  X,
  Loader2,
  Eye,
  DollarSign,
  MapPin,
  Globe,
  Clock,
  Briefcase,
} from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import ContactActions from '@/components/common/ContactActions';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/page';
import { Avatar } from '@/components/ui/avatar';
import { Bone, SkeletonRegion } from '@/components/skeletons';

const FilePreviewModal = dynamic(
  () => import('@/components/ui/file-preview-modal').then((mod) => mod.FilePreviewModal),
  { ssr: false }
);

function MatchScorePill({ score }: { score: number }) {
  const variant = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
  return <Badge variant={variant}>{Math.round(score)}%</Badge>;
}

export default function ApplicationsList() {
  const { applications, isLoading, viewingCVData, setViewingCVData } = useCareersStore();
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const [loadingCVData, setLoadingCVData] = useState(false);

  const handleViewDetails = async (cvId: string, filename: string) => {
    setLoadingCVData(true);
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

  const previewFileName = (filename: string, displayName: string) => {
    const base = filename || displayName || 'document';
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  };



  // Newest application first; no filters, search or sort controls on this page.
  const orderedApplications = useMemo(() => {
    const at = (v?: string) => {
      const t = v ? Date.parse(v) : 0;
      return Number.isFinite(t) ? t : 0;
    };
    return [...(applications || [])].sort((x: any, y: any) => at(y?.application_date) - at(x?.application_date));
  }, [applications]);

  if (isLoading) {
    return (
      <SkeletonRegion label="Loading applicants" className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-surface-border bg-paper p-4">
            <Bone className="h-10 w-10 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bone className="h-4 w-40" />
              <Bone className="h-3 w-56" />
            </div>
            <Bone className="h-8 w-20" />
          </div>
        ))}
      </SkeletonRegion>
    );
  }

  if (applications.length === 0) {
    return (
      <div>
        <EmptyState
          icon={User}
          title="No applicants yet"
          hint="Share the job posting link to start receiving applications."
        />
      </div>
    );
  }

  const totalCount = applications.length;

  const dash = <span className="text-slate-300">-</span>;
  const th = 'px-3 py-3 text-left text-xs font-medium text-slate-500';

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Users className="h-4 w-4" /></span>
            <div>
              <div className="text-[15px] font-semibold text-slate-900">Applicants</div>
              <div className="text-[12px] text-slate-500">Review details, open the CV and add notes</div>
            </div>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-100">{totalCount} candidates</span>
        </div>

        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[19%]" />
            <col className="w-[20%]" />
            <col className="w-[9%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[6%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-surface-border bg-slate-50">
              <th className={th}>Candidate</th>
              <th className={th}>Contact</th>
              <th className={th}>Applied</th>
              <th className={th}>Location</th>
              <th className={th}>Experience</th>
              <th className={th}>Expected salary</th>
              <th className={th}>Match</th>
              <th className={`${th} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orderedApplications.map((application: any) => (
              <tr key={application.application_id} className="align-top transition-colors hover:bg-slate-50/70">
                <td className="px-3 py-3.5">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Avatar name={application.applicant_name} />
                    <div className="min-w-0">
                      <div className="break-words font-semibold leading-tight text-slate-900">{application.applicant_name}</div>
                      {application.source === 'email_application' && (
                        <span className="mt-1 inline-block rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">Naukri</span>
                      )}
                      {application.cv_filename && (
                        <div className="mt-0.5 line-clamp-2 break-all text-[11px] leading-tight text-slate-400" title={application.cv_filename}>{application.cv_filename}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  <a href={`mailto:${application.applicant_email}`} className="block break-all text-slate-800 hover:text-blue-700 hover:underline">
                    {application.applicant_email}
                  </a>
                  {application.applicant_phone && <div className="mt-0.5 text-[12px] text-slate-500">{application.applicant_phone}</div>}
                  <ContactActions email={application.applicant_email} phone={application.applicant_phone} variant="icons" className="mt-1.5" />
                </td>
                <td className="px-3 py-3.5 text-slate-600">{formatDate(application.application_date)}</td>
                <td className="px-3 py-3.5">
                  <div className="flex items-start gap-1 text-slate-800">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="break-words">{application.location || dash}</span>
                  </div>
                  <div className="mt-1 flex items-start gap-1 text-[12px] text-slate-500">
                    <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-words">{application.nationality || dash}</span>
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-1 text-slate-800">
                    <Briefcase className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    {application.years_of_experience != null ? `${application.years_of_experience} yrs` : dash}
                  </div>
                  <div className="mt-1 flex items-start gap-1 text-[12px] text-slate-500">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-words">{application.notice_period ? `Notice: ${application.notice_period}` : dash}</span>
                  </div>
                </td>
                <td className="px-3 py-3.5 font-semibold text-slate-900">
                  {application.expected_salary != null ? `AED ${application.expected_salary.toLocaleString()}` : dash}
                </td>
                <td className="px-3 py-3.5">
                  {typeof application.match_score === 'number' ? (
                    <MatchScorePill score={application.match_score <= 1 ? application.match_score * 100 : application.match_score} />
                  ) : dash}
                </td>
                <td className="px-3 py-3.5">
                  <div className="flex flex-col items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleViewDetails(application.application_id, application.cv_filename)}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors bg-navy-600 font-semibold text-white hover:bg-navy-700"
                    >
                      <Eye className="h-3.5 w-3.5" /> Details
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const name = application.applicant_name || 'document';
                        setPdfPreview({ cvId: application.application_id, fileName: previewFileName(application.cv_filename, name) });
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-surface-border bg-white px-3 text-[12px] font-medium text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <FileText className="h-3.5 w-3.5" /> PDF
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Right-side panel: Candidate details */}
      {viewingCVData && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-950/30"
            onClick={() => {
              setViewingCVData(null);
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
                            {candidate?.job_title || '-'}
                          </p>
                          <p className="mt-1 text-[12px] text-slate-500">
                            {candidate?.years_of_experience ?? '-'} years · {skills.length} skills
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
          />
        ) : null
      )}
    </div>
  );
}
