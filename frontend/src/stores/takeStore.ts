/**
 * Take store：维护条次列表的评级 / 问题标签 / 时间码筛选，以及批量改评级。
 */
import { create } from 'zustand';
import type { FilterModel } from '@/types/filter';
import type { Take } from '@/types/take';
import { bulkUpdateGrade, putTake, removeTake, updateTake } from '@/utils/db';
import { buildRow } from '@/hooks/useIdbTable';

export const TAKE_FILTER_KEYS = ['grades', 'issues', 'sessionIds', 'minTc', 'maxTc'];

interface TakeState {
  filters: FilterModel;
  selectedIds: string[];
  setFilters: (next: FilterModel) => void;
  resetFilters: () => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  createTake: (payload: Omit<Take, 'id'>) => Promise<string>;
  /** 返回被移出剪接清单的优选条数（评级改动会触发清单重算） */
  editTake: (id: string, patch: Partial<Take>) => Promise<number>;
  deleteTake: (id: string) => Promise<void>;
  /** 返回被移出剪接清单的优选条数 */
  batchGrade: (ids: string[], grade: Take['grade']) => Promise<number>;
}

export const useTakeStore = create<TakeState>()((set, get) => ({
  filters: { keyword: '', grades: [], issues: [], sessionIds: [], minTc: '', maxTc: '' },
  selectedIds: [],
  setFilters: (next) => set({ filters: next }),
  resetFilters: () =>
    set({ filters: { keyword: '', grades: [], issues: [], sessionIds: [], minTc: '', maxTc: '' } }),
  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((item) => item !== id)
        : [...state.selectedIds, id]
    })),
  setSelected: (ids) => set({ selectedIds: ids }),
  createTake: async (payload) => {
    const row = buildRow(payload, 'take');
    await putTake(row);
    return row.id;
  },
  editTake: async (id, patch) => {
    return updateTake(id, patch);
  },
  deleteTake: async (id) => {
    await removeTake(id);
    set((state) => ({ selectedIds: state.selectedIds.filter((item) => item !== id) }));
  },
  batchGrade: async (ids, grade) => {
    const pruned = await bulkUpdateGrade(ids, grade);
    set({ selectedIds: [] });
    void get();
    return pruned;
  }
}));
