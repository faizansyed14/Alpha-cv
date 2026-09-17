'use client';

import { X, User, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { formatDate } from '@/lib/utils';
import { CVListItem, JDListItem } from '@/lib/types';

interface StructuredPreviewProps {
  item: (CVListItem | JDListItem) & { type: 'cv' | 'jd' };
  onClose: () => void;
}

const chipClass = 'rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="section-label">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-gray-900">{value}</dd>
    </div>
  );
}

export default function StructuredPreview({ item, onClose }: StructuredPreviewProps) {
  const isCV = item.type === 'cv';
  const cvItem = isCV ? (item as CVListItem) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4">
      <Card className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between border-b border-gray-200">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              {isCV ? (
                <User className="h-4 w-4 text-brand-600" />
              ) : (
                <Briefcase className="h-4 w-4 text-brand-600" />
              )}
              <span className="truncate">{isCV ? cvItem?.full_name : item.job_title}</span>
            </CardTitle>
            <p className="mt-1 text-[13px] text-gray-500">
              {item.filename} &middot; Uploaded {formatDate(item.upload_date)}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} icon={<X />} aria-label="Close" />
        </CardHeader>

        <CardContent className="overflow-y-auto pt-4">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="skills">Skills &amp; Responsibilities</TabsTrigger>
              <TabsTrigger value="raw">Raw Data</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <h3 className="mb-3 text-[13px] font-semibold text-gray-900">Document info</h3>
                  <dl className="space-y-3">
                    <Field label="Type" value={isCV ? 'Curriculum Vitae' : 'Job Description'} />
                    <Field label="Filename" value={item.filename} />
                    <Field label="Upload date" value={formatDate(item.upload_date)} />
                    <Field label="Content length" value={`${item.text_length} characters`} />
                    <div>
                      <dt className="section-label">Processing status</dt>
                      <dd className="mt-1">
                        <Badge variant={item.has_structured_data ? 'success' : 'secondary'}>
                          {item.has_structured_data ? 'Processed' : 'Pending'}
                        </Badge>
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <h3 className="mb-3 text-[13px] font-semibold text-gray-900">Professional info</h3>
                  <dl className="space-y-3">
                    {isCV && cvItem && <Field label="Full name" value={cvItem.full_name} />}
                    <Field label="Job title" value={item.job_title} />
                    <Field label="Years of experience" value={item.years_of_experience} />
                  </dl>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <h3 className="mb-3 text-[13px] font-semibold text-gray-900">Content summary</h3>
                <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Skills count" value={`${item.skills_count} skills`} />
                  <Field label="Responsibilities count" value={`${item.responsibilities_count} responsibilities`} />
                </dl>
              </div>
            </TabsContent>

            <TabsContent value="skills" className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-gray-900">Skills</h3>
                    <Badge variant="secondary">{item.skills_count}</Badge>
                  </div>
                  {item.skills && item.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.skills.slice(0, 20).map((skill, index) => (
                        <span key={index} className={chipClass}>
                          {skill}
                        </span>
                      ))}
                      {item.skills.length > 20 && (
                        <span className="text-xs text-gray-500">+{item.skills.length - 20} more</span>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px] text-gray-500">No skills data available</p>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-gray-900">Responsibilities</h3>
                    <Badge variant="secondary">{item.responsibilities_count}</Badge>
                  </div>
                  <p className="text-[13px] text-gray-500">
                    Responsibility details would be displayed here based on the structured data format.
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="raw" className="mt-5 space-y-4">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <h3 className="mb-3 text-[13px] font-semibold text-gray-900">Raw document data</h3>
                <div className="space-y-3">
                  <div>
                    <dt className="section-label">Document ID</dt>
                    <dd className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-700">
                      {item.id}
                    </dd>
                  </div>
                  <div>
                    <dt className="section-label">Structured data available</dt>
                    <dd className="mt-0.5 text-[13px]">
                      {item.has_structured_data ? (
                        <span className="text-green-600">Yes — document has been processed</span>
                      ) : (
                        <span className="text-amber-600">No — document pending processing</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="section-label">Content preview</dt>
                    <dd className="mt-1 max-h-32 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-[13px] text-gray-700">
                      Raw content would be displayed here. This would include the extracted text and structured
                      information returned by the backend API.
                    </dd>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
