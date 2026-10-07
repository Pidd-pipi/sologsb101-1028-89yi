/**
 * Dexie 表增删改查与 liveQuery 响应式订阅封装。
 * 页面统一通过它读取 IndexedDB，避免组件内部直接触碰 Dexie 实例。
 */
import { useEffect, useRef, useState } from 'react';
import { liveQuery, type Table } from 'dexie';
import { ROW_REVISION } from '@/utils/db';
import { createId } from '@/utils/uuid';

export interface IdbRecord {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

/** 默认排序：最近更新的排前面 */
function defaultCompare<T extends IdbRecord>(a: T, b: T): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

/**
 * 订阅一张 Dexie 表的全量数据。
 * compare 建议传模块级常量函数（内部用 ref 承接，不会因为函数重建而反复订阅）。
 */
export function useIdbTable<T extends IdbRecord>(
  table: Table<T, string>,
  compare?: (a: T, b: T) => number
): T[] {
  const [rows, setRows] = useState<T[]>([]);
  const compareRef = useRef(compare);
  compareRef.current = compare;

  useEffect(() => {
    const sort = (list: T[]): T[] => {
      const comparator = compareRef.current ?? defaultCompare;
      return [...list].sort(comparator);
    };
    const subscription = liveQuery(async () => sort(await table.toArray())).subscribe({
      next: (list) => setRows(list as T[]),
      error: (error: unknown) => {
        console.error('订阅本地数据失败', error);
      }
    });
    return () => subscription.unsubscribe();
  }, [table]);

  return rows;
}

/** 带 id / 修订号 / 时间戳的持久化行 */
export interface StampedRow {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** 组装一行带 id / 修订号 / 时间戳的持久化记录 */
export function buildRow<T extends object>(payload: T, prefix: string): T & StampedRow {
  const now = Date.now();
  return {
    ...payload,
    id: createId(prefix),
    revision: ROW_REVISION,
    createdAt: now,
    updatedAt: now
  } as T & StampedRow;
}
