'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Container,
} from 'lucide-react';
import { api } from '@/lib/api';

interface SystemStats {
  cpu: {
    percent: number;
    count: number;
    frequency: {
      current: number;
      min: number;
      max: number;
    };
    load_average: {
      '1min': number;
      '5min': number;
      '15min': number;
    };
  };
  memory: {
    total: number;
    available: number;
    used: number;
    percent: number;
    swap: {
      total: number;
      used: number;
      free: number;
      percent: number;
    };
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percent: number;
    io: {
      read_count: number;
      write_count: number;
      read_bytes: number;
      write_bytes: number;
    };
  };
  network: {
    bytes_sent: number;
    bytes_recv: number;
    packets_sent: number;
    packets_recv: number;
  };
}

interface ContainerStats {
  cpu_percent: number;
  cpu_limit_cores: number;
  memory_used_bytes: number | null;
  memory_limit_bytes: number | null;
  memory_percent: number | null;
}

interface GPUStats {
  index: number;
  name: string;
  gpu_utilization: number;
  memory_utilization: number;
  memory_total: number;
  memory_used: number;
  memory_free: number;
  temperature: number;
  power_draw: number;
}

interface DockerStats {
  container: string;
  cpu_percent: string;
  memory_usage: string;
  memory_percent: string;
  network_io: string;
  block_io: string;
  pids: string;
}

interface PerformanceData {
  timestamp: number;
  system: SystemStats;
  container: ContainerStats | null;
  gpu: GPUStats[];
  docker: DockerStats[];
  status: string;
}

const PerformanceDashboard: React.FC = () => {
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5 seconds

  const fetchPerformanceData = async () => {
    try {
      setError(null);
      const data = await api.getSystemPerformance();
      setPerformanceData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch performance data');
      console.error('Performance data fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformanceData();

    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(fetchPerformanceData, refreshInterval);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, refreshInterval]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatFrequency = (hz: number): string => {
    if (hz >= 1000000000) return (hz / 1000000000).toFixed(2) + ' GHz';
    if (hz >= 1000000) return (hz / 1000000).toFixed(2) + ' MHz';
    return hz.toFixed(0) + ' Hz';
  };

  const getStatusColor = (value: number, thresholds: { warning: number; critical: number }): string => {
    if (value >= thresholds.critical) return 'text-red-600';
    if (value >= thresholds.warning) return 'text-amber-600';
    return 'text-success-600';
  };

  const getStatusIcon = (value: number, thresholds: { warning: number; critical: number }) => {
    if (value >= thresholds.critical) return <XCircle className="h-4 w-4 text-red-600" />;
    if (value >= thresholds.warning) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    return <CheckCircle className="h-4 w-4 text-success-600" />;
  };

  if (loading && !performanceData) {
    return (
      <div className="flex h-64 items-center justify-center text-[13px] text-gray-500">
        <RefreshCw className="mr-2 h-6 w-6 animate-spin" />
        <span>Loading performance data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={XCircle}
        title="Error loading performance data"
        hint={error}
        action={
          <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={fetchPerformanceData}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!performanceData) return null;

  const { system, container, gpu, docker } = performanceData;

  return (
    <div>
      <PageHeader
        title="System Performance"
        description="Real-time monitoring of system resources and performance"
        actions={
          <>
            <Button
              variant={autoRefresh ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              Auto refresh: {autoRefresh ? 'On' : 'Off'}
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={fetchPerformanceData}
              disabled={loading}
            >
              Refresh
            </Button>
          </>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Host CPU (whole server)</div>
              <div className="mt-1.5 text-xl font-semibold leading-7 text-gray-900">{system.cpu.percent.toFixed(1)}%</div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50">
              <Cpu className="h-4 w-4 text-brand-600" />
            </div>
          </div>
          <Progress value={system.cpu.percent} className="mt-3" />
          <div className="mt-2 flex items-center gap-1.5 text-[12px]">
            {getStatusIcon(system.cpu.percent, { warning: 80, critical: 90 })}
            <span className={getStatusColor(system.cpu.percent, { warning: 80, critical: 90 })}>
              {system.cpu.count} cores
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Host Memory (whole server)</div>
              <div className="mt-1.5 text-xl font-semibold leading-7 text-gray-900">{system.memory.percent.toFixed(1)}%</div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50">
              <MemoryStick className="h-4 w-4 text-brand-600" />
            </div>
          </div>
          <Progress value={system.memory.percent} className="mt-3" />
          <div className="mt-2 flex items-center gap-1.5 text-[12px]">
            {getStatusIcon(system.memory.percent, { warning: 80, critical: 90 })}
            <span className={getStatusColor(system.memory.percent, { warning: 80, critical: 90 })}>
              {formatBytes(system.memory.used)} / {formatBytes(system.memory.total)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Disk Usage</div>
              <div className="mt-1.5 text-xl font-semibold leading-7 text-gray-900">{system.disk.percent.toFixed(1)}%</div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50">
              <HardDrive className="h-4 w-4 text-brand-600" />
            </div>
          </div>
          <Progress value={system.disk.percent} className="mt-3" />
          <div className="mt-2 flex items-center gap-1.5 text-[12px]">
            {getStatusIcon(system.disk.percent, { warning: 80, critical: 90 })}
            <span className={getStatusColor(system.disk.percent, { warning: 80, critical: 90 })}>
              {formatBytes(system.disk.used)} / {formatBytes(system.disk.total)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">GPU Usage</div>
              <div className="mt-1.5 text-xl font-semibold leading-7 text-gray-900">
                {gpu.length > 0 ? gpu[0].gpu_utilization.toFixed(1) : 0}%
              </div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50">
              <Zap className="h-4 w-4 text-brand-600" />
            </div>
          </div>
          <Progress value={gpu.length > 0 ? gpu[0].gpu_utilization : 0} className="mt-3" />
          <div className="mt-2 flex items-center gap-1.5 text-[12px]">
            {gpu.length > 0 ? getStatusIcon(gpu[0].gpu_utilization, { warning: 80, critical: 90 }) : <XCircle className="h-4 w-4 text-gray-400" />}
            <span className={gpu.length > 0 ? getStatusColor(gpu[0].gpu_utilization, { warning: 80, critical: 90 }) : 'text-gray-400'}>
              {gpu.length} GPU{gpu.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* This backend container's own footprint — cgroup-scoped, unlike the
          host-wide cards above. Only this container's usage, matches `docker stats`. */}
      {container ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex items-center gap-2">
            <Container className="h-4 w-4 text-brand-600" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              This container (backend API — not the whole server)
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex justify-between text-[13px] text-gray-700">
                <span>CPU (of {container.cpu_limit_cores} core limit)</span>
                <span>{container.cpu_percent.toFixed(1)}%</span>
              </div>
              <Progress value={container.cpu_percent} className="mt-1.5" />
            </div>
            <div>
              <div className="flex justify-between text-[13px] text-gray-700">
                <span>Memory</span>
                <span>
                  {container.memory_used_bytes != null ? formatBytes(container.memory_used_bytes) : '—'}
                  {' / '}
                  {container.memory_limit_bytes != null ? formatBytes(container.memory_limit_bytes) : 'no limit'}
                </span>
              </div>
              <Progress value={container.memory_percent ?? 0} className="mt-1.5" />
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-gray-400">
          Per-container stats unavailable (host is using cgroup v1) — the Host cards above still reflect the whole server.
        </p>
      )}

      {/* Detailed Tabs */}
      <Tabs defaultValue="system" className="mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="gpu">GPU</TabsTrigger>
          <TabsTrigger value="docker">Docker</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
        </TabsList>

        <TabsContent value="system" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* CPU Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-gray-500" />
                  CPU Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-[13px] text-gray-700">
                    <span>Usage</span>
                    <span>{system.cpu.percent.toFixed(1)}%</span>
                  </div>
                  <Progress value={system.cpu.percent} className="mt-1.5" />
                </div>
                <div className="grid grid-cols-2 gap-4 text-[13px]">
                  <div>
                    <span className="text-gray-500">Cores:</span>
                    <span className="ml-2 font-medium text-gray-900">{system.cpu.count}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Frequency:</span>
                    <span className="ml-2 font-medium text-gray-900">{formatFrequency(system.cpu.frequency.current)}</span>
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-[13px] font-medium text-gray-900">Load Average</h4>
                  <div className="grid grid-cols-3 gap-2 text-[13px]">
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{system.cpu.load_average['1min'].toFixed(2)}</div>
                      <div className="text-gray-500">1 min</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{system.cpu.load_average['5min'].toFixed(2)}</div>
                      <div className="text-gray-500">5 min</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{system.cpu.load_average['15min'].toFixed(2)}</div>
                      <div className="text-gray-500">15 min</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Memory Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-gray-500" />
                  Memory Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-[13px] text-gray-700">
                    <span>RAM Usage</span>
                    <span>{system.memory.percent.toFixed(1)}%</span>
                  </div>
                  <Progress value={system.memory.percent} className="mt-1.5" />
                </div>
                <div className="grid grid-cols-2 gap-4 text-[13px]">
                  <div>
                    <span className="text-gray-500">Used:</span>
                    <span className="ml-2 font-medium text-gray-900">{formatBytes(system.memory.used)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Available:</span>
                    <span className="ml-2 font-medium text-gray-900">{formatBytes(system.memory.available)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total:</span>
                    <span className="ml-2 font-medium text-gray-900">{formatBytes(system.memory.total)}</span>
                  </div>
                </div>
                {system.memory.swap.total > 0 && (
                  <div>
                    <div className="flex justify-between text-[13px] text-gray-700">
                      <span>Swap Usage</span>
                      <span>{system.memory.swap.percent.toFixed(1)}%</span>
                    </div>
                    <Progress value={system.memory.swap.percent} className="mt-1.5" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="gpu" className="space-y-4">
          {gpu.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {gpu.map((gpuInfo, index) => (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-gray-500" />
                      GPU {gpuInfo.index}: {gpuInfo.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-[13px] text-gray-700">
                        <span>GPU Utilization</span>
                        <span>{gpuInfo.gpu_utilization.toFixed(1)}%</span>
                      </div>
                      <Progress value={gpuInfo.gpu_utilization} className="mt-1.5" />
                    </div>
                    <div>
                      <div className="flex justify-between text-[13px] text-gray-700">
                        <span>Memory Utilization</span>
                        <span>{gpuInfo.memory_utilization.toFixed(1)}%</span>
                      </div>
                      <Progress value={gpuInfo.memory_utilization} className="mt-1.5" />
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-[13px]">
                      <div>
                        <span className="text-gray-500">Memory Used:</span>
                        <span className="ml-2 font-medium text-gray-900">{gpuInfo.memory_used.toFixed(1)} MB</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Memory Total:</span>
                        <span className="ml-2 font-medium text-gray-900">{gpuInfo.memory_total.toFixed(1)} MB</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Temperature:</span>
                        <span className="ml-2 font-medium text-gray-900">{gpuInfo.temperature.toFixed(1)}°C</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Power:</span>
                        <span className="ml-2 font-medium text-gray-900">{gpuInfo.power_draw.toFixed(1)}W</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Zap}
              title="GPU not available (CPU deployment)"
              hint="No NVIDIA GPU found or nvidia-smi is not available."
            />
          )}
        </TabsContent>

        <TabsContent value="docker" className="space-y-4">
          {docker.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Container</TH>
                  <TH>CPU</TH>
                  <TH>Memory</TH>
                  <TH>Network I/O</TH>
                  <TH>PIDs</TH>
                </TR>
              </THead>
              <TBody>
                {docker.map((container, index) => (
                  <TR key={index}>
                    <TD className="font-medium text-gray-900">{container.container}</TD>
                    <TD>{container.cpu_percent}</TD>
                    <TD>
                      <div>{container.memory_usage}</div>
                      <div className="text-xs text-gray-500">{container.memory_percent}%</div>
                    </TD>
                    <TD className="text-xs">{container.network_io}</TD>
                    <TD>
                      <Badge variant="outline">{container.pids}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState
              icon={Container}
              title="No Docker containers"
              hint="No running Docker containers found."
            />
          )}
        </TabsContent>

        <TabsContent value="network" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-4 w-4 text-gray-500" />
                Network Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <h4 className="mb-3 text-[13px] font-medium text-gray-900">Data Transfer</h4>
                  <div className="space-y-2 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Bytes Sent:</span>
                      <span className="font-medium text-gray-900">{formatBytes(system.network.bytes_sent)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Bytes Received:</span>
                      <span className="font-medium text-gray-900">{formatBytes(system.network.bytes_recv)}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="mb-3 text-[13px] font-medium text-gray-900">Packets</h4>
                  <div className="space-y-2 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Packets Sent:</span>
                      <span className="font-medium text-gray-900">{system.network.packets_sent.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Packets Received:</span>
                      <span className="font-medium text-gray-900">{system.network.packets_recv.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PerformanceDashboard;
