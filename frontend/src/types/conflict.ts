/**
 * 合并冲突：同一条记录（同 id）在两台离线设备上都被改动、无法自动取舍时，
 * 把两版并列暂存到 conflicts 表，等人挑一版再落地。
 */

/** 参与合并的六张业务表（不含 conflicts 本身） */
export type ConflictTable = 'projects' | 'songs' | 'sessions' | 'takes' | 'picks' | 'retakes';

export const CONFLICT_TABLES: ConflictTable[] = ['projects', 'songs', 'sessions', 'takes', 'picks', 'retakes'];

/**
 * 单条冲突。
 * - localVersion：本机当前落地的一版（含行修订号 / 时间戳）
 * - incomingVersion：导入备份里的对侧版本
 * 两个版本 id 相同，业务字段都可能不同。
 */
export interface MergeConflict<TRow = unknown> {
  id: string;
  /** 冲突所在业务表 */
  table: ConflictTable;
  /** 冲突记录 id（与两个版本的 id 相同） */
  rowId: string;
  /** 本机版本 */
  localVersion: TRow;
  /** 导入侧版本 */
  incomingVersion: TRow;
  /** 本机版本行修订号 */
  localRevision: number;
  /** 导入侧版本行修订号 */
  incomingRevision: number;
  /** 冲突产生时间（ISO） */
  detectedAt: string;
}

/** 冲突的最终选择 */
export type ConflictChoice = 'local' | 'incoming';
