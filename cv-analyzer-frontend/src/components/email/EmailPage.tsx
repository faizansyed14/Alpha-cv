'use client';

import { useState, useEffect } from 'react';
import { Mail, RefreshCw, CheckCircle, XCircle, AlertCircle, PlayCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { emailService } from '@/services/emailService';

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

  useEffect(() => {
    loadStatus();
    loadHealth();
  }, []);

  const loadStatus = async () => {
    try {
      const data = await emailService.getStatus();
      setStatus(data);
    } catch (error) {
      console.error('Failed to load email status:', error);
    }
  };

  const loadHealth = async () => {
    try {
      const data = await emailService.getHealth();
      setHealth(data);
    } catch (error) {
      console.error('Failed to load email health:', error);
    }
  };

  const processEmails = async () => {
    setIsProcessing(true);
    setProcessingResult(null);

    try {
      const data = await emailService.processEmails({ maxEmails: 50, forceReprocess: false });
      setProcessingResult(data);
      await loadStatus();
      await loadHealth();
    } catch (error) {
      setProcessingResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email CV Processing"
        description="Monitor and trigger inbound email CV ingestion"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { loadStatus(); loadHealth(); }} icon={<RefreshCw className="h-4 w-4" />}>
              Refresh
            </Button>
            <Button onClick={processEmails} disabled={isProcessing} icon={<PlayCircle className="h-4 w-4" />}>
              {isProcessing ? 'Processing…' : 'Process emails'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Processed today"
          value={status?.total_processed_today ?? '—'}
          icon={Mail}
          hint="Emails handled"
        />
        <StatCard
          label="Successful"
          value={status?.successful_today ?? '—'}
          icon={CheckCircle}
          hint="CVs extracted"
        />
        <StatCard
          label="Failed"
          value={status?.failed_today ?? '—'}
          icon={XCircle}
          hint="Need attention"
        />
        <StatCard
          label="Status"
          value={status?.is_processing ? 'Running' : 'Idle'}
          icon={AlertCircle}
          hint={status?.last_processed ? `Last: ${status.last_processed}` : 'No recent run'}
        />
      </div>

      {health && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[var(--shadow-sm)]">
          <p className="section-label mb-3">Connection health</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={health.azure_connection ? 'default' : 'destructive'}>
              Azure {health.azure_connection ? 'OK' : 'Down'}
            </Badge>
            <Badge variant={health.mailbox_accessible ? 'default' : 'destructive'}>
              Mailbox {health.mailbox_accessible ? 'OK' : 'Down'}
            </Badge>
            <Badge variant={health.access_token_valid ? 'default' : 'destructive'}>
              Token {health.access_token_valid ? 'Valid' : 'Invalid'}
            </Badge>
          </div>
          {health.error_message && (
            <p className="mt-3 text-[13px] text-red-600">{health.error_message}</p>
          )}
        </div>
      )}

      {processingResult && (
        <div
          className={`rounded-lg border p-4 text-[13px] ${
            processingResult.success === false
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {processingResult.message || JSON.stringify(processingResult)}
        </div>
      )}
    </div>
  );
}
