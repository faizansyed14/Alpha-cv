'use client';
import React, { useState, useEffect } from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import ContactActions from '@/components/common/ContactActions';

/* ----------------------------- Small utilities ---------------------------- */
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        return new Date(dateString).toLocaleDateString();
    } catch {
        return 'N/A';
    }
};

const getCVBasics = (cv: any) => {
    const structured = cv.structured_info || {};
    const cand = cv.candidate || {};
    return {
        name: structured.full_name || structured.name || cand.name || 'Unknown Candidate',
        title: structured.job_title || cand.title || 'Not specified',
        years: structured.years_of_experience || cand.years_of_experience || '0',
        skillsCount: (structured.skills || cand.skills || []).length,
        respCount: (structured.responsibilities || cand.responsibilities || []).length,
    };
};

const chipClass = 'rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <dt className="section-label">{label}</dt>
            <dd className="mt-0.5 break-words text-[13px] text-gray-900">{value}</dd>
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

/* ---------------------------- CV Details --------------------------- */
export function CVDetails({ cvId }: { cvId: string }) {
    const [cv, setCV] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadCV = async () => {
            try {
                setLoading(true);
                setError(null);
                const response = await api.getCVDetails(cvId);
                setCV(response);
            } catch (err: any) {
                setError(err.message || 'Failed to load CV details');
            } finally {
                setLoading(false);
            }
        };
        loadCV();
    }, [cvId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading CV details...
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-12 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                </div>
                <h3 className="text-sm font-medium text-gray-900">Error loading CV</h3>
                <p className="mt-1 text-[13px] text-gray-500">{error}</p>
            </div>
        );
    }

    if (!cv) {
        return (
            <div className="py-12 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                    <FileText className="h-5 w-5 text-gray-400" />
                </div>
                <h3 className="text-sm font-medium text-gray-900">CV not found</h3>
                <p className="mt-1 text-[13px] text-gray-500">The requested CV could not be found.</p>
            </div>
        );
    }

    const b = getCVBasics(cv);
    const email =
        cv.structured_info?.contact_info?.email ||
        cv.structured_info?.email ||
        cv.candidate?.contact_info?.email ||
        cv.job_application?.applicant_email ||
        null;
    const phone =
        cv.structured_info?.contact_info?.phone ||
        cv.structured_info?.phone ||
        cv.candidate?.contact_info?.phone ||
        cv.job_application?.applicant_phone ||
        null;
    const skills = cv?.candidate?.skills || cv?.skills || [];
    const responsibilities = cv?.candidate?.responsibilities || cv?.responsibilities || [];

    return (
        <div className="space-y-4">
            {/* Header / overview */}
            <Panel title="Overview">
                <div className="mb-4">
                    <h2 className="text-base font-semibold text-gray-900">{b.name}</h2>
                    <p className="mt-0.5 text-[13px] text-gray-600">{b.title}</p>
                </div>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Experience" value={`${b.years} years`} />
                    <Field label="CV ID" value={`#${cvId.slice(-8)}`} />
                    <Field label="Uploaded" value={formatDate(cv?.upload_date)} />
                    <Field label="Category" value={cv.structured_info?.category ?? 'General'} />
                </dl>
                {(email || phone) && (
                    <div className="mt-4">
                        <p className="section-label mb-1.5">Contact</p>
                        <ContactActions email={email} phone={phone} privacy />
                    </div>
                )}
            </Panel>

            {/* Skills */}
            <Panel title="Skills" count={`${b.skillsCount} skills`}>
                {skills.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {skills.map((skill: string, i: number) => (
                            <span key={i} className={chipClass}>
                                {skill}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-[13px] text-gray-500">No skills information available</p>
                )}
            </Panel>

            {/* Experience & Responsibilities */}
            <Panel title="Experience & responsibilities" count={`${b.respCount} items`}>
                {responsibilities.length ? (
                    <ul className="space-y-1.5">
                        {responsibilities.map((resp: string, i: number) => (
                            <li key={i} className="flex gap-2 text-[13px] text-gray-700">
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                                <span>{resp}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-[13px] text-gray-500">No responsibilities information available</p>
                )}
            </Panel>

            {/* Tech / system info */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel title="AI processing">
                    <dl className="space-y-3">
                        <Field label="Skills embeddings" value={cv?.embeddings_info?.skills_embeddings || 0} />
                        <Field
                            label="Responsibilities embeddings"
                            value={cv?.embeddings_info?.responsibilities_embeddings || 0}
                        />
                        <Field label="Model used" value={cv?.processing_metadata?.model_used || 'N/A'} />
                    </dl>
                </Panel>
                <Panel title="System info">
                    <dl className="space-y-3">
                        <Field label="Title embedding" value={cv?.embeddings_info?.has_title_embedding ? 'Yes' : 'No'} />
                        <Field
                            label="Experience embedding"
                            value={cv?.embeddings_info?.has_experience_embedding ? 'Yes' : 'No'}
                        />
                        <Field label="Embedding dimension" value={cv?.embeddings_info?.embedding_dimension || 'N/A'} />
                    </dl>
                </Panel>
            </div>
        </div>
    );
}
