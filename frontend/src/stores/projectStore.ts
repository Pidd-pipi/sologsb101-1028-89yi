/**
 * 项目 store：维护项目与曲目列表的筛选条件及当前选中项目。
 * 页面只读 store 并调用其中 actions，跨页状态不留在组件内部 state。
 */
import { create } from 'zustand';
import type { FilterModel } from '@/types/filter';
import type { Project } from '@/types/project';
import type { Song } from '@/types/song';
import { putProject, putSong, removeProject, removeSong, updateProject, updateSong } from '@/utils/db';
import { buildRow } from '@/hooks/useIdbTable';

export const PROJECT_FILTER_KEYS = ['states', 'clients'];

interface ProjectState {
  filters: FilterModel;
  currentProjectId: string | null;
  setFilters: (next: FilterModel) => void;
  resetFilters: () => void;
  selectProject: (id: string | null) => void;
  createProject: (payload: Omit<Project, 'id'>) => Promise<string>;
  editProject: (id: string, patch: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createSong: (payload: Omit<Song, 'id'>) => Promise<string>;
  editSong: (id: string, patch: Partial<Song>) => Promise<void>;
  deleteSong: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  filters: { keyword: '', states: [], clients: [] },
  currentProjectId: null,
  setFilters: (next) => set({ filters: next }),
  resetFilters: () => set({ filters: { keyword: '', states: [], clients: [] } }),
  selectProject: (id) => set({ currentProjectId: id }),
  createProject: async (payload) => {
    const row = buildRow(payload, 'project');
    await putProject(row);
    set({ currentProjectId: row.id });
    return row.id;
  },
  editProject: async (id, patch) => {
    await updateProject(id, patch);
  },
  deleteProject: async (id) => {
    await removeProject(id);
    if (get().currentProjectId === id) set({ currentProjectId: null });
  },
  createSong: async (payload) => {
    const row = buildRow(payload, 'song');
    await putSong(row);
    return row.id;
  },
  editSong: async (id, patch) => {
    await updateSong(id, patch);
  },
  deleteSong: async (id) => {
    await removeSong(id);
  }
}));
