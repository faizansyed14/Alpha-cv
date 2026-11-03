/** Response shapes of /api/monitor/* (backend/app/api/routers/monitor.py). */

export interface ModelRow {
  kind: string;
  role: string;
  model: string;
  calls: number;
  errors: number;
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

export interface MonitorProcess {
  id: string;
  kind: string;
  host: string;
  pid: number;
  uptime_s: number;
  age_s: number;
  online: boolean;
}

export type QueueSnapshot =
  | { available: false }
  | {
      available: true;
      waiting: number;
      running: number;
      processing: number;
      limits: { worker_concurrency: number; global_cap: number };
    };

export interface MonitorSummary {
  window_minutes: number;
  generated_at: number;
  api: ModelRow & { routes: ModelRow[] };
  models: ModelRow[];
  llm: {
    calls: number;
    errors: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    cost_today_usd: number;
    daily_budget_usd: number | null;
  };
  jobs: ModelRow;
  queue: QueueSnapshot;
  processes: MonitorProcess[];
  redis:
    | { available: false }
    | { available: true; used_mb: number; max_mb: number | null; hit_ratio: number | null; evicted_keys: number; clients: number; ops_per_s: number };
  system: { cpu_percent: number; cpus: number; load_1m: number; memory_percent: number; memory_used_gb: number; memory_total_gb: number; disk_percent: number };
  library: { cvs: number | null; jds: number | null };
  alerts: { level: 'danger' | 'warning'; title: string; detail: string }[];
}

export interface SeriesPoint {
  t: number;
  calls: number;
  errors: number;
  p95_ms: number | null;
  tokens: number;
  cost_usd: number;
}

export interface MonitorTimeseries {
  window_minutes: number;
  llm: SeriesPoint[];
  api: SeriesPoint[];
  job: SeriesPoint[];
  embedder: SeriesPoint[];
  ocr: SeriesPoint[];
}

export interface MonitorEvent {
  ts: number;
  kind: string;
  role: string;
  model: string;
  ms: number;
  status: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  detail: Record<string, unknown>;
  proc: string;
}
