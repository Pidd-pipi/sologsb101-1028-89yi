/**
 * 逐条合并引擎（纯函数，不依赖 Dexie / React，便于自测）
 *
 * 合并规则（同一条记录以 id 对齐，先比行修订号 revision）：
 *   1. 仅一侧存在：直接并入（本机没有的新增进来；仅本机有的保留不动）。
 *   2. 两侧都在且业务字段一致：无变化。
 *   3. 两侧都在但业务字段不同：
 *      - revision 不等：修订号大的一版并入（只被一边继续改过，另一边落后）。
 *      - revision 相等：两边各自动过同一条，无法自动取舍 → 两版并列存为冲突，等人挑一版再落地。
 *   4. 已有数据缺修订号（历史行 / 旧备份）：按现有值回填初始修订号后再参与合并。
 */
import { INITIAL_LINE_REVISION, lineRevision } from './revision';
import type { ConflictTable } from '../types/conflict';

/** 参与合并的行：至少有 id，revision 可能缺失（历史行回填） */
export type MergeableRow = {
  id: string;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
};

/** 单表合并结果 */
export interface TableMerge<TRow extends MergeableRow> {
  /** 需要写入该表的行（新增 + 修订号更大的一侧胜出） */
  puts: TRow[];
  /** 需要并列保留、等人裁决的冲突 */
  conflicts: Array<{
    rowId: string;
    localVersion: TRow;
    incomingVersion: TRow;
    localRevision: number;
    incomingRevision: number;
  }>;
  added: number;
  updated: number;
  unchanged: number;
  conflicted: number;
}

/** 整库六表合并结果 */
export type MergePlan = {
  [K in ConflictTable]: TableMerge<MergeableRow>;
};

/** 合并结果汇总 */
export interface MergeSummary {
  added: number;
  updated: number;
  unchanged: number;
  conflicted: number;
}

/** 参与合并的表，顺序固定（父表在前，便于阅读） */
export const MERGE_TABLES: ConflictTable[] = [
  'projects',
  'songs',
  'sessions',
  'takes',
  'picks',
  'retakes'
];

/** 比较业务字段时忽略的元数据列（修订号 / 时间戳不参与「内容是否相同」） */
const META_KEYS = ['revision', 'createdAt', 'updatedAt'] as const;

/** 去掉元数据列，稳定序列化后比较业务内容（数组键序按插入顺序，同结构数据序列化一致） */
function businessSignature(row: MergeableRow): string {
  const copy: Record<string, unknown> = { ...(row as unknown as Record<string, unknown>) };
  for (const key of META_KEYS) {
    delete copy[key];
  }
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize((value as Record<string, unknown>)[key])]))
        : value;
  return JSON.stringify(normalize(copy));
}

/** 业务字段是否一致（不看修订号 / 时间戳） */
export function sameBusinessFields(a: MergeableRow, b: MergeableRow): boolean {
  return businessSignature(a) === businessSignature(b);
}

/**
 * 历史行 / 旧备份缺修订号与时间戳时，按现有值回填：
 * revision 回填为初始值，createdAt / updatedAt 缺则补当前时间。
 */
export function normalizeIncoming(row: MergeableRow, now: number = Date.now()): MergeableRow {
  return {
    ...row,
    revision: lineRevision(row),
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : now
  };
}

/** 逐表合并一张表 */
export function mergeTable<TRow extends MergeableRow>(localRows: TRow[], incomingRows: TRow[]): TableMerge<TRow> {
  const localById = new Map(localRows.map((row) => [row.id, row]));
  const puts: TRow[] = [];
  const conflicts: TableMerge<TRow>['conflicts'] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const rawIncoming of incomingRows) {
    const incoming = normalizeIncoming(rawIncoming) as TRow;
    const local = localById.get(incoming.id);

    if (!local) {
      // 仅导入侧有：新增并入
      puts.push(incoming);
      added += 1;
      continue;
    }

    if (sameBusinessFields(local, incoming)) {
      // 内容一致（含两边都没动）：无变化
      unchanged += 1;
      continue;
    }

    const localRev = lineRevision(local);
    const incomingRev = lineRevision(incoming);

    if (incomingRev > localRev) {
      // 只有导入侧在共同基线上继续改过：导入版胜出
      puts.push(incoming);
      updated += 1;
    } else if (localRev > incomingRev) {
      // 只有本机侧继续改过：本机保留，不动
      unchanged += 1;
    } else {
      // 同修订号且内容不同：两边都改动过同一条 → 两版并列，等人挑一版
      conflicts.push({
        rowId: incoming.id,
        localVersion: { ...local, revision: localRev },
        incomingVersion: incoming,
        localRevision: localRev,
        incomingRevision: incomingRev
      });
    }
  }

  return { puts, conflicts, added, updated, unchanged, conflicted: conflicts.length };
}

/** 合并六张表，产出落库计划（不触碰数据库，由持久化层在单个事务内执行） */
export function buildMergePlan(local: Record<ConflictTable, MergeableRow[]>, incoming: Record<ConflictTable, MergeableRow[]>): MergePlan {
  const plan = {} as MergePlan;
  for (const table of MERGE_TABLES) {
    plan[table] = mergeTable(local[table] ?? [], incoming[table] ?? []);
  }
  return plan;
}

export function summarizePlan(plan: MergePlan): MergeSummary {
  return MERGE_TABLES.reduce<MergeSummary>(
    (summary, table) => ({
      added: summary.added + plan[table].added,
      updated: summary.updated + plan[table].updated,
      unchanged: summary.unchanged + plan[table].unchanged,
      conflicted: summary.conflicted + plan[table].conflicted
    }),
    { added: 0, updated: 0, unchanged: 0, conflicted: 0 }
  );
}

/** 校验合并输入：六张业务表都必须是数组，每行必须有字符串 id，否则直接判定失败、整单回滚 */
export function validateMergePayload(incoming: Partial<Record<ConflictTable, unknown>>): void {
  for (const table of MERGE_TABLES) {
    const rows = incoming[table];
    if (!Array.isArray(rows)) {
      throw new Error(`缺少 ${table} 数组字段，不是本应用的备份文件`);
    }
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || typeof (row as { id?: unknown }).id !== 'string') {
        throw new Error(`${table} 中存在缺少 id 的记录，无法按条合并`);
      }
    }
  }
}

/** 冲突落地时采用的行修订号：在两版之上再 +1，表示冲突已人工裁决 */
export function resolvedRevision(localRevision: number, incomingRevision: number): number {
  return Math.max(localRevision, incomingRevision, INITIAL_LINE_REVISION) + 1;
}
