/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbstudiotake-db，数据结构版本号 version(2) 与 upgrade() 迁移逻辑
 * - 项目 / 曲目 / 场次 / Take / 优选 / 补录 六张业务表分表存储
 * - conflicts 表暂存离线合并时「两边都改过」的同一条记录，等人挑一版再落地
 * - 首次打开自动播种互相引用的演示数据，保证每个页面打开都有内容
 */
import Dexie, { type Table } from 'dexie';
import type { Project } from '../types/project';
import type { Song } from '../types/song';
import type { Session } from '../types/session';
import type { Take } from '../types/take';
import type { Pick } from '../types/pick';
import type { Retake } from '../types/retake';
import type { ConflictTable, ConflictChoice, MergeConflict } from '../types/conflict';
import { nowIso, createId } from './uuid';
import { seedDatabase } from './seed';
import { INITIAL_LINE_REVISION, ROW_REVISION, nextLineRevision } from './revision';
import {
  buildMergePlan,
  resolvedRevision,
  summarizePlan,
  validateMergePayload,
  type MergeableRow,
  type MergeSummary
} from './merge';

/** 数据库名 */
export const DB_NAME = 'gbstudiotake-db';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

/** 行结构修订号（定义在叶子模块 ./revision，避免与 ./seed 形成循环依赖） */
export { ROW_REVISION };

export interface Revisioned {
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type ProjectRow = Project & Revisioned;
export type SongRow = Song & Revisioned;
export type SessionRow = Session & Revisioned;
export type TakeRow = Take & Revisioned;
export type PickRow = Pick & Revisioned;
export type RetakeRow = Retake & Revisioned;

/** 合并冲突持久化行：两个版本按表存原始记录，裁决时按 table 取回对应类型 */
export type ConflictRow = MergeConflict<MergeableRow> & Revisioned;

/** 备份里的行：历史备份可能缺修订号 / 时间戳，合并时按现有值回填 */
export type SnapshotRow<T> = T & Partial<Revisioned>;

const BUSINESS_TABLE_NAMES: ConflictTable[] = ['projects', 'songs', 'sessions', 'takes', 'picks', 'retakes'];

export class GbStudioTakeDatabase extends Dexie {
  projects!: Table<ProjectRow, string>;
  songs!: Table<SongRow, string>;
  sessions!: Table<SessionRow, string>;
  takes!: Table<TakeRow, string>;
  picks!: Table<PickRow, string>;
  retakes!: Table<RetakeRow, string>;
  /** 离线合并冲突：同一条被两边改动时，两版并列暂存于此 */
  conflicts!: Table<ConflictRow, string>;

  constructor() {
    super(DB_NAME);

    this.version(1)
      .stores({
        projects: 'id, name, client, state, startDate, updatedAt',
        songs: 'id, projectId, title, arrangement, state, updatedAt',
        sessions: 'id, songId, date, period, roomNo, engineer, state, updatedAt',
        takes: 'id, sessionId, takeNo, grade, startTc, updatedAt',
        picks: 'id, takeId, usage, order, updatedAt',
        retakes: 'id, songId, planDate, state, updatedAt'
      })
      .upgrade(async (tx) => {
        // v1 结构迁移：为历史行补齐行修订号与时间戳；新建库时各表为空，迁移天然幂等
        const tableNames = ['projects', 'songs', 'sessions', 'takes', 'picks', 'retakes'];
        for (const name of tableNames) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              row.revision = ROW_REVISION;
              if (typeof row.createdAt !== 'number') row.createdAt = Date.now();
              if (typeof row.updatedAt !== 'number') row.updatedAt = row.createdAt;
            });
        }
      });

    this.version(2)
      .stores({
        projects: 'id, name, client, state, startDate, updatedAt',
        songs: 'id, projectId, title, arrangement, state, updatedAt',
        sessions: 'id, songId, date, period, roomNo, engineer, state, updatedAt',
        takes: 'id, sessionId, takeNo, grade, startTc, updatedAt',
        picks: 'id, takeId, usage, order, updatedAt',
        retakes: 'id, songId, planDate, state, updatedAt',
        // [table+rowId] 复合索引：同一条记录只保留一个待裁决冲突，重新合并时先清旧再写新
        conflicts: 'id, [table+rowId], table, rowId'
      })
      .upgrade(async (tx) => {
        // 升级：已有数据没有修订号的，按现有值回填初始行修订号后再参与后续合并
        for (const name of BUSINESS_TABLE_NAMES) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              if (typeof row.revision !== 'number' || row.revision < INITIAL_LINE_REVISION) {
                row.revision = INITIAL_LINE_REVISION;
              }
              if (typeof row.createdAt !== 'number') row.createdAt = Date.now();
              if (typeof row.updatedAt !== 'number') row.updatedAt = row.createdAt;
            });
        }
      });
  }
}

export const db = new GbStudioTakeDatabase();

/** 打开数据库：首次使用时灌入演示数据（幂等：表非空不播） */
export async function initDatabase(): Promise<void> {
  await db.open();
  if ((await db.projects.count()) === 0) {
    await seedDatabase(db);
  }
}

/* ------------------------------ 项目 ------------------------------ */

export async function listProjects(): Promise<ProjectRow[]> {
  const rows = await db.projects.toArray();
  return rows.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export async function putProject(row: ProjectRow): Promise<void> {
  await db.projects.put(row);
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await db.projects.update(id, (row) => {
    Object.assign(row, patch, { revision: nextLineRevision(row.revision), updatedAt: Date.now() });
  });
}

/** 删除项目：级联删除曲目、场次、Take、优选与补录 */
export async function removeProject(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.songs, db.sessions, db.takes, db.picks, db.retakes], async () => {
    const songs = await db.songs.where('projectId').equals(id).toArray();
    for (const song of songs) {
      await cascadeRemoveSong(song.id);
    }
    await db.projects.delete(id);
  });
}

/* ------------------------------ 曲目 ------------------------------ */

export async function listSongs(): Promise<SongRow[]> {
  const rows = await db.songs.toArray();
  return rows.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
}

export async function putSong(row: SongRow): Promise<void> {
  await db.songs.put(row);
}

export async function updateSong(id: string, patch: Partial<Song>): Promise<void> {
  await db.songs.update(id, (row) => {
    Object.assign(row, patch, { revision: nextLineRevision(row.revision), updatedAt: Date.now() });
  });
}

async function cascadeRemoveSong(songId: string): Promise<void> {
  const sessions = await db.sessions.where('songId').equals(songId).toArray();
  const sessionIds = sessions.map((item) => item.id);
  if (sessionIds.length > 0) {
    const takes = await db.takes.where('sessionId').anyOf(sessionIds).toArray();
    const takeIds = takes.map((item) => item.id);
    if (takeIds.length > 0) {
      await db.picks.where('takeId').anyOf(takeIds).delete();
    }
    await db.takes.where('sessionId').anyOf(sessionIds).delete();
    await db.sessions.where('songId').equals(songId).delete();
  }
  await db.retakes.where('songId').equals(songId).delete();
  await db.songs.delete(songId);
}

export async function removeSong(id: string): Promise<void> {
  await db.transaction('rw', [db.songs, db.sessions, db.takes, db.picks, db.retakes], async () => {
    await cascadeRemoveSong(id);
  });
}

/* ------------------------------ 场次 ------------------------------ */

export async function listSessions(): Promise<SessionRow[]> {
  const rows = await db.sessions.toArray();
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function putSession(row: SessionRow): Promise<void> {
  await db.sessions.put(row);
}

export async function updateSession(id: string, patch: Partial<Session>): Promise<void> {
  await db.sessions.update(id, (row) => {
    Object.assign(row, patch, { revision: nextLineRevision(row.revision), updatedAt: Date.now() });
  });
}

/**
 * 校验棚号时段冲突：同一棚号同一日期同一时段只能有一场（已取消的除外）
 * @param selfId 编辑自身时排除
 */
export async function findRoomConflict(
  roomNo: string,
  date: string,
  period: string,
  selfId: string | null
): Promise<SessionRow | null> {
  const rows = await db.sessions
    .where('roomNo')
    .equals(roomNo)
    .filter((item) => item.date === date && item.period === period && item.state !== '已取消' && item.id !== selfId)
    .toArray();
  return rows[0] ?? null;
}

/** 删除场次：级联删除其 Take 与对应优选 */
export async function removeSession(id: string): Promise<void> {
  await db.transaction('rw', [db.sessions, db.takes, db.picks], async () => {
    const takes = await db.takes.where('sessionId').equals(id).toArray();
    const takeIds = takes.map((item) => item.id);
    if (takeIds.length > 0) {
      await db.picks.where('takeId').anyOf(takeIds).delete();
    }
    await db.takes.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}

/* ------------------------------ Take ------------------------------ */

export async function listTakes(): Promise<TakeRow[]> {
  return db.takes.toArray();
}

export async function putTake(row: TakeRow): Promise<void> {
  await db.takes.put(row);
}

export async function updateTake(id: string, patch: Partial<Take>): Promise<void> {
  await db.takes.update(id, (row) => {
    Object.assign(row, patch, { revision: nextLineRevision(row.revision), updatedAt: Date.now() });
  });
}

/** 批量改评级：每条都算一次改动，行修订号各自 +1，剪接清单与统计随后响应式重算 */
export async function bulkUpdateGrade(ids: string[], grade: Take['grade']): Promise<void> {
  await db.transaction('rw', [db.takes], async () => {
    await db.takes
      .where('id')
      .anyOf(ids)
      .modify((row) => {
        row.grade = grade;
        row.revision = nextLineRevision(row.revision);
        row.updatedAt = Date.now();
      });
  });
}

export async function removeTake(id: string): Promise<void> {
  await db.transaction('rw', [db.takes, db.picks], async () => {
    await db.picks.where('takeId').equals(id).delete();
    await db.takes.delete(id);
  });
}

/* ------------------------------ 优选 ------------------------------ */

export async function listPicks(): Promise<PickRow[]> {
  const rows = await db.picks.toArray();
  return rows.sort((a, b) => a.order - b.order);
}

export async function putPick(row: PickRow): Promise<void> {
  await db.picks.put(row);
}

export async function updatePick(id: string, patch: Partial<Pick>): Promise<void> {
  await db.picks.update(id, (row) => {
    Object.assign(row, patch, { revision: nextLineRevision(row.revision), updatedAt: Date.now() });
  });
}

/** 拖拽 / 上下移后按新顺序批量写回（每条修订号 +1） */
export async function reorderPicks(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', [db.picks], async () => {
    const now = Date.now();
    await db.picks
      .where('id')
      .anyOf(orderedIds)
      .modify((row) => {
        row.order = orderedIds.indexOf(row.id) + 1;
        row.revision = nextLineRevision(row.revision);
        row.updatedAt = now;
      });
  });
}

export async function nextPickOrder(): Promise<number> {
  const rows = await db.picks.toArray();
  return rows.reduce((max, row) => Math.max(max, row.order), 0) + 1;
}

export async function removePick(id: string): Promise<void> {
  await db.picks.delete(id);
}

/* ------------------------------ 补录 ------------------------------ */

export async function listRetakes(): Promise<RetakeRow[]> {
  const rows = await db.retakes.toArray();
  return rows.sort((a, b) => a.planDate.localeCompare(b.planDate));
}

export async function putRetake(row: RetakeRow): Promise<void> {
  await db.retakes.put(row);
}

export async function updateRetake(id: string, patch: Partial<Retake>): Promise<void> {
  await db.retakes.update(id, (row) => {
    Object.assign(row, patch, { revision: nextLineRevision(row.revision), updatedAt: Date.now() });
  });
}

/** 补录完成：联动曲目状态（补录与曲目行修订号各自 +1） */
export async function completeRetake(id: string): Promise<void> {
  await db.transaction('rw', [db.retakes, db.songs], async () => {
    const retake = await db.retakes.get(id);
    if (!retake) throw new Error('补录条目不存在');
    await db.retakes.update(id, (row) => {
      row.state = '已完成';
      row.revision = nextLineRevision(row.revision);
      row.updatedAt = Date.now();
    });
    const pending = await db.retakes
      .where('songId')
      .equals(retake.songId)
      .filter((item) => item.state !== '已完成' && item.id !== id)
      .count();
    await db.songs.update(retake.songId, (row) => {
      row.state = pending === 0 ? '已完成' : '录制中';
      row.revision = nextLineRevision(row.revision);
      row.updatedAt = Date.now();
    });
  });
}

export async function removeRetake(id: string): Promise<void> {
  await db.retakes.delete(id);
}

/* --------------------------- 整库导出 / 逐条合并导入 --------------------------- */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  projects: SnapshotRow<Project>[];
  songs: SnapshotRow<Song>[];
  sessions: SnapshotRow<Session>[];
  takes: SnapshotRow<Take>[];
  picks: SnapshotRow<Pick>[];
  retakes: SnapshotRow<Retake>[];
}

/** 导出整库备份：保留每行 revision / 时间戳，供对侧逐条合并 */
export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [projects, songs, sessions, takes, picks, retakes] = await Promise.all([
    db.projects.toArray(),
    db.songs.toArray(),
    db.sessions.toArray(),
    db.takes.toArray(),
    db.picks.toArray(),
    db.retakes.toArray()
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    projects,
    songs,
    sessions,
    takes,
    picks,
    retakes
  };
}

export interface MergeResult {
  summary: MergeSummary;
  /** 各表明细，用于导入后提示 */
  byTable: Record<ConflictTable, MergeSummary>;
}

/**
 * 逐条合并导入（替代整包覆盖）：
 * 同 id 的行先比行修订号，只有一边动过的直接并入，两边都动过的两版并列存入 conflicts。
 * 全部在单个 rw 事务内完成：任何一步失败都会回滚成导入前的样子，不会落一半数据。
 */
export async function mergeSnapshot(snapshot: DatabaseSnapshot): Promise<MergeResult> {
  // 结构校验放在事务外：非法备份不开启事务，数据原样不动
  validateMergePayload(snapshot as Partial<Record<ConflictTable, unknown>>);

  return db.transaction(
    'rw',
    [db.projects, db.songs, db.sessions, db.takes, db.picks, db.retakes, db.conflicts],
    async () => {
      const [localProjects, localSongs, localSessions, localTakes, localPicks, localRetakes] = await Promise.all([
        db.projects.toArray(),
        db.songs.toArray(),
        db.sessions.toArray(),
        db.takes.toArray(),
        db.picks.toArray(),
        db.retakes.toArray()
      ]);

      const local: Record<ConflictTable, MergeableRow[]> = {
        projects: localProjects,
        songs: localSongs,
        sessions: localSessions,
        takes: localTakes,
        picks: localPicks,
        retakes: localRetakes
      };
      const incoming: Record<ConflictTable, MergeableRow[]> = {
        projects: snapshot.projects,
        songs: snapshot.songs,
        sessions: snapshot.sessions,
        takes: snapshot.takes,
        picks: snapshot.picks,
        retakes: snapshot.retakes
      };

      const plan = buildMergePlan(local, incoming);

      // 写回自动并入的行（新增 / 高修订号胜出）
      await db.projects.bulkPut(plan.projects.puts as ProjectRow[]);
      await db.songs.bulkPut(plan.songs.puts as SongRow[]);
      await db.sessions.bulkPut(plan.sessions.puts as SessionRow[]);
      await db.takes.bulkPut(plan.takes.puts as TakeRow[]);
      await db.picks.bulkPut(plan.picks.puts as PickRow[]);
      await db.retakes.bulkPut(plan.retakes.puts as RetakeRow[]);

      // 同一 (table,rowId) 只留一个待裁决冲突：先删旧冲突（可能已被本次自动合并消解），再并列写入新冲突
      const conflictPairs = BUSINESS_TABLE_NAMES.flatMap((table) =>
        plan[table].conflicts.map((item) => [table, item.rowId] as [ConflictTable, string])
      );
      if (conflictPairs.length > 0) {
        await db.conflicts.where('[table+rowId]').anyOf(conflictPairs).delete();
      }
      const now = Date.now();
      const conflictRows: ConflictRow[] = BUSINESS_TABLE_NAMES.flatMap((table) =>
        plan[table].conflicts.map((item) => ({
          id: createId('conflict'),
          table,
          rowId: item.rowId,
          localVersion: item.localVersion,
          incomingVersion: item.incomingVersion,
          localRevision: item.localRevision,
          incomingRevision: item.incomingRevision,
          detectedAt: nowIso(),
          revision: INITIAL_LINE_REVISION,
          createdAt: now,
          updatedAt: now
        }))
      );
      if (conflictRows.length > 0) {
        await db.conflicts.bulkPut(conflictRows);
      }

      const byTable = BUSINESS_TABLE_NAMES.reduce(
        (acc, table) => {
          acc[table] = {
            added: plan[table].added,
            updated: plan[table].updated,
            unchanged: plan[table].unchanged,
            conflicted: plan[table].conflicted
          };
          return acc;
        },
        {} as Record<ConflictTable, MergeSummary>
      );

      return { summary: summarizePlan(plan), byTable };
    }
  );
}

/** 列出全部待裁决冲突（最近产生的在前） */
export async function listConflicts(): Promise<ConflictRow[]> {
  const rows = await db.conflicts.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 冲突裁决：挑一版落地到对应业务表（评级等字段落地后，剪接清单与统计照常响应式重算），
 * 落地行修订号在两版之上再 +1，随后删除冲突。单事务完成，失败整体回滚。
 */
export async function resolveConflict(conflictId: string, choice: ConflictChoice): Promise<void> {
  const conflict = await db.conflicts.get(conflictId);
  if (!conflict) throw new Error('该冲突已被处理或不存在');

  await db.transaction('rw', [db.conflicts, db.table(conflict.table)], async () => {
    const chosen = (choice === 'local' ? conflict.localVersion : conflict.incomingVersion) as MergeableRow;
    const now = Date.now();
    const landed: MergeableRow = {
      ...chosen,
      id: conflict.rowId,
      revision: resolvedRevision(conflict.localRevision, conflict.incomingRevision),
      createdAt: typeof chosen.createdAt === 'number' ? chosen.createdAt : now,
      updatedAt: now
    };
    await db.table<MergeableRow, string>(conflict.table).put(landed);
    await db.conflicts.delete(conflictId);
  });
}

/** 放弃冲突（删除并列两版，不改动业务表当前落地行） */
export async function removeConflict(conflictId: string): Promise<void> {
  await db.conflicts.delete(conflictId);
}

/** 清空全部数据并重新灌入演示数据（同时清掉待裁决冲突） */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.projects, db.songs, db.sessions, db.takes, db.picks, db.retakes, db.conflicts],
    async () => {
      await Promise.all([
        db.projects.clear(),
        db.songs.clear(),
        db.sessions.clear(),
        db.takes.clear(),
        db.picks.clear(),
        db.retakes.clear(),
        db.conflicts.clear()
      ]);
    }
  );
  await seedDatabase(db);
}

/** 各表行数统计（含待裁决冲突数） */
export async function countAll(): Promise<Record<string, number>> {
  const [projects, songs, sessions, takes, picks, retakes, conflicts] = await Promise.all([
    db.projects.count(),
    db.songs.count(),
    db.sessions.count(),
    db.takes.count(),
    db.picks.count(),
    db.retakes.count(),
    db.conflicts.count()
  ]);
  return { projects, songs, sessions, takes, picks, retakes, conflicts };
}
