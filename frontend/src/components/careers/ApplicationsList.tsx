'use client';

import { useLayoutEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { User, FileText, Eye, MapPin, Globe, Clock, Briefcase } from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import ContactActions from '@/components/common/ContactActions';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/page';
import { Avatar } from '@/components/ui/avatar';
import { Bone, SkeletonRegion } from '@/components/skeletons';
import { restoreScroll, saveScroll, SCROLL_KEYS } from '@/lib/scrollRestore';
import { useCvPreview } from './CvPreview';

function MatchScorePill({ score }: { score: number }) {
  const variant = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
  return <Badge variant={variant}>{Math.round(score)}%</Badge>;
}

export function CandidateRowsSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-surface-border bg-paper p-4">
          <Bone className="h-9 w-9 rounded-full" />
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

/** The people who applied to the open job: who they are, how to reach them, what they asked for, and their match score once matched. */
export default function ApplicationsList() {
  const router = useRouter();
  const pathname = usePathname();
  const { applications, isLoading } = useCareersStore();
  const preview = useCvPreview();

  // Newest application first.
  const ordered = useMemo(() => {
    const at = (v?: string) => {
      const t = v ? Date.parse(v) : 0;
      return Number.isFinite(t) ? t : 0;
    };
    return [...(applications || [])].sort((x: any, y: any) => at(y?.application_date) - at(x?.application_date));
  }, [applications]);

  useLayoutEffect(() => {
    if (ordered.length === 0) return;
    return restoreScroll(SCROLL_KEYS.applicants) || undefined;
  }, [ordered.length]);

  if (isLoading) return <CandidateRowsSkeleton label="Loading applicants" />;

  if (applications.length === 0) {
    return (
      <EmptyState
        icon={User}
        title="No applicants yet"
        hint="Share the public application link (under Job details) to start receiving applications. Meanwhile, the Database matches tab shows people you already have who fit this job."
      />
    );
  }

  const dash = <span className="text-slate-300">-</span>;
  const th = 'px-3 py-2.5 text-left text-xs font-medium text-slate-500';

  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-surface-border bg-white shadow-card">
        <table className="w-full min-w-[860px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[9%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[6%]" />
            <col className="w-[9%]" />
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
              <th className={`${th} text-right`}>Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ordered.map((application: any) => (
              <tr key={application.application_id} data-scroll-id={application.application_id} className="align-top transition-colors hover:bg-slate-50/70">
                <td className="px-3 py-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Avatar name={application.applicant_name} />
                    <div className="min-w-0">
                      <div className="break-words font-semibold leading-tight text-slate-900">{application.applicant_name}</div>
                      {application.cv_filename && (
                        <div className="mt-0.5 line-clamp-1 break-all text-[11px] leading-tight text-slate-400" title={application.cv_filename}>{application.cv_filename}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <a href={`mailto:${application.applicant_email}`} className="block break-all text-slate-800 hover:text-navy-700 hover:underline">
                    {application.applicant_email}
                  </a>
                  {application.applicant_phone && <div className="mt-0.5 text-[12px] text-slate-500">{application.applicant_phone}</div>}
                  <ContactActions email={application.applicant_email} phone={application.applicant_phone} linkedin={application.linkedin_url} github={application.github_url} variant="icons" className="mt-1.5" />
                </td>
                <td className="px-3 py-3 text-slate-600">{new Date(application.application_date).toLocaleDateString()}</td>
                <td className="px-3 py-3">
                  <div className="flex items-start gap-1 text-slate-800">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-words">{application.location || dash}</span>
                  </div>
                  <div className="mt-1 flex items-start gap-1 text-[12px] text-slate-500">
                    <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-words">{application.nationality || dash}</span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1 text-slate-800">
                    <Briefcase className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    {application.years_of_experience != null ? `${application.years_of_experience} yrs` : dash}
                  </div>
                  <div className="mt-1 flex items-start gap-1 text-[12px] text-slate-500">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-words">{application.notice_period ? `Notice: ${application.notice_period}` : dash}</span>
                  </div>
                </td>
                <td className="px-3 py-3 font-semibold text-slate-800">
                  {application.expected_salary != null ? `AED ${Number(application.expected_salary).toLocaleString()}` : dash}
                </td>
                <td className="px-3 py-3">
                  {typeof application.match_score === 'number' ? (
                    <MatchScorePill score={application.match_score <= 1 ? application.match_score * 100 : application.match_score} />
                  ) : dash}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        saveScroll(SCROLL_KEYS.applicants, application.application_id);
                        router.push(`/candidates/${application.application_id}?from=${encodeURIComponent((pathname || '/careers') + window.location.search)}`);
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-navy-900 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-navy-800"
                    >
                      <Eye className="h-3.5 w-3.5" /> Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => preview.open(application.application_id, application.cv_filename, application.applicant_name)}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-surface-border bg-white px-2.5 text-[12px] font-medium text-slate-700 transition-colors hover:border-navy-200 hover:bg-navy-50 hover:text-navy-700"
                    >
                      <FileText className="h-3.5 w-3.5" /> CV
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.element}
    </div>
  );
}
