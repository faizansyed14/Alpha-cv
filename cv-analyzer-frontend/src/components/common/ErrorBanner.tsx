'use client';

import { AlertCircle, X } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

interface ErrorBannerProps {
  error: string;
  operation: string;
}

export default function ErrorBanner({ error, operation }: ErrorBannerProps) {
  const { clearError } = useAppStore();

  const handleDismiss = () => {
    clearError(operation as any);
  };

  const getOperationLabel = (op: string) => {
    switch (op) {
      case 'cvs':
        return 'CV Loading';
      case 'jds':
        return 'JD Loading';
      case 'upload':
        return 'File Upload';
      case 'matching':
        return 'Candidate Matching';
      case 'health':
        return 'System Health';
      default:
        return 'Operation';
    }
  };

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
    >
      <div className="flex items-start gap-2 text-[13px] text-red-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <strong className="font-semibold">{getOperationLabel(operation)} Error:</strong> {error}
        </div>
      </div>
      <button
        onClick={handleDismiss}
        className="rounded-md p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
