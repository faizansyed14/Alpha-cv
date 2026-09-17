'use client';
import React, { useState } from 'react';
import {
  Server,
  Database,
  Activity,
  Cpu,
  Trash2,
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'warning' | 'error';
  message?: string;
  metrics?: {
    [key: string]: any;
  };
}

export default function SystemPanel() {
  const {
    systemHealth,
    systemStats,
    databaseView,
    loadSystemHealth,
    loadSystemStats,
    loadDatabaseView
  } = useAppStore();

  const { user } = useAuthStore();

  const [showClearDialog, setShowClearDialog] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [serviceDetails, setServiceDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Format timestamp to readable date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  // Map a status string to a Badge variant
  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'success' as const;
      case 'warning':
        return 'warning' as const;
      case 'error':
        return 'danger' as const;
      default:
        return 'secondary' as const;
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-4 w-4 text-success-600" />;
      case 'warning':
        return <Clock className="h-4 w-4 text-amber-600" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  // Handle service details click
  const handleServiceClick = async (serviceName: string) => {
    if (selectedService === serviceName) {
      setSelectedService(null);
      setServiceDetails(null);
      return;
    }

    setSelectedService(serviceName);
    setLoadingDetails(true);

    try {
      // Simulate fetching service details
      await new Promise(resolve => setTimeout(resolve, 500));

      // Mock service details based on service name
      const mockDetails = {
        qdrant: {
          version: '1.7.4',
          collections: 3,
          total_points: systemStats?.stats?.database_stats?.total_documents || 0,
          memory_usage: '1.2 GB',
          disk_usage: '2.5 GB',
          uptime: '15d 4h 32m',
          config: {
            host: 'localhost',
            port: 6333,
            grpc_port: 6334,
          }
        },
        embedding: {
          model: 'all-mpnet-base-v2',
          dimension: 768,
          provider: 'sentence-transformers',
          device: 'cpu',
          cache_size: 1000,
          avg_request_time: '120ms'
        },
        cache: {
          provider: 'Redis',
          version: '7.0.5',
          memory_usage: '512 MB',
          hit_rate: '94.2%',
          keyspace_hits: 15420,
          keyspace_misses: 952
        }
      };

      setServiceDetails(mockDetails[serviceName as keyof typeof mockDetails]);
    } catch (error) {
      console.error('Failed to fetch service details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Handle clear database
  const handleClearDatabase = async () => {
    setIsClearing(true);
    try {
      const { token } = useAuthStore.getState();
      if (!token) {
        throw new Error('No authentication token found');
      }
      await api.clearDatabase(token, true);
      // Refresh data
      await loadSystemStats();
      await loadDatabaseView();
      setShowClearDialog(false);
    } catch (error: any) {
      console.error('Failed to clear database:', error);
    } finally {
      setIsClearing(false);
    }
  };

  // Check if user is admin
  const isAdmin = user?.role === 'admin';

  // Service health status
  const services: ServiceStatus[] = [
    {
      name: 'Qdrant',
      status: systemHealth?.services?.qdrant?.status === 'ok' ? 'healthy' : 'error',
      message: systemHealth?.services?.qdrant?.message || 'Vector database service',
      metrics: {
        collections: systemHealth?.services?.qdrant?.collections_count || 0,
        points: systemHealth?.services?.qdrant?.points_count || 0
      }
    },
    {
      name: 'Embedding',
      status: systemHealth?.services?.embedding?.status === 'ok' ? 'healthy' : 'error',
      message: systemHealth?.services?.embedding?.message || 'Embedding generation service',
      metrics: {
        model: systemStats?.stats?.system_info?.embedding_model || 'unknown',
        dimension: systemStats?.stats?.system_info?.embedding_dimension || 0
      }
    },
    {
      name: 'Cache',
      status: systemHealth?.services?.cache?.status === 'ok' ? 'healthy' : 'error',
      message: systemHealth?.services?.cache?.message || 'Cache service',
      metrics: {
        provider: 'Redis',
        keys: systemStats?.stats?.cache_stats?.total_keys || 0
      }
    }
  ];

  const dbStats = systemStats?.stats?.database_stats;
  const systemInfo = systemStats?.stats?.system_info;
  const environment = systemHealth?.environment;

  return (
    <div>
      <PageHeader
        title="System Status"
        description="Monitor system health and performance"
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => {
              loadSystemHealth();
              loadSystemStats();
              loadDatabaseView();
            }}
          >
            Refresh
          </Button>
        }
      />

      {/* Overall system status */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success-50 text-success-600">
              <Activity className="h-[18px] w-[18px]" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                {getStatusIcon(systemHealth?.status || 'unknown')}
                <span className="text-[13px] font-semibold capitalize text-gray-900">
                  {systemHealth?.status || 'Unknown'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                Last checked: {systemHealth?.timestamp ? formatDate(systemHealth.timestamp) : 'Never'}
              </p>
            </div>
          </div>
          <Badge variant={statusBadgeVariant(systemHealth?.status || 'unknown')}>
            {systemHealth?.status === 'healthy' ? 'All systems operational' : 'Issues detected'}
          </Badge>
        </div>
      </div>

      {/* Services */}
      <p className="section-label mb-2 mt-6">Services</p>
      <Table>
        <THead>
          <TR>
            <TH>Service</TH>
            <TH>Description</TH>
            <TH>Metrics</TH>
            <TH>Status</TH>
            <TH className="text-right">Details</TH>
          </TR>
        </THead>
        <TBody>
          {services.map((service) => (
            <TR key={service.name}>
              <TD>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                    <Server className="h-4 w-4" />
                  </span>
                  <span className="font-medium text-gray-900">{service.name}</span>
                </div>
              </TD>
              <TD className="text-gray-500">{service.message}</TD>
              <TD>
                {service.metrics && (
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {Object.entries(service.metrics).map(([key, value]) => (
                      <span key={key} className="text-gray-600">
                        <span className="capitalize text-gray-400">{key.replace(/_/g, ' ')}:</span>{' '}
                        <span className="font-medium text-gray-900">{value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </TD>
              <TD>
                <Badge variant={statusBadgeVariant(service.status)}>{service.status}</Badge>
              </TD>
              <TD className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleServiceClick(service.name)}
                >
                  {selectedService === service.name ? 'Hide' : 'View'}
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {/* Service details */}
      {selectedService && serviceDetails && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="mb-4 flex items-center gap-2">
            <Settings className="h-4 w-4 text-gray-500" />
            <h3 className="text-[13px] font-semibold text-gray-900">{selectedService} details</h3>
          </div>
          {loadingDetails ? (
            <div className="flex items-center justify-center py-8 text-[13px] text-gray-500">
              <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
              <span>Loading details...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Object.entries(serviceDetails).map(([key, value]) => (
                <div key={key} className="rounded-md border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide capitalize text-gray-500">
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div className="font-mono text-[13px] text-gray-900">
                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Database statistics */}
      <div className="mb-2 mt-6 flex items-center gap-2">
        <Database className="h-4 w-4 text-gray-400" />
        <p className="section-label">Database statistics</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total documents" value={dbStats?.total_documents || 0} icon={Database} />
        <StatCard label="CVs" value={dbStats?.total_cvs || 0} />
        <StatCard label="Job descriptions" value={dbStats?.total_jds || 0} />
        <StatCard label="Avg skills per CV" value={systemStats?.stats?.cv_analytics?.avg_skills_per_cv?.toFixed(1) || 0} />
      </div>

      {/* System information */}
      <div className="mb-2 mt-6 flex items-center gap-2">
        <Cpu className="h-4 w-4 text-gray-400" />
        <p className="section-label">System information</p>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Property</TH>
            <TH>Value</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD className="text-gray-500">Embedding Model</TD>
            <TD className="font-mono text-gray-900">{systemInfo?.embedding_model || 'Unknown'}</TD>
          </TR>
          <TR>
            <TD className="text-gray-500">Vector Dimensions</TD>
            <TD className="font-mono text-gray-900">{systemInfo?.embedding_dimension || 0}</TD>
          </TR>
          <TR>
            <TD className="text-gray-500">Similarity Metric</TD>
            <TD className="font-mono text-gray-900">{systemInfo?.similarity_metric || 'Unknown'}</TD>
          </TR>
          <TR>
            <TD className="text-gray-500">Qdrant Host</TD>
            <TD className="font-mono text-gray-900">{environment?.qdrant_host || 'Unknown'}</TD>
          </TR>
          <TR>
            <TD className="text-gray-500">Qdrant Port</TD>
            <TD className="font-mono text-gray-900">{environment?.qdrant_port || 'Unknown'}</TD>
          </TR>
          <TR>
            <TD className="text-gray-500">OpenAI Key</TD>
            <TD>
              <Badge variant={environment?.openai_key_configured ? 'success' : 'secondary'}>
                {environment?.openai_key_configured ? 'Configured' : 'Not configured'}
              </Badge>
            </TD>
          </TR>
        </TBody>
      </Table>

      {/* Database Management - Admin Only - Danger Zone */}
      {isAdmin && (
        <>
          <p className="section-label mb-2 mt-8">Danger zone</p>
          <div className="rounded-lg border border-red-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
                  <Database className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">Clear database</p>
                  <p className="mt-0.5 text-[13px] text-gray-500">
                    Permanently delete all CVs and job descriptions. This action cannot be undone.
                  </p>
                </div>
              </div>
              <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
                <DialogTrigger asChild>
                  <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} className="shrink-0">
                    Clear all data
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                      Confirm database clear
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <p className="text-[13px] text-gray-700">
                      Are you sure you want to permanently delete all CVs and job descriptions?
                    </p>
                    <p className="text-[13px] text-gray-500">This action cannot be undone.</p>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="secondary" onClick={() => setShowClearDialog(false)}>
                        Cancel
                      </Button>
                      <Button variant="danger" onClick={handleClearDatabase} loading={isClearing}>
                        Clear all data
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
