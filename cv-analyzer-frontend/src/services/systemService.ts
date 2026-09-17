import { api } from '@/lib/api';

/**
 * System health, stats & performance monitoring.
 * Thin domain grouping over the existing `api` client — no new logic.
 */
export const systemService = {
  healthCheck: api.healthCheck,
  getStats: api.getSystemStats,
  getDatabaseStatus: api.getDatabaseStatus,
  getDatabaseView: api.getDatabaseView,

  // Performance monitoring
  getSystemPerformance: api.getSystemPerformance,
  getGPUPerformance: api.getGPUPerformance,
  getDockerPerformance: api.getDockerPerformance,
  getPerformanceSummary: api.getPerformanceSummary,
  getPerformanceHealth: api.getPerformanceHealth,
};

export default systemService;
