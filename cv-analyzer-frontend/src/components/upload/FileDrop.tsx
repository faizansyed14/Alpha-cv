'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, FileText, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileDropProps {
  onFilesAccepted: (files: File[]) => void;
  accept?: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number;
  title: string;
  description: string;
  className?: string;
  multiple?: boolean;
}

export default function FileDrop({
  onFilesAccepted,
  accept = {
    'application/pdf': ['.pdf'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/msword': ['.doc'],
    'text/plain': ['.txt'],
    'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'],
  },
  maxFiles = 200,
  maxSize = 10 * 1024 * 1024, // 10MB
  title,
  description,
  className,
  multiple = true,
}: FileDropProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      onFilesAccepted(acceptedFiles);
    },
    [onFilesAccepted]
  );

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
    fileRejections,
  } = useDropzone({
    onDrop,
    accept,
    maxFiles: multiple ? maxFiles : 1,
    maxSize,
    multiple,
  });

  const hasRejectedFiles = fileRejections.length > 0;

  return (
    <div className={cn('space-y-3', className)}>
      <div
        {...getRootProps()}
        className={cn(
          'dropzone-base',
          isDragActive && !isDragReject && 'dropzone-active',
          isDragReject && 'dropzone-reject',
          !isDragActive && !isDragReject && 'dropzone-idle'
        )}
      >
        <input {...getInputProps()} />

        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-[var(--shadow-sm)] ring-1 ring-slate-200">
          {isDragReject ? (
            <AlertCircle className="h-6 w-6 text-red-500" />
          ) : (
            <UploadCloud className={cn('h-6 w-6', isDragActive ? 'text-brand-600' : 'text-slate-400')} />
          )}
        </div>

        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-[13px] text-slate-500">{description}</p>

        {isDragActive ? (
          <p className="mt-3 text-[13px] font-medium text-brand-600">
            {isDragReject ? 'Some files are not supported' : 'Drop files here…'}
          </p>
        ) : (
          <div className="mt-3 text-xs text-slate-500">
            <p>Drag &amp; drop files here, or click to browse</p>
            <p className="mt-1">Supports: PDF, DOCX, DOC, TXT, Images</p>
            <p className="mt-1">
              Max {multiple ? `${maxFiles} files` : '1 file'}, {Math.round(maxSize / (1024 * 1024))}MB each
            </p>
          </div>
        )}
      </div>

      {/* Rejected Files */}
      {hasRejectedFiles && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-[13px] font-medium text-red-700">Some files were rejected:</span>
          </div>
          <ul className="space-y-1 text-[13px] text-slate-600">
            {fileRejections.map(({ file, errors }) => (
              <li key={file.name} className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                <span>{file.name}</span>
                <span className="text-red-600">({errors.map((e: any) => e.message).join(', ')})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
