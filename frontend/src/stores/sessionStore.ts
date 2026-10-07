/**
 * 场次 store：维护场次排期、棚号占用校验与筛选条件。
 */
import { create } from 'zustand';
import type { FilterModel } from '@/types/filter';
import type { Session } from '@/types/session';
import { findRoomConflict, putSession, removeSession, updateSession } from '@/utils/db';
import { buildRow } from '@/hooks/useIdbTable';

export const SESSION_FILTER_KEYS = ['rooms', 'periods', 'states'];

interface SessionState {
  filters: FilterModel;
  currentSessionId: string | null;
  setFilters: (next: FilterModel) => void;
  resetFilters: () => void;
  selectSession: (id: string | null) => void;
  createSession: (payload: Omit<Session, 'id'>) => Promise<string>;
  editSession: (id: string, patch: Partial<Session>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  assertRoomFree: (roomNo: string, date: string, period: string, selfId: string | null) => Promise<void>;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  filters: { keyword: '', rooms: [], periods: [], states: [] },
  currentSessionId: null,
  setFilters: (next) => set({ filters: next }),
  resetFilters: () => set({ filters: { keyword: '', rooms: [], periods: [], states: [] } }),
  selectSession: (id) => set({ currentSessionId: id }),
  assertRoomFree: async (roomNo, date, period, selfId) => {
    const conflict = await findRoomConflict(roomNo, date, period, selfId);
    if (conflict) {
      throw new Error(`${roomNo} 在 ${date} ${period} 已被场次占用（场次 ${conflict.id}），请换棚或换时段`);
    }
  },
  createSession: async (payload) => {
    await get().assertRoomFree(payload.roomNo, payload.date, payload.period, null);
    const row = buildRow(payload, 'session');
    await putSession(row);
    set({ currentSessionId: row.id });
    return row.id;
  },
  editSession: async (id, patch) => {
    const current = { ...patch } as Partial<Session>;
    if (patch.roomNo && patch.date && patch.period) {
      await get().assertRoomFree(patch.roomNo, patch.date, patch.period, id);
    }
    await updateSession(id, current);
  },
  deleteSession: async (id) => {
    await removeSession(id);
    if (get().currentSessionId === id) set({ currentSessionId: null });
  }
}));
