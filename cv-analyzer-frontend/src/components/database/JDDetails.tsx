'use client';
import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader2, Search, Copy, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

/* ----------------------------- Small utilities ---------------------------- */
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        return new Date(dateString).toLocaleDateString();
    } catch {
        return 'N/A';
    }
};

const getJDBasics = (jd: any) => {
    const structured = jd.structured_info || {};
    const reqs = jd.job_requirements || {};
    return {
        title: reqs.job_title || structured.job_title || 'Untitled JD',
        years: reqs.years_of_experience || structured.years_of_experience || 'Not specified',
        skills: reqs.skills || structured.skills || [],
        responsibilities: reqs.responsibilities || structured.responsibilities || [],
        skillsCount: reqs.skills_count || (reqs.skills || []).length || 0,
        responsibilitiesCount: reqs.responsibilities_count || (reqs.responsibilities || []).length || 0,
        booleanSearch: jd.boolean_search_string || reqs.boolean_search_string || structured.boolean_search_string || '',
    };
};

const chipClass = 'rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <dt className="section-label">{label}</dt>
            <dd className="mt-0.5 text-[13px] text-gray-900">{value}</dd>
        </div>
    );
}

function Panel({ title, count, children }: { title: string; count?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
                {count != null && <Badge variant="secondary">{count}</Badge>}
            </div>
            {children}
        </div>
    );
}

/* ---------------------------- JD Details --------------------------- */
export function JDDetails({ jdId }: { jdId: string }) {
    const [jd, setJD] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedBoolean, setCopiedBoolean] = useState(false);

    useEffect(() => {
        const loadJD = async () => {
            try {
                setLoading(true);
                setError(null);
                const response = await api.getJDDetails(jdId);
                setJD(response);
            } catch (err: any) {
                setError(err.message || 'Failed to load JD details');
            } finally {
                setLoading(false);
            }
        };
        loadJD();
    }, [jdId]);

    if (loading)
        return (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading JD details...
            </div>
        );
    if (error)
        return (
            <div className="py-8 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                </div>
                <h3 className="text-sm font-medium text-gray-900">Error loading job description</h3>
                <p className="mt-1 text-[13px] text-gray-500">{error}</p>
            </div>
        );
    if (!jd) return <div className="py-8 text-center text-[13px] text-gray-500">Job description not found</div>;

    const b = getJDBasics(jd);

    return (
        <div className="space-y-4">
            {/* Job Info */}
            <Panel title="Job information">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Job title" value={b.title} />
                    <Field label="Experience required" value={`${b.years} years`} />
                    <Field label="Upload date" value={formatDate(jd.upload_date)} />
                    <Field label="Document type" value={jd.document_type || 'jd'} />
                </dl>
            </Panel>

            {/* Naukri Gulf Boolean search string */}
            {b.booleanSearch && (
                <Panel title="Naukri Gulf Boolean search">
                    <p className="mb-2 text-[12px] text-gray-500">
                        Paste this into Naukri Gulf (or a similar portal) to search matching candidates.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            navigator.clipboard?.writeText(b.booleanSearch);
                            setCopiedBoolean(true);
                            setTimeout(() => setCopiedBoolean(false), 2000);
                        }}
                        title="Click to copy"
                        className="flex w-full items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left font-mono text-[12px] leading-relaxed text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                    >
                        <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <span className="flex-1 break-words">{b.booleanSearch}</span>
                        {copiedBoolean ? (
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                        ) : (
                            <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                        )}
                    </button>
                </Panel>
            )}

            {/* Required Skills */}
            <Panel title="Required skills" count={b.skillsCount}>
                {b.skillsCount > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {b.skills.map((s: string, i: number) => (
                            <span key={i} className={chipClass}>
                                {s}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-[13px] text-gray-500">No skills information available</p>
                )}
            </Panel>

            {/* Responsibilities */}
            <Panel title="Responsibilities" count={b.responsibilitiesCount}>
                {b.responsibilitiesCount > 0 ? (
                    <ul className="space-y-1.5">
                        {b.responsibilities.map((r: string, i: number) => (
                            <li key={i} className="flex gap-2 text-[13px] text-gray-700">
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                                <span>{r}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-[13px] text-gray-500">No responsibilities information available</p>
                )}
            </Panel>

            {/* Stats */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Panel title="Processing info">
                    <dl className="space-y-3">
                        <Field label="Model used" value={jd?.processing_metadata?.model_used || 'N/A'} />
                        <Field label="Skills count" value={b.skillsCount} />
                        <Field label="Resp count" value={b.responsibilitiesCount} />
                    </dl>
                </Panel>
                <Panel title="Embeddings">
                    <dl className="space-y-3">
                        <Field label="Dimension" value={jd?.embeddings_info?.embedding_dimension || 'N/A'} />
                        <Field label="Title vector" value={jd?.embeddings_info?.has_title_embedding ? 'Yes' : 'No'} />
                        <Field label="Exp vector" value={jd?.embeddings_info?.has_experience_embedding ? 'Yes' : 'No'} />
                    </dl>
                </Panel>
            </div>
        </div>
    );
}
