'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  User,
  Database,
  BarChart3,
  Users,
  Target,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from './loading';

interface DatabaseViewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FormattedCV {
  id: string;
  name: string;
  filename: string;
  job_title: string;
  skills_count: number;
  experience_years: string | number;
  upload_date: string;
  text_length: number;
  top_skills: string[];
  responsibilities_count: number;
  has_structured_data: boolean;
}

interface FormattedJD {
  id: string;
  filename: string;
  job_title: string;
  required_skills: number;
  required_years: string | number;
  upload_date: string;
  text_length: number;
  top_skills: string[];
  responsibilities_count: number;
  has_structured_data: boolean;
}

interface DatabaseViewData {
  cvs: FormattedCV[];
  jds: FormattedJD[];
  summary: {
    total_documents: number;
    total_cvs: number;
    total_jds: number;
    avg_cv_skills: number;
    avg_jd_skills: number;
    ready_for_matching: boolean;
  };
}

const chipClass = 'rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700';

function StatTile({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="section-label">{label}</div>
          <div className="mt-1.5 text-xl font-semibold leading-7 text-slate-900">{value}</div>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50">
          <Icon className="h-4 w-4 text-brand-600" />
        </div>
      </div>
    </div>
  );
}

function DocRow({
  title,
  processed,
  fields,
  skills,
  skillsLabel,
}: {
  title: string;
  processed: boolean;
  fields: { label: string; value: React.ReactNode }[];
  skills: string[];
  skillsLabel: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center gap-2">
        <User className="h-4 w-4 text-brand-600" />
        <h4 className="text-[13px] font-semibold text-slate-900">{title}</h4>
        <Badge variant={processed ? 'success' : 'warning'} className="ml-auto">
          {processed ? 'Processed' : 'Raw'}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {fields.map((f) => (
          <div key={f.label}>
            <dt className="section-label">{f.label}</dt>
            <dd className="mt-0.5 break-words text-[13px] text-slate-900">{f.value}</dd>
          </div>
        ))}
      </dl>
      {skills.length > 0 && (
        <div className="mt-3">
          <p className="section-label mb-1.5">{skillsLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill, index) => (
              <span key={index} className={chipClass}>
                {skill.length > 30 ? skill.substring(0, 30) + '…' : skill}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DatabaseViewerModal({ isOpen, onClose }: DatabaseViewModalProps) {
  const [data, setData] = useState<DatabaseViewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'cvs' | 'jds'>('overview');

  useEffect(() => {
    if (isOpen) {
      fetchDatabaseView();
    }
  }, [isOpen]);

  const fetchDatabaseView = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.getDatabaseView();
      if (response.success) {
        setData(response.data);
      } else {
        throw new Error('Failed to fetch database view');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load database view');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString || dateString === 'Unknown') return 'Unknown';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const exportData = () => {
    if (!data) return;

    const exportObj = {
      summary: data.summary,
      cvs: data.cvs,
      jds: data.jds,
      exported_at: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alpha_cv_database_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: BarChart3 },
    { id: 'cvs' as const, label: 'CVs', icon: Users },
    { id: 'jds' as const, label: 'Job Descriptions', icon: Target },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-gray-900/10">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50">
              <Database className="h-4 w-4 text-brand-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Database viewer</h2>
              <p className="text-[13px] text-slate-500">Complete overview of stored documents and data</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={exportData} disabled={!data} icon={<Download />}>
              Export
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Close" icon={<X />} />
          </div>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <div className="w-56 shrink-0 border-r border-slate-200 bg-slate-50/60 p-3">
            <div className="space-y-1">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <IconComponent className="h-4 w-4" />
                    <span>{tab.label}</span>
                    {data && (
                      <span
                        className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${
                          isActive ? 'bg-brand-100 text-brand-700' : 'bg-gray-200 text-slate-600'
                        }`}
                      >
                        {tab.id === 'cvs'
                          ? data.summary.total_cvs
                          : tab.id === 'jds'
                          ? data.summary.total_jds
                          : data.summary.total_documents}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <LoadingSpinner size="lg" />
                  <p className="mt-4 text-[13px] text-slate-500">Loading database view...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  </div>
                  <h3 className="text-sm font-medium text-slate-900">Error loading data</h3>
                  <p className="mb-4 mt-1 text-[13px] text-slate-500">{error}</p>
                  <Button variant="primary" size="sm" onClick={fetchDatabaseView}>
                    Try again
                  </Button>
                </div>
              </div>
            ) : data ? (
              <div className="p-5">
                {activeTab === 'overview' && (
                  <div className="space-y-4">
                    <p className="section-label">Database summary</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <StatTile label="CVs" value={data.summary.total_cvs} icon={Users} />
                      <StatTile label="Job descriptions" value={data.summary.total_jds} icon={Target} />
                      <StatTile label="Avg CV skills" value={data.summary.avg_cv_skills.toFixed(1)} icon={BarChart3} />
                      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-sm)]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="section-label">For matching</div>
                            <div className="mt-1.5">
                              <Badge variant={data.summary.ready_for_matching ? 'success' : 'warning'}>
                                {data.summary.ready_for_matching ? 'Ready' : 'Not ready'}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50">
                            <CheckCircle className="h-4 w-4 text-brand-600" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'cvs' && (
                  <div>
                    <p className="section-label mb-4">CV documents ({data.cvs.length})</p>
                    <div className="space-y-3">
                      {data.cvs.map((cv) => (
                        <DocRow
                          key={cv.id}
                          title={cv.name}
                          processed={cv.has_structured_data}
                          skillsLabel="Top skills"
                          skills={cv.top_skills}
                          fields={[
                            { label: 'Job title', value: cv.job_title },
                            { label: 'Experience', value: cv.experience_years },
                            { label: 'Skills', value: cv.skills_count },
                            { label: 'Uploaded', value: formatDate(cv.upload_date) },
                          ]}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'jds' && (
                  <div>
                    <p className="section-label mb-4">Job descriptions ({data.jds.length})</p>
                    <div className="space-y-3">
                      {data.jds.map((jd) => (
                        <DocRow
                          key={jd.id}
                          title={jd.job_title}
                          processed={jd.has_structured_data}
                          skillsLabel="Required skills"
                          skills={jd.top_skills}
                          fields={[
                            { label: 'Filename', value: jd.filename },
                            { label: 'Required years', value: jd.required_years },
                            { label: 'Required skills', value: jd.required_skills },
                            { label: 'Uploaded', value: formatDate(jd.upload_date) },
                          ]}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
