'use client';
import React, { useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  UploadCloud,
  FileText,
  Users,
  CheckCircle,
  Clock,
  AlertCircle,
  X,
  Loader2,
  Play,
  Eye,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useUploadQueue } from '@/stores/uploadQueue';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
/**
 * UploadPage
 * - Uses a persisted Zustand queue (useUploadQueue) so items don't "disappear" on navigation.
 * - Processes JD files first, then CV files.
 * - After successful uploads, refreshes DB lists and enables "Start Matching".
 */
export default function UploadPage() {
  const { go } = useWorkspaceNav();
  const {
    loadingStates,
    loadCVs,
    loadJDs,
    cvs,
    jds,
    selectJD,
    selectCV,
    runMatch,
    deselectAllCVs,
  } = useAppStore();
  const { items, addMany, update, remove, clearAll } = useUploadQueue();
  const isUploading = loadingStates.upload.isLoading;
  // Split queue by kind
  const cvItems = useMemo(() => items.filter((i) => i.kind === 'cv'), [items]);
  const jdItems = useMemo(() => items.filter((i) => i.kind === 'jd'), [items]);
  // Counts
  const totalFiles = items.length;
  const completedCVs = cvItems.filter((f) => f.status === 'completed').length;
  const completedJDs = jdItems.filter((f) => f.status === 'completed').length;
  const completedFiles = completedCVs + completedJDs;
  // DB availability vs local completion (to enable next step)
  const hasDBData = (cvs?.length ?? 0) > 0 && (jds?.length ?? 0) > 0;
  const hasLocalCompletedBoth = completedCVs > 0 && completedJDs > 0;
  const canContinue = hasDBData || hasLocalCompletedBoth;

  /* --------------------------------- Duplicates Detection --------------------------------- */
  const hasDuplicates = useMemo(() => {
    const fileMap = new Map<string, boolean>();

    for (const item of items) {
      const key = `${item.kind}-${item.name}`;
      if (fileMap.has(key)) {
        return true;
      }
      fileMap.set(key, true);
    }
    return false;
  }, [items]);

  const removeDuplicates = useCallback(() => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    // First pass: identify duplicates
    for (const item of items) {
      const key = `${item.kind}-${item.name}`;
      if (seen.has(key)) {
        duplicates.push(item.id);
      } else {
        seen.set(key, item.id);
      }
    }

    // Remove duplicates
    if (duplicates.length > 0) {
      if (confirm(`Remove ${duplicates.length} duplicate file(s)?`)) {
        duplicates.forEach((id) => remove(id));
      }
    }
  }, [items, remove]);

  /* --------------------------------- Dropzones --------------------------------- */
  const onCVDrop = useCallback((accepted: File[]) => addMany('cv', accepted), [addMany]);
  const onJDDrop = useCallback((accepted: File[]) => addMany('jd', accepted), [addMany]);
  const {
    getRootProps: getCVRootProps,
    getInputProps: getCVInputProps,
    isDragActive: isCVDragActive,
    isDragReject: isCVDragReject,
  } = useDropzone({
    onDrop: onCVDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'text/plain': ['.txt'],
      'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'],
    },
    maxFiles: 200,
    maxSize: 10 * 1024 * 1024,
  });
  const {
    getRootProps: getJDRootProps,
    getInputProps: getJDInputProps,
    isDragActive: isJDDragActive,
    isDragReject: isJDDragReject,
  } = useDropzone({
    onDrop: onJDDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'text/plain': ['.txt'],
      'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'],
    },
    maxFiles: 5,
    maxSize: 10 * 1024 * 1024,
  });
  /* ----------------------------- Processing uploads ----------------------------- */
  const processFiles = async () => {
    // Process JD files first
    for (const f of jdItems.filter((x) => x.status === 'pending' && !!x.file)) {
      update(f.id, { status: 'processing', error: undefined });
      try {
        const response = await api.uploadJD(f.file as File);

        // Extract the ID from the response - handle different response formats
        let dbId: string | undefined = undefined;
        if (response && response.jd_id) {
          dbId = response.jd_id;
        } else if (response && response.cv_id) {
          dbId = response.cv_id;
        }

        update(f.id, {
          status: 'completed',
          extractedData: {
            jobTitle: 'JD Processed',
            years: 'Requirements extracted',
            skills: ['JD uploaded'],
            responsibilities: ['Data available in database'],
          },
          dbId: dbId, // Store the database ID
        });
      } catch (err: any) {
        console.error('JD upload error:', err);
        update(f.id, {
          status: 'error',
          error: err?.message || 'Processing failed',
        });
      }
    }
    // Then CV files
    for (const f of cvItems.filter((x) => x.status === 'pending' && !!x.file)) {
      update(f.id, { status: 'processing', error: undefined });
      try {
        const response = await api.uploadCV(f.file as File);

        // Extract the ID from the response - handle different response formats
        let dbId: string | undefined = undefined;
        if (response && response.cv_id) {
          dbId = response.cv_id;
        } else if (response && response.jd_id) {
          dbId = response.jd_id;
        }

        update(f.id, {
          status: 'completed',
          extractedData: {
            name: 'CV Processed',
            jobTitle: 'Data extracted successfully',
            years: 'Processing complete',
            skills: ['CV uploaded'],
            responsibilities: ['Data available in database'],
          },
          dbId: dbId, // Store the database ID
        });
      } catch (err: any) {
        console.error('CV upload error:', err);
        update(f.id, {
          status: 'error',
          error: err?.message || 'Processing failed',
        });
      }
    }
    // Refresh DB lists
    await loadCVs();
    await loadJDs();
  };
  /* ----------------------- Match Only Uploaded Files ----------------------- */
  const handleMatchUploadedOnly = async () => {
    console.log('=== handleMatchUploadedOnly called ===');

    // Get completed items with database IDs
    const completedJDs = jdItems.filter((f) => f.status === 'completed' && f.dbId);
    const completedCVs = cvItems.filter((f) => f.status === 'completed' && f.dbId);
    console.log('Completed JDs with dbId:', completedJDs);
    console.log('Completed CVs with dbId:', completedCVs);
    // Fallback: if no items have dbId, try to match by filename
    if (completedJDs.length === 0 && completedCVs.length === 0) {
      const completedJDsNoId = jdItems.filter((f) => f.status === 'completed');
      const completedCVsNoId = cvItems.filter((f) => f.status === 'completed');

      if (completedJDsNoId.length === 0) {
        alert('No completed Job Descriptions to match');
        return;
      }
      if (completedCVsNoId.length === 0) {
        alert('No completed CVs to match');
        return;
      }
      // Try to find matching documents in the database by filename
      const jdFilename = completedJDsNoId[0].name;
      const cvFilenames = completedCVsNoId.map((f) => f.name);
      // Find JD in database by filename
      const jdInDB = jds.find((jd) => jd.filename === jdFilename);
      if (!jdInDB) {
        alert(`Could not find Job Description "${jdFilename}" in the database`);
        return;
      }
      // Find CVs in database by filename
      const cvIdsInDB: string[] = [];
      for (const cvFilename of cvFilenames) {
        const cvInDB = cvs.find((cv) => cv.filename === cvFilename);
        if (cvInDB) {
          cvIdsInDB.push(cvInDB.id);
        }
      }
      if (cvIdsInDB.length === 0) {
        alert('Could not find any uploaded CVs in the database');
        return;
      }
      // Set selections in the store
      selectJD(jdInDB.id);
      deselectAllCVs(); // Clear existing selections
      cvIdsInDB.forEach((id) => selectCV(id)); // Select only uploaded CVs
      // Run matching and navigate to results
      await runMatch();
      go('match');
      return;
    }
    // Original logic for when we have dbIds
    if (completedJDs.length === 0) {
      alert('No completed Job Descriptions to match');
      return;
    }
    if (completedCVs.length === 0) {
      alert('No completed CVs to match');
      return;
    }
    // Use the first completed JD
    const jdId = completedJDs[0].dbId;
    const cvIds = completedCVs.map((f) => f.dbId).filter(Boolean) as string[];
    // Set selections in the store
    selectJD(jdId || null);
    deselectAllCVs(); // Clear existing selections
    cvIds.forEach((id) => selectCV(id)); // Select only uploaded CVs
    // Run matching and navigate to results
    await runMatch();
    go('match');
  };
  /* ---------------------------------- UI utils ---------------------------------- */
  const removeFile = (id: string) => {
    remove(id);
  };

  const sizeMB = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '0.0';
    return (bytes / 1024 / 1024).toFixed(1);
  };

  const anyProcessing = items.some((f) => f.status === 'processing');

  // Helper to get status text for files
  const getStatusText = (file: any) => {
    if (file.status === 'completed') {
      return file.extractedData
        ? `${file.extractedData.name || file.extractedData.jobTitle || 'Processed'} • ${file.extractedData.years || ''}`
        : 'Processed';
    }
    if (file.status === 'error') {
      return `Error: ${file.error || 'Processing failed'}`;
    }
    if (file.status === 'processing') {
      return file.kind === 'cv' ? 'Extracting candidate info...' : 'Extracting requirements...';
    }
    return 'Not extracted';
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="success">
            <CheckCircle className="h-3 w-3" /> Done
          </Badge>
        );
      case 'processing':
        return (
          <Badge variant="info">
            <Loader2 className="h-3 w-3 animate-spin" /> Processing
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="danger">
            <AlertCircle className="h-3 w-3" /> Error
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3" /> Queued
          </Badge>
        );
    }
  };

  const dropzoneClass = (active: boolean, reject: boolean) =>
    `dropzone-base ${
      reject ? 'dropzone-reject' : active ? 'dropzone-active' : 'dropzone-idle'
    }`;

  const FileRow = ({
    file,
    icon: Icon,
  }: {
    file: any;
    icon: React.ComponentType<{ className?: string }>;
  }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-[var(--shadow-sm)] transition-shadow duration-[var(--duration-fast)] hover:shadow-[var(--shadow-md)]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100">
          <Icon className="h-4 w-4 text-slate-500" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-slate-900">{file.name}</div>
          <div className="truncate text-xs text-slate-500">
            {getStatusText(file)}
            {file.dbId && <span className="ml-2 text-green-600">(ID: {file.dbId?.substring(0, 8)}…)</span>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {statusBadge(file.status)}
        <span className="text-xs text-slate-500">{sizeMB(file.size)}MB</span>
        <button
          onClick={() => removeFile(file.id)}
          disabled={file.status === 'processing'}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-50"
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Upload documents"
        description="Add candidate CVs and job descriptions to start AI-powered matching."
      />

      {/* Upload Zones */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* CV Upload Zone */}
        <div className="surface-panel p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50">
              <Users className="h-4 w-4 text-brand-600" />
            </span>
            <div>
              <h3 className="text-[13px] font-semibold text-slate-900">Candidate CVs</h3>
              <p className="text-xs text-slate-500">Upload resumes for processing and matching</p>
            </div>
          </div>
          <div {...getCVRootProps()} className={dropzoneClass(isCVDragActive, isCVDragReject)}>
            <input {...getCVInputProps()} />
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <UploadCloud className="h-6 w-6 text-slate-400" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900">Drop CV files here</h4>
            <p className="mt-1 text-[13px] text-slate-500">PDF, DOCX, TXT</p>
            <p className="mt-2 text-xs text-slate-400">Drag &amp; drop or click to browse · Max 200 files, 10MB each</p>
            <div className="mt-3">
              <Button variant="secondary" size="sm" type="button">
                Browse files
              </Button>
            </div>
          </div>
        </div>
        {/* JD Upload Zone */}
        <div className="surface-panel p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50">
              <FileText className="h-4 w-4 text-brand-600" />
            </span>
            <div>
              <h3 className="text-[13px] font-semibold text-slate-900">Job descriptions</h3>
              <p className="text-xs text-slate-500">Upload job requirements for matching</p>
            </div>
          </div>
          <div {...getJDRootProps()} className={dropzoneClass(isJDDragActive, isJDDragReject)}>
            <input {...getJDInputProps()} />
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <UploadCloud className="h-6 w-6 text-slate-400" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900">Drop JD files here</h4>
            <p className="mt-1 text-[13px] text-slate-500">PDF, DOCX, TXT</p>
            <p className="mt-2 text-xs text-slate-400">Drag &amp; drop or click to browse · Max 5 files, 10MB each</p>
            <div className="mt-3">
              <Button variant="secondary" size="sm" type="button">
                Browse files
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Processing Queue */}
      {totalFiles > 0 && (
        <div className="mt-4 surface-panel p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[13px] font-semibold text-slate-900">Processing queue</h3>
              <p className="text-xs text-slate-500">
                {completedFiles} of {totalFiles} files processed
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={processFiles} loading={isUploading} icon={<Upload />}>
                {isUploading ? 'Processing…' : 'Extract all'}
              </Button>
              {hasDuplicates && (
                <Button
                  onClick={removeDuplicates}
                  disabled={isUploading || anyProcessing}
                  variant="secondary"
                  icon={<Trash2 />}
                  title="Remove duplicate files"
                >
                  Remove duplicates
                </Button>
              )}
              <Button onClick={clearAll} disabled={isUploading || anyProcessing} variant="secondary" icon={<X />}>
                Clear all
              </Button>
            </div>
          </div>

          {/* Duplicate warning */}
          {hasDuplicates && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-[13px] font-medium text-amber-800">Duplicate files detected</p>
                <p className="text-[13px] text-amber-700">
                  You have uploaded the same file multiple times. Use &quot;Remove duplicates&quot; to keep only the
                  first occurrence of each file.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {jdItems.map((file) => (
              <FileRow key={file.id} file={file} icon={FileText} />
            ))}
            {cvItems.map((file) => (
              <FileRow key={file.id} file={file} icon={Users} />
            ))}
          </div>
        </div>
      )}

      {/* Debug Info - Remove in production */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h4 className="text-[13px] font-medium text-amber-800">Debug info:</h4>
          <p className="text-[13px] text-amber-700">
            Queue items: {items.length} (JDs: {jdItems.length}, CVs: {cvItems.length})
          </p>
          <p className="text-[13px] text-amber-700">
            Completed JDs with dbId: {jdItems.filter((f) => f.status === 'completed' && f.dbId).length}
          </p>
          <p className="text-[13px] text-amber-700">
            Completed CVs with dbId: {cvItems.filter((f) => f.status === 'completed' && f.dbId).length}
          </p>
          <p className="text-[13px] text-amber-700">Has duplicates: {hasDuplicates ? 'Yes' : 'No'}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] font-medium text-amber-800">Queue details</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-amber-100 p-2 text-xs">
              {JSON.stringify(items, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Next Steps */}
      {canContinue && (
        <div className="mt-4 flex flex-col items-start justify-between gap-4 surface-panel p-4 sm:p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-success-50 text-success-600">
              <CheckCircle className="h-[18px] w-[18px]" />
            </span>
            <div>
              <h4 className="text-[13px] font-semibold text-slate-900">Documents ready</h4>
              <p className="text-[13px] text-slate-500">
                {hasDBData
                  ? `Database has ${cvs.length} CV(s) and ${jds.length} JD(s).`
                  : `${completedFiles} file(s) uploaded and processed`}
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button onClick={() => go('candidates')} variant="secondary" icon={<Eye />}>
              Review database
            </Button>
            <Button
              onClick={handleMatchUploadedOnly}
              loading={loadingStates.matching?.isLoading}
              disabled={
                loadingStates.matching?.isLoading ||
                !(jdItems.some((f) => f.status === 'completed') || cvItems.some((f) => f.status === 'completed'))
              }
              icon={<Play />}
              title="Match only the files uploaded in this session"
            >
              {loadingStates.matching?.isLoading ? 'Matching…' : 'Match uploaded files'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
/**
 * NOTE:
 * This component expects a persisted upload-queue store at:
 *   `@/stores/uploadQueue`
 * with the API:
 *   - items: { id, name, size?, status: 'pending'|'processing'|'completed'|'error', error?, extractedData?, file?, kind: 'cv'|'jd', dbId? }[]
 *   - addMany(kind: 'cv'|'jd', files: File[]): void
 *   - update(id: string, patch: Partial<Item>): void
 *   - remove(id: string): void
 *   - clearAll(): void
 * See the store implementation I outlined earlier for a drop-in version.
 */
