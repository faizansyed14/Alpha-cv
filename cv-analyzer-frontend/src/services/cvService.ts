import { api } from '@/lib/api';

/**
 * CV management (upload, listing, details, notes, categories, download).
 * Thin domain grouping over the existing `api` client — no new logic.
 */
export const cvService = {
  upload: api.uploadCV,
  list: api.listCVs,
  getDetails: api.getCVDetails,
  delete: api.deleteCV,
  getEmbeddings: api.getCVEmbeddings,
  standardize: api.standardizeCV,
  download: api.downloadCV,

  // Categories
  getCategories: api.getCategories,
  getByCategory: api.getCVsByCategory,

  // HR notes
  getAllWithNotes: api.getAllCVsWithNotes,
  getNotes: api.getCVNotes,
  getNotesSummary: api.getNotesSummary,
  addOrUpdateNote: api.addOrUpdateNote,
  deleteNote: api.deleteCVNote,

  // Legacy note helpers (kept for parity with `api`)
  addNoteLegacy: api.addNote,
  getNotesLegacy: api.getNotes,
  deleteNoteLegacy: api.deleteNote,
  getAllNotes: api.getAllNotes,
};

export default cvService;
