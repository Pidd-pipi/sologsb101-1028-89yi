/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbstudiotake-db，结构版本 version(2)，带 upgrade() 迁移逻辑
 *   （为没有修订号的历史行按现有值回填 revision / createdAt / updatedAt，回填后才参与逐条合并）
 * - 项目 / 曲目 / 场次 / Take / 优选 / 补录 六张业务表 + mergeConflicts 合并冲突暂存表
 * - 行修订号 revision 是逐行改动计数：新建为 ROW_REVISION，之后每次改动 +1，
 *   两台电脑离线各改一份后，逐条合并导入靠它判断同一行谁先谁后（见 utils/merge.ts）
 * - 首次打开自动播种互相引用的演示数据，保证每个页面打开都有内容
 */
import Dexie, { type Table } from 'dexie';
import type { Project } from '../types/project';
import type { Song } from '../types/song';
import type { Session } from '../types/session';
import type { Take } from '../types/take';
import type { Pick } from '../types/pick';
import type { Retake } from '../types/retake';
import type { MergeConflict } from '../types/merge';
import { nowIso } from './uuid';
import { seedDatabase } from './seed';
import { ROW_REVISION, backfillRevisionFields } from './revision';

/** 数据库名 */
export const DB_NAME = 'gbstudiotake-db';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

/** 行修订号（定义在叶子模块 ./revision，避免与 ./seed 形成循环依赖） */
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

/** 参与结构迁移回填的六张业务表 */
const BUSINESS_TABLES = ['projects', 'songs', 'sessions', 'takes', 'picks', 'retakes'];

export class GbStudioTakeDatabase extends Dexie {
  projects!: Table<ProjectRow, string>;
  songs!: Table<SongRow, string>;
  sessions!: Table<SessionRow, string>;
  takes!: Table<TakeRow, string>;
  picks!: Table<PickRow, string>;
  retakes!: Table<RetakeRow, string>;
  /** 合并冲突暂存：两边都改过的行两版并列存在这里，人挑一版后才落地 */
  mergeConflicts!: Table<MergeConflict, string>;

  constructor(name: string = DB_NAME) {
    super(name);

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
        // 结构迁移：为历史行按现有值补齐行修订号与时间戳；新建库时各表为空，迁移天然幂等
        for (const name of BUSINESS_TABLES) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              backfillRevisionFields(row);
            });
        }
      });

    this.version(2)
      .stores({
        // 新增合并冲突暂存表；六张业务表结构不变，无需重复声明
        mergeConflicts: 'id, table, rowId, createdAt'
      })
      .upgrade(async (tx) => {
        // 没有修订号的历史行按现有值回填（createdAt ↔ updatedAt 互相兜底），回填后再参与逐条合并
        for (const name of BUSINESS_TABLES) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              backfillRevisionFields(row);
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

type AnyRow = { id: string } & Revisioned;

/**
 * 局部更新一行并把行修订号 +1（修订号是逐条合并导入的比较依据）。
 * 历史行若没有修订号，先按 ROW_REVISION 兜底再递增。
 */
async function patchRow<R extends AnyRow>(table: Table<R, string>, id: string, patch: Partial<R>): Promise<void> {
  await table
    .where('id')
    .equals(id)
    .modify((row) => {
      Object.assign(row, patch);
      row.revision = (typeof row.revision === 'number' ? row.revision : ROW_REVISION) + 1;
      row.updatedAt = Date.now();
    });
}

/**
 * 剪接清单随评级重算：把评级不再是「可用」的条次从优选清单移出，
 * 剩余条目按原顺序重新编号；返回被移出的条数。
 * 各页面的统计数字由 liveQuery 订阅驱动，数据一落地就自动重算。
 */
export async function syncPicksWithGrades(): Promise<number> {
  return db.transaction('rw', [db.takes, db.picks], async () => {
    const usableIds = new Set(
      (await db.takes.toArray())
        .filter((take) => take.grade === '可用')
        .map((take) => take.id)
    );
    const picks = (await db.picks.toArray()).sort((a, b) => a.order - b.order);
    const stale = picks.filter((pick) => !usableIds.has(pick.takeId));
    if (stale.length > 0) {
      await db.picks.bulkDelete(stale.map((pick) => pick.id));
    }
    const survivors = picks.filter((pick) => usableIds.has(pick.takeId));
    for (let index = 0; index < survivors.length; index += 1) {
      if (survivors[index].order !== index + 1) {
        await patchRow(db.picks, survivors[index].id, { order: index + 1 });
      }
    }
    return stale.length;
  });
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
  await patchRow(db.projects, id, patch);
}

/** 删除项目：级联删除其曲目、场次、Take、优选与补录 */
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
  await patchRow(db.songs, id, patch);
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
  await patchRow(db.sessions, id, patch);
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

/** 更新条次；评级一改动就重算剪接清单，返回被移出清单的优选条数 */
export async function updateTake(id: string, patch: Partial<Take>): Promise<number> {
  await patchRow(db.takes, id, patch);
  if (patch.grade !== undefined) {
    return syncPicksWithGrades();
  }
  return 0;
}

/** 批量改评级；改完重算剪接清单，返回被移出清单的优选条数 */
export async function bulkUpdateGrade(ids: string[], grade: Take['grade']): Promise<number> {
  await db.transaction('rw', [db.takes], async () => {
    for (const id of ids) {
      await patchRow(db.takes, id, { grade });
    }
  });
  return syncPicksWithGrades();
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
  await patchRow(db.picks, id, patch);
}

/** 拖拽 / 上下移后按新顺序批量写回 */
export async function reorderPicks(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', [db.picks], async () => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await patchRow(db.picks, orderedIds[index], { order: index + 1 });
    }
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
  await patchRow(db.retakes, id, patch);
}

/** 补录完成：联动曲目状态 */
export async function completeRetake(id: string): Promise<void> {
  await db.transaction('rw', [db.retakes, db.songs], async () => {
    const retake = await db.retakes.get(id);
    if (!retake) throw new Error('补录条目不存在');
    await patchRow(db.retakes, id, { state: '已完成' });
    const pending = await db.retakes
      .where('songId')
      .equals(retake.songId)
      .filter((item) => item.state !== '已完成' && item.id !== id)
      .count();
    await patchRow(db.songs, retake.songId, { state: pending === 0 ? '已完成' : '录制中' });
  });
}

export async function removeRetake(id: string): Promise<void> {
  await db.retakes.delete(id);
}

/* --------------------------- 整库导出与重置 --------------------------- */

/**
 * 整库备份快照。每行都带 revision / createdAt / updatedAt：
 * 逐条合并导入要靠行修订号判断同一行谁先谁后，导出时不能剥掉。
 */
export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  projects: ProjectRow[];
  songs: SongRow[];
  sessions: SessionRow[];
  takes: TakeRow[];
  picks: PickRow[];
  retakes: RetakeRow[];
}

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

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', [db.projects, db.songs, db.sessions, db.takes, db.picks, db.retakes, db.mergeConflicts], async () => {
    await Promise.all([
      db.projects.clear(),
      db.songs.clear(),
      db.sessions.clear(),
      db.takes.clear(),
      db.picks.clear(),
      db.retakes.clear(),
      db.mergeConflicts.clear()
    ]);
  });
  await seedDatabase(db);
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [projects, songs, sessions, takes, picks, retakes, mergeConflicts] = await Promise.all([
    db.projects.count(),
    db.songs.count(),
    db.sessions.count(),
    db.takes.count(),
    db.picks.count(),
    db.retakes.count(),
    db.mergeConflicts.count()
  ]);
  return { projects, songs, sessions, takes, picks, retakes, mergeConflicts };
}
