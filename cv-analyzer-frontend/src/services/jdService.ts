import { api } from '@/lib/api';

/**
 * Job description management.
 * Thin domain grouping over the existing `api` client — no new logic.
 */
export const jdService = {
  upload: api.uploadJD,
  list: api.listJDs,
  getDetails: api.getJDDetails,
  delete: api.deleteJD,
  getEmbeddings: api.getJDEmbeddings,
  standardize: api.standardizeJD,
  extractForUI: api.extractJDForUI,
  unifiedJobUpdate: api.unifiedJobUpdate,
};

export default jdService;
