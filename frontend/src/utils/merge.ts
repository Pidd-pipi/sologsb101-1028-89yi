/**
 * 逐条合并导入：两台电脑离线各改一份备份，回来时按行修订号逐条合并，而不是整包覆盖。
 *
 * 规则（同一条先比行修订号）：
 * - 只有备份里有这一行 → 直接并入；
 * - 备份修订号更高（只有对方动过）→ 采用备份版；
 * - 本地修订号更高（只有本地动过）→ 保留本地版；
 * - 修订号相同且内容一致 → 无需改动；
 * - 修订号相同但内容不同（两边都改动过）→ 两版并列存进 mergeConflicts 表，等人挑一版再落地。
 *
 * 整个合并跑在一个 Dexie 事务里：任何一步失败，事务整体回滚，库恢复成导入前的样子。
 * 没有修订号的旧备份行先按现有值回填（见 utils/revision.ts），回填后再参与比较。
 */
import type { Table } from 'dexie';
import { db, syncPicksWithGrades, type DatabaseSnapshot, type Revisioned } from './db';
import { ROW_REVISION, backfillRevisionFields } from './revision';
import { createId } from './uuid';
import type { ConflictChoice, MergeConflict, MergeReport, MergeTableName, TableMergeStat } from '../types/merge';

type GenericRow = { id: string } & Revisioned;

/** 参与逐条合并的六张业务表（合并顺序即外键依赖顺序） */
const MERGE_TABLES: MergeTableName[] = ['projects', 'songs', 'sessions', 'takes', 'picks', 'retakes'];

/** 业务表中文名（冲突面板展示用） */
export const MERGE_TABLE_LABELS: Record<MergeTableName, string> = {
  projects: '项目',
  songs: '曲目',
  sessions: '场次',
  takes: 'Take',
  picks: '优选',
  retakes: '补录'
};

function tableOf(name: MergeTableName): Table<GenericRow, string> {
  return db[name] as unknown as Table<GenericRow, string>;
}

function mergeTables(): Array<Table<GenericRow, string>> {
  return MERGE_TABLES.map(tableOf);
}

/**
 * 校验并回填一行备份数据：缺 id 直接报错（合并会因此整体回滚）；
 * 没有修订号 / 时间戳的旧数据按现有值回填，回填后再参与合并。
 */
export function normalizeIncomingRow(raw: unknown): GenericRow {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('备份行必须是对象');
  }
  const row = { ...(raw as Record<string, unknown>) };
  if (typeof row.id !== 'string' || row.id.length === 0) {
    throw new Error('备份行缺少 id 字段，无法逐条合并');
  }
  backfillRevisionFields(row);
  return row as unknown as GenericRow;
}

/** 比较两行业务内容是否一致（忽略 revision / createdAt / updatedAt） */
export function rowsEquivalent(a: object, b: object): boolean {
  return stableStringify(stripMeta(a as Record<string, unknown>)) === stableStringify(stripMeta(b as Record<string, unknown>));
}

function stripMeta(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
}

/** 键序稳定的序列化，保证同内容的不同对象字面量得到相同字符串 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort();
    const body = keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function emptyStat(): TableMergeStat {
  return { inserted: 0, updated: 0, kept: 0, same: 0, conflicts: 0 };
}

function emptyReport(): MergeReport {
  return {
    tables: {
      projects: emptyStat(),
      songs: emptyStat(),
      sessions: emptyStat(),
      takes: emptyStat(),
      picks: emptyStat(),
      retakes: emptyStat()
    },
    total: emptyStat()
  };
}

/**
 * 把一份整库备份逐条合并进本地库。
 * 全程单事务：合并失败（如备份行缺 id）会抛错并回滚成导入前的样子。
 */
export async function mergeSnapshot(snapshot: DatabaseSnapshot): Promise<MergeReport> {
  for (const name of MERGE_TABLES) {
    if (!Array.isArray(snapshot[name])) {
      throw new Error(`备份缺少 ${name} 数组，无法逐条合并`);
    }
  }

  const report = emptyReport();
  await db.transaction('rw', [...mergeTables(), db.mergeConflicts], async () => {
    for (const name of MERGE_TABLES) {
      const table = tableOf(name);
      const stat = report.tables[name];
      for (const raw of snapshot[name] as unknown[]) {
        const incoming = normalizeIncomingRow(raw);
        const local = await table.get(incoming.id);
        if (!local) {
          // 只有备份里有 → 直接并入
          await table.put(incoming);
          stat.inserted += 1;
          continue;
        }
        if (incoming.revision > local.revision) {
          // 只有对方动过 → 采用备份版
          await table.put(incoming);
          stat.updated += 1;
        } else if (incoming.revision < local.revision) {
          // 只有本地动过 → 保留本地版
          stat.kept += 1;
        } else if (rowsEquivalent(local, incoming)) {
          stat.same += 1;
        } else {
          // 两边都改动过同一条 → 两版并列留着，等人挑一版再落地
          const existing = await db.mergeConflicts
            .where('rowId')
            .equals(incoming.id)
            .filter((item) => item.table === name)
            .first();
          const conflict: MergeConflict = {
            id: existing?.id ?? createId('merge'),
            table: name,
            rowId: incoming.id,
            local: local as unknown as Record<string, unknown>,
            incoming: incoming as unknown as Record<string, unknown>,
            createdAt: Date.now()
          };
          await db.mergeConflicts.put(conflict);
          stat.conflicts += 1;
        }
      }
    }
    // 合并可能改到 Take 评级 → 剪接清单立刻重算
    await syncPicksWithGrades();
  });

  for (const name of MERGE_TABLES) {
    const stat = report.tables[name];
    report.total.inserted += stat.inserted;
    report.total.updated += stat.updated;
    report.total.kept += stat.kept;
    report.total.same += stat.same;
    report.total.conflicts += stat.conflicts;
  }
  return report;
}

/**
 * 冲突落地：人挑定一版之后才写回业务表。
 * 被选中的一版修订号抬到两版之上，让这次选择随下次导出传播，避免下回合并再翻旧账。
 */
export async function resolveMergeConflict(conflictId: string, choice: ConflictChoice): Promise<void> {
  await db.transaction('rw', [...mergeTables(), db.mergeConflicts], async () => {
    const conflict = await db.mergeConflicts.get(conflictId);
    if (!conflict) {
      throw new Error('冲突记录不存在或已被处理');
    }
    const table = tableOf(conflict.table);
    const local = await table.get(conflict.rowId);
    const incomingRevision =
      typeof conflict.incoming.revision === 'number' ? conflict.incoming.revision : ROW_REVISION;
    if (choice === 'incoming') {
      const incoming = normalizeIncomingRow(conflict.incoming);
      const base = Math.max(local?.revision ?? 0, incoming.revision);
      await table.put({ ...incoming, revision: base + 1, updatedAt: Date.now() });
    } else if (local) {
      await table.put({ ...local, revision: Math.max(local.revision, incomingRevision) + 1, updatedAt: Date.now() });
    }
    await db.mergeConflicts.delete(conflictId);
    // 落定的是 Take 时评级可能变化 → 剪接清单立刻重算
    if (conflict.table === 'takes') {
      await syncPicksWithGrades();
    }
  });
}
