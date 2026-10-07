/** 逐条合并导入涉及的类型（叶子模块，不依赖任何应用内模块） */

/** 参与逐条合并的六张业务表 */
export type MergeTableName = 'projects' | 'songs' | 'sessions' | 'takes' | 'picks' | 'retakes';

/**
 * 一条待落地的合并冲突：同一行两边都改动过（修订号相同但内容不同），
 * 本地版与导入版并列暂存，等人挑一版之后才写回业务表。
 */
export interface MergeConflict {
  id: string;
  /** 冲突行所在的业务表 */
  table: MergeTableName;
  /** 冲突行的 id（两张快照里 id 相同） */
  rowId: string;
  /** 本地版本（当前库里的整行快照） */
  local: Record<string, unknown>;
  /** 导入版本（备份文件里的整行快照） */
  incoming: Record<string, unknown>;
  createdAt: number;
}

/** 冲突解决方向：保留本地版 / 采用导入版 */
export type ConflictChoice = 'local' | 'incoming';

/** 单张表的合并统计 */
export interface TableMergeStat {
  /** 只有备份里有 → 直接并入 */
  inserted: number;
  /** 备份修订号更高（只有对方动过）→ 采用备份 */
  updated: number;
  /** 本地修订号更高（只有本地动过）→ 保留本地 */
  kept: number;
  /** 两边内容一致 → 无需改动 */
  same: number;
  /** 两边都改过 → 两版并列待落地 */
  conflicts: number;
}

/** 一次合并导入的完整报告 */
export interface MergeReport {
  tables: Record<MergeTableName, TableMergeStat>;
  total: TableMergeStat;
}
