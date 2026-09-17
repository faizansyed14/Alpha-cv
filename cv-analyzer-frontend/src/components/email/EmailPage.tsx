'use client';

import { useState, useEffect } from 'react';
import { Mail, RefreshCw, CheckCircle, XCircle, AlertCircle, PlayCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface EmailProcessingStatus {
  is_processing: boolean;
  last_processed: string | null;
  total_processed_today: number;
  successful_today: number;
  failed_today: number;
  next_scheduled_run: string | null;
}

interface EmailHealthCheck {
  azure_connection: boolean;
  mailbox_accessible: boolean;
  access_token_valid: boolean;
  last_successful_processing: string | null;
  error_message: string | null;
}


export default function EmailPage() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingResult, setProcessingResult] = useState<any>(null);
  const [status, setStatus] = useState<EmailProcessingStatus | null>(null);
  const [health, setHealth] = useState<EmailHealthCheck | null>(null);

  // Load initial data
  useEffect(() => {
    loadStatus();
    loadHealth();
  }, []);

  const loadStatus = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/email/status`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to load email status:', error);
    }
  };

  const loadHealth = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/email/health`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setHealth(data);
      }
    } catch (error) {
      console.error('Failed to load email health:', error);
    }
  };


  const processEmails = async () => {
    setIsProcessing(true);
    setProcessingResult(null);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/email/process-emails`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          max_emails: 50,
          force_reprocess: false,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setProcessingResult(data);
        await loadStatus();
        await loadHealth();
      } else {
        const error = await response.json();
        setProcessingResult({
          success: false,
          message: error.detail || 'Failed to process emails',
        });
      }
    } catch (error) {
      setProcessingResult({
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };



  const formatDateTime = (isoString: string | null): string => {
    if (!isoString) return 'Never';
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return 'Invalid date';
    }
  };

  const healthChecks = health
    ? [
        { label: 'Azure Connection', ok: health.azure_connection, okText: 'Connected', failText: 'Disconnected' },
        { label: 'Mailbox Access', ok: health.mailbox_accessible, okText: 'Accessible', failText: 'Not accessible' },
        { label: 'Access Token', ok: health.access_token_valid, okText: 'Valid', failText: 'Invalid' },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="Email CV Processing"
        description="Automatic email processing with backend scheduler"
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => {
              loadHealth();
              loadStatus();
            }}
          >
            Refresh
          </Button>
        }
      />

      {/* Today's statistics */}
      {status && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Processed today" value={status.total_processed_today} icon={Mail} />
          <StatCard label="Successful" value={status.successful_today} icon={CheckCircle} hint="Today" />
          <StatCard label="Failed" value={status.failed_today} icon={XCircle} hint="Today" />
        </div>
      )}

      {/* Automatic processing info */}
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success-50 text-success-600">
          <PlayCircle className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-gray-900">Automatic email processing</p>
            <Badge variant="success">Running</Badge>
          </div>
          <p className="mt-1 text-[13px] text-gray-500">
            The backend automatically checks for new emails every 5 minutes in the background. You can also trigger
            manual processing below for immediate checking.
          </p>
        </div>
      </div>

      {/* Health status */}
      {health && (
        <>
          <p className="section-label mb-2 mt-6">Email service health</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {healthChecks.map((c) => (
              <div
                key={c.label}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
              >
                <div className="flex items-center gap-3">
                  {c.ok ? (
                    <CheckCircle className="h-5 w-5 text-success-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <div>
                    <p className="text-[13px] font-medium text-gray-900">{c.label}</p>
                    <p className="text-xs text-gray-500">{c.ok ? c.okText : c.failText}</p>
                  </div>
                </div>
                <Badge variant={c.ok ? 'success' : 'danger'}>{c.ok ? 'OK' : 'Error'}</Badge>
              </div>
            ))}
          </div>
          {health.error_message && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{health.error_message}</span>
            </div>
          )}
          {health.last_successful_processing && (
            <p className="mt-2 text-xs text-gray-500">
              Last successful processing: {formatDateTime(health.last_successful_processing)}
            </p>
          )}
        </>
      )}

      {/* Manual processing */}
      <p className="section-label mb-2 mt-6">Manual email processing</p>
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <p className="text-[13px] text-gray-500">
          Trigger immediate email processing independently of the automatic scheduler. This will check for new CV
          attachments right now.
        </p>
        <Button
          variant="primary"
          icon={<Mail className="h-4 w-4" />}
          loading={isProcessing}
          onClick={processEmails}
          className="mt-4"
        >
          Process emails now
        </Button>
      </div>

      {/* Processing results */}
      {processingResult && (
        <>
          <p className="section-label mb-2 mt-6">Processing results</p>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-center gap-2">
              {processingResult.success ? (
                <CheckCircle className="h-5 w-5 text-success-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              <Badge variant={processingResult.success ? 'success' : 'danger'}>
                {processingResult.success ? 'Success' : 'Failed'}
              </Badge>
            </div>
            <p className="mt-3 text-[13px] text-gray-700">{processingResult.message}</p>
            {processingResult.processed_count !== undefined && (
              <div className="mt-4 grid grid-cols-3 gap-4">
                <StatCard label="Total processed" value={processingResult.processed_count} />
                <StatCard label="Successful" value={processingResult.successful_count} />
                <StatCard label="Failed" value={processingResult.failed_count} />
              </div>
            )}
            {processingResult.processing_time && (
              <p className="mt-3 text-xs text-gray-500">
                Processing time: {processingResult.processing_time.toFixed(2)}s
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
