/**
 * 逐条合并导入的测试：
 * - 同一条先比行修订号，只有一边动过的直接并进来
 * - 两边都改动过 → 两版并列存进 mergeConflicts，挑一版再落地
 * - 合并失败整体回滚成导入前的样子
 * - Take 评级一改动，剪接清单就重算（移出失效优选并重排顺序）
 * - 没有修订号的历史数据：升级 / 导入时按现有值回填后再参与合并
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie, { type Table } from 'dexie';
import {
  GbStudioTakeDatabase,
  bulkUpdateGrade,
  db,
  exportSnapshot,
  syncPicksWithGrades,
  updateTake,
  type DatabaseSnapshot,
  type PickRow,
  type TakeRow
} from '../db';
import { mergeSnapshot, normalizeIncomingRow, resolveMergeConflict, rowsEquivalent } from '../merge';
import { ROW_REVISION } from '../revision';

const NOW = 1_700_000_000_000;

function takeRow(partial: Partial<TakeRow> & { id: string }): TakeRow {
  return {
    sessionId: 'ss-1',
    takeNo: 'T01',
    startTc: '00:00:01:00',
    endTc: '00:00:05:00',
    grade: '待定',
    issues: ['无'],
    revision: ROW_REVISION,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial
  };
}

function pickRow(partial: Partial<PickRow> & { id: string; takeId: string }): PickRow {
  return {
    usage: '主歌',
    order: 1,
    note: '',
    revision: ROW_REVISION,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial
  };
}

function emptySnapshot(): DatabaseSnapshot {
  return {
    name: 'gbstudiotake-db',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    projects: [],
    songs: [],
    sessions: [],
    takes: [],
    picks: [],
    retakes: []
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('行修订号', () => {
  it('每次改动修订号 +1，updatedAt 刷新', async () => {
    await db.takes.put(takeRow({ id: 'tk-1' }));
    await updateTake('tk-1', { takeNo: 'T09' });
    const row = await db.takes.get('tk-1');
    expect(row?.revision).toBe(ROW_REVISION + 1);
    expect(row?.updatedAt).toBeGreaterThanOrEqual(row?.createdAt ?? 0);
    await updateTake('tk-1', { takeNo: 'T10' });
    expect((await db.takes.get('tk-1'))?.revision).toBe(ROW_REVISION + 2);
  });

  it('内容比较忽略修订号与时间戳', () => {
    const a = takeRow({ id: 'tk-1' });
    const b = { ...a, revision: 9, updatedAt: NOW + 1000 };
    expect(rowsEquivalent(a, b)).toBe(true);
    expect(rowsEquivalent(a, { ...a, grade: '废' })).toBe(false);
  });

  it('没有修订号的旧行按现有值回填', () => {
    const row = normalizeIncomingRow({ id: 'tk-x', updatedAt: 123 });
    expect(row.revision).toBe(ROW_REVISION);
    expect(row.createdAt).toBe(123);
    expect(row.updatedAt).toBe(123);
    const both = normalizeIncomingRow({ id: 'tk-y', createdAt: 10, updatedAt: 20, revision: 7 });
    expect(both.revision).toBe(7);
    expect(both.createdAt).toBe(10);
    expect(both.updatedAt).toBe(20);
  });

  it('缺 id 的行直接报错', () => {
    expect(() => normalizeIncomingRow({ takeNo: 'T01' })).toThrow(/id/);
  });
});

describe('逐条合并导入', () => {
  it('只有备份动过（修订号更高）→ 直接并入', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '待定' }));
    const snapshot = await exportSnapshot();
    snapshot.takes[0] = { ...snapshot.takes[0], grade: '可用', revision: ROW_REVISION + 1 };

    const report = await mergeSnapshot(snapshot);

    expect(report.tables.takes.updated).toBe(1);
    const row = await db.takes.get('tk-1');
    expect(row?.grade).toBe('可用');
    expect(row?.revision).toBe(ROW_REVISION + 1);
  });

  it('只有本地动过（本地修订号更高）→ 保留本地', async () => {
    await db.takes.put(takeRow({ id: 'tk-1' }));
    const snapshot = await exportSnapshot();
    await updateTake('tk-1', { grade: '废' });

    const report = await mergeSnapshot(snapshot);

    expect(report.tables.takes.kept).toBe(1);
    const row = await db.takes.get('tk-1');
    expect(row?.grade).toBe('废');
    expect(row?.revision).toBe(ROW_REVISION + 1);
  });

  it('只有备份里有 → 直接插入', async () => {
    const snapshot = emptySnapshot();
    snapshot.takes = [takeRow({ id: 'tk-new', grade: '可用' })];

    const report = await mergeSnapshot(snapshot);

    expect(report.tables.takes.inserted).toBe(1);
    expect((await db.takes.get('tk-new'))?.grade).toBe('可用');
  });

  it('两边内容一致 → 无需改动', async () => {
    await db.takes.put(takeRow({ id: 'tk-1' }));
    const snapshot = await exportSnapshot();

    const report = await mergeSnapshot(snapshot);

    expect(report.tables.takes.same).toBe(1);
    expect(report.total.conflicts).toBe(0);
  });

  it('两边都改动过同一条 → 两版并列留着，本地库暂不被动', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '待定' }));
    const snapshot = await exportSnapshot();
    await updateTake('tk-1', { grade: '废' }); // 本地改：rev 2
    snapshot.takes[0] = { ...snapshot.takes[0], grade: '可用', revision: ROW_REVISION + 1 }; // 对方也改：rev 2

    const report = await mergeSnapshot(snapshot);

    expect(report.tables.takes.conflicts).toBe(1);
    // 本地版保持不动，导入版没有直接盖上来
    expect((await db.takes.get('tk-1'))?.grade).toBe('废');
    const conflicts = await db.mergeConflicts.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].table).toBe('takes');
    expect(conflicts[0].rowId).toBe('tk-1');
    expect(conflicts[0].local.grade).toBe('废');
    expect(conflicts[0].incoming.grade).toBe('可用');
  });

  it('挑「采用导入版」→ 导入版落地且修订号抬到两版之上', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '待定' }));
    const snapshot = await exportSnapshot();
    await updateTake('tk-1', { grade: '废' });
    snapshot.takes[0] = { ...snapshot.takes[0], grade: '可用', revision: ROW_REVISION + 1 };
    await mergeSnapshot(snapshot);
    const conflict = (await db.mergeConflicts.toArray())[0];

    await resolveMergeConflict(conflict.id, 'incoming');

    const row = await db.takes.get('tk-1');
    expect(row?.grade).toBe('可用');
    expect(row?.revision).toBe(ROW_REVISION + 2);
    expect(await db.mergeConflicts.count()).toBe(0);
  });

  it('挑「保留本地版」→ 本地版留库且修订号抬高，选择随下次合并生效', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '待定' }));
    const snapshot = await exportSnapshot();
    await updateTake('tk-1', { grade: '废' });
    snapshot.takes[0] = { ...snapshot.takes[0], grade: '可用', revision: ROW_REVISION + 1 };
    await mergeSnapshot(snapshot);
    const conflict = (await db.mergeConflicts.toArray())[0];

    await resolveMergeConflict(conflict.id, 'local');

    const row = await db.takes.get('tk-1');
    expect(row?.grade).toBe('废');
    expect(row?.revision).toBe(ROW_REVISION + 2);
    expect(await db.mergeConflicts.count()).toBe(0);
    // 对方拿同一份备份再来合并时，本地修订号更高 → 直接保留本地，不再起冲突
    const again = await mergeSnapshot(snapshot);
    expect(again.tables.takes.kept).toBe(1);
    expect(again.tables.takes.conflicts).toBe(0);
  });

  it('没有修订号的旧备份：回填后按同修订号参与合并，内容不同起冲突而不是硬盖', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '待定' }));
    const snapshot = await exportSnapshot();
    const legacy = snapshot.takes[0] as unknown as Record<string, unknown>;
    delete legacy.revision;
    delete legacy.createdAt;
    delete legacy.updatedAt;
    legacy.grade = '可用';

    const report = await mergeSnapshot(snapshot);

    expect(report.tables.takes.conflicts).toBe(1);
    expect((await db.takes.get('tk-1'))?.grade).toBe('待定');
    const conflict = (await db.mergeConflicts.toArray())[0];
    expect(conflict.incoming.revision).toBe(ROW_REVISION);
  });

  it('合并失败 → 整体回滚成导入前的样子', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '待定' }));
    const snapshot = await exportSnapshot();
    snapshot.takes[0] = { ...snapshot.takes[0], grade: '可用', revision: ROW_REVISION + 1 };
    // 靠后的表里塞一行缺 id 的坏数据，让合并在中途失败
    snapshot.retakes = [{ reason: '坏行' } as never];

    await expect(mergeSnapshot(snapshot)).rejects.toThrow(/id/);

    // 前面已合并的 takes 也一并回滚，库保持导入前的样子
    const row = await db.takes.get('tk-1');
    expect(row?.grade).toBe('待定');
    expect(row?.revision).toBe(ROW_REVISION);
    expect(await db.mergeConflicts.count()).toBe(0);
    expect(await db.retakes.count()).toBe(0);
  });

  it('备份缺表 → 直接拒绝且不动本地数据', async () => {
    await db.takes.put(takeRow({ id: 'tk-1' }));
    const broken = emptySnapshot();
    broken.picks = undefined as never;

    await expect(mergeSnapshot(broken)).rejects.toThrow(/picks/);
    expect(await db.takes.count()).toBe(1);
  });
});

describe('评级改动 → 剪接清单重算', () => {
  it('批量改评级后，失效优选被移出，剩余顺序重排', async () => {
    await db.takes.bulkPut([takeRow({ id: 'tk-1', grade: '可用' }), takeRow({ id: 'tk-2', takeNo: 'T02', grade: '可用' })]);
    await db.picks.bulkPut([pickRow({ id: 'pk-1', takeId: 'tk-1', order: 1 }), pickRow({ id: 'pk-2', takeId: 'tk-2', order: 2 })]);

    const pruned = await bulkUpdateGrade(['tk-1'], '废');

    expect(pruned).toBe(1);
    const picks = await db.picks.toArray();
    expect(picks).toHaveLength(1);
    expect(picks[0].takeId).toBe('tk-2');
    expect(picks[0].order).toBe(1);
  });

  it('单条改评级同样触发重算；不动评级则不动清单', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '可用' }));
    await db.picks.put(pickRow({ id: 'pk-1', takeId: 'tk-1', order: 1 }));

    expect(await updateTake('tk-1', { grade: '待定' })).toBe(1);
    expect(await db.picks.count()).toBe(0);

    await db.picks.put(pickRow({ id: 'pk-2', takeId: 'tk-1', order: 1 }));
    expect(await updateTake('tk-1', { takeNo: 'T08' })).toBe(0);
    expect(await db.picks.count()).toBe(1);
  });

  it('合并把评级改废后，清单在同事务里重算', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '可用' }));
    await db.picks.put(pickRow({ id: 'pk-1', takeId: 'tk-1', order: 1 }));
    const snapshot = await exportSnapshot();
    snapshot.takes[0] = { ...snapshot.takes[0], grade: '废', revision: ROW_REVISION + 1 };

    await mergeSnapshot(snapshot);

    expect(await db.picks.count()).toBe(0);
  });

  it('冲突落地采用导入版后，清单同样重算', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '可用' }));
    await db.picks.put(pickRow({ id: 'pk-1', takeId: 'tk-1', order: 1 }));
    const snapshot = await exportSnapshot();
    await updateTake('tk-1', { grade: '待定' }); // 本地改（触发一次重算，清单先被移出）
    await db.picks.put(pickRow({ id: 'pk-2', takeId: 'tk-1', order: 1 })); // 人为再放回一条，模拟后续又加的优选
    snapshot.takes[0] = { ...snapshot.takes[0], grade: '废', revision: ROW_REVISION + 1 };
    await mergeSnapshot(snapshot);
    const conflict = (await db.mergeConflicts.toArray())[0];

    await resolveMergeConflict(conflict.id, 'incoming');

    expect((await db.takes.get('tk-1'))?.grade).toBe('废');
    expect(await db.picks.count()).toBe(0);
  });

  it('syncPicksWithGrades 幂等：没有失效优选时返回 0', async () => {
    await db.takes.put(takeRow({ id: 'tk-1', grade: '可用' }));
    await db.picks.put(pickRow({ id: 'pk-1', takeId: 'tk-1', order: 1 }));
    expect(await syncPicksWithGrades()).toBe(0);
    expect((await db.picks.get('pk-1'))?.order).toBe(1);
  });
});

describe('结构升级回填', () => {
  interface LegacyTake {
    id: string;
    sessionId: string;
    takeNo: string;
    grade: string;
    updatedAt?: number;
  }
  class LegacyDb extends Dexie {
    takes!: Table<LegacyTake, string>;
    constructor() {
      super('gbstudiotake-legacy-upgrade-test');
      this.version(1).stores({ takes: 'id, sessionId, takeNo, grade, startTc, updatedAt' });
    }
  }

  it('没有修订号的 v1 历史库升级到 v2：按现有值回填，并新增 mergeConflicts 表', async () => {
    const legacyName = 'gbstudiotake-legacy-upgrade-test';
    let legacy: LegacyDb | null = null;
    let upgraded: GbStudioTakeDatabase | null = null;
    try {
      legacy = new LegacyDb();
      await legacy.takes.put({
        id: 'tk-old',
        sessionId: 'ss-1',
        takeNo: 'T01',
        grade: '可用',
        updatedAt: 456
      });
      await legacy.close();
      legacy = null;

      upgraded = new GbStudioTakeDatabase(legacyName);
      await upgraded.open();
      const row = await upgraded.takes.get('tk-old');
      // 按现有值回填：revision 补为初始修订号，createdAt 沿用现有 updatedAt
      expect(row?.revision).toBe(ROW_REVISION);
      expect(row?.createdAt).toBe(456);
      expect(row?.updatedAt).toBe(456);
      expect(upgraded.tables.map((table) => table.name)).toContain('mergeConflicts');
      await upgraded.close();
      upgraded = null;
    } finally {
      legacy?.close();
      upgraded?.close();
      await Dexie.delete(legacyName);
    }
  });
});
