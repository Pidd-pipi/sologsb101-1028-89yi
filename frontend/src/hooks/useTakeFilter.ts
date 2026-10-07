/**
 * 管理曲目、评级、问题标签、时间码区间筛选状态与派生结果。
 * 筛选状态存放在 takeStore（跨页保留），本 hook 负责派生与 URL query 互转。
 */
import { useMemo } from 'react';
import type { FilterModel } from '@/types/filter';
import type { SessionRow, TakeRow } from '@/utils/db';
import { isTimecode, tcToSeconds } from '@/utils/timecode';
import { useTakeStore } from '@/stores/takeStore';

export interface TakeFilterResult {
  filters: FilterModel;
  setFilters: (next: FilterModel) => void;
  resetFilters: () => void;
  /** 组合筛选后的条次 */
  filtered: TakeRow[];
  /** 命中的曲目 id 集合（用于联动曲目筛选） */
  matchedSessionIds: string[];
}

function asArray(value: string | string[] | boolean | undefined): string[] {
  if (Array.isArray(value)) return value;
  return [];
}

/** 时间码区间过滤：留空表示不限 */
export function withinTimecode(take: TakeRow, minTc: string, maxTc: string): boolean {
  if (minTc && isTimecode(minTc)) {
    const floor = tcToSeconds(minTc);
    const start = tcToSeconds(take.startTc);
    if (!Number.isNaN(floor) && !Number.isNaN(start) && start < floor) return false;
  }
  if (maxTc && isTimecode(maxTc)) {
    const ceil = tcToSeconds(maxTc);
    const end = tcToSeconds(take.endTc);
    if (!Number.isNaN(ceil) && !Number.isNaN(end) && end > ceil) return false;
  }
  return true;
}

/**
 * @param takes     全量条次
 * @param sessions  全量场次（用于按曲目过滤）
 */
export function useTakeFilter(takes: TakeRow[], sessions: SessionRow[]): TakeFilterResult {
  const filters = useTakeStore((state) => state.filters);
  const setFilters = useTakeStore((state) => state.setFilters);
  const resetFilters = useTakeStore((state) => state.resetFilters);

  const filtered = useMemo(() => {
    const keyword = String(filters.keyword ?? '').trim().toLowerCase();
    const grades = asArray(filters.grades);
    const issues = asArray(filters.issues);
    const sessionIds = asArray(filters.sessionIds);
    const minTc = typeof filters.minTc === 'string' ? filters.minTc : '';
    const maxTc = typeof filters.maxTc === 'string' ? filters.maxTc : '';

    return takes.filter((take) => {
      const session = sessions.find((item) => item.id === take.sessionId);
      const label = `${take.takeNo} ${take.startTc} ${take.endTc} ${take.grade} ${take.issues.join('/')} ${
        session ? `${session.roomNo} ${session.engineer} ${session.date}` : ''
      }`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (grades.length > 0 && !grades.includes(take.grade)) return false;
      if (issues.length > 0 && !take.issues.some((issue) => issues.includes(issue))) return false;
      if (sessionIds.length > 0 && !sessionIds.includes(take.sessionId)) return false;
      if (!withinTimecode(take, minTc, maxTc)) return false;
      return true;
    });
  }, [takes, sessions, filters]);

  const matchedSessionIds = useMemo(
    () => Array.from(new Set(filtered.map((item) => item.sessionId))),
    [filtered]
  );

  return { filters, setFilters, resetFilters, filtered, matchedSessionIds };
}
