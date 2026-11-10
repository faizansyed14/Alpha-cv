import { create } from 'zustand';
import { api } from '@/lib/api';

interface SavedCvsState {
  /** The ids this person saved: what every CV card uses to show its bookmark. */
  ids: string[];
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  save: (cvIds: string[]) => Promise<number>;
  unsave: (cvIds: string[]) => Promise<number>;
  reset: () => void;
}

/** Saving and removing show at once (the bookmark flips before the server answers) and are put back if the server refuses. */
export const useSavedCvsStore = create<SavedCvsState>((set, get) => ({
  ids: [],
  loaded: false,

  load: async (force = false) => {
    if (get().loaded && !force) return;
    try {
      const ids = await api.getSavedCVIds();
      set({ ids, loaded: true });
    } catch {
      /* the bookmarks are a convenience: the pages still work without them */
    }
  },

  save: async (cvIds) => {
    const before = get().ids;
    const fresh = cvIds.filter((id) => !before.includes(id));
    if (fresh.length === 0) return 0;
    set({ ids: [...fresh, ...before] });
    try {
      return await api.saveCVs(cvIds);
    } catch (e) {
      set({ ids: before });
      throw e;
    }
  },

  unsave: async (cvIds) => {
    const before = get().ids;
    const gone = new Set(cvIds);
    set({ ids: before.filter((id) => !gone.has(id)) });
    try {
      return await api.unsaveCVs(cvIds);
    } catch (e) {
      set({ ids: before });
      throw e;
    }
  },

  reset: () => set({ ids: [], loaded: false }),
}));
