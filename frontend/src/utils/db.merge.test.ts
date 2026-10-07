/**
 * db 逐条合并 / 冲突裁决 / 事务回滚集成自测（开发辅助，不进生产构建）
 * 运行：npx esbuild src/utils/db.merge.test.ts --bundle --platform=node --format=esm --outfile=/tmp/db.test.mjs && node /tmp/db.test.mjs
 */
import 'fake-indexeddb/auto';
import {
  db,
  exportSnapshot,
  mergeSnapshot,
  listConflicts,
  resolveConflict,
  putTake,
  updateTake,
  bulkUpdateGrade,
  countAll
} from './db';
import type { TakeRow, SessionRow, SongRow, ProjectRow } from './db';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}`, JSON.stringify(detail));
  }
}

function stamped<T extends object>(id: string, payload: T): T & { id: string; revision: number; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { id, ...payload, revision: 1, createdAt: now, updatedAt: now };
}

async function seedFixture(): Promise<void> {
  await db.projects.put(stamped('p1', { name: 'P', client: 'c', startDate: '2024-01-01', deliverDate: '2024-02-01', state: '录制中' }) as ProjectRow);
  await db.songs.put(stamped('s1', { projectId: 'p1', title: 'Song', durationSec: 100, arrangement: '乐队', state: '录制中' }) as SongRow);
  await db.sessions.put(
    stamped('ss1', { songId: 's1', date: '2024-03-01', period: '上午', engineer: 'E', roomNo: 'A 棚', musicians: '', state: '已排期' }) as SessionRow
  );
  const base = (id: string, grade: TakeRow['grade']): TakeRow =>
    stamped(id, { sessionId: 'ss1', takeNo: id, startTc: '00:00:01:00', endTc: '00:00:02:00', grade, issues: ['无'] }) as TakeRow;
  await putTake(base('t1', '待定')); // 冲突候选
  await putTake(base('t2', '可用')); // 仅导入侧会改
  await putTake(base('t3', '废')); // 仅本机会改
  await putTake(base('t4', '待定')); // 完全相同
}

async function main(): Promise<void> {
  await db.open();
  await seedFixture();

  console.log('本机改动：修订号随编辑 +1');
  await updateTake('t1', { grade: '可用' });
  await bulkUpdateGrade(['t3'], '可用');
  {
    const t1 = await db.takes.get('t1');
    const t3 = await db.takes.get('t3');
    check('单条编辑修订号 +1', t1?.revision === 2 && t1.grade === '可用', t1);
    check('批量改评级修订号 +1', t3?.revision === 2 && t3.grade === '可用', t3);
  }

  console.log('导出本机备份（带修订号），再模拟另一台离线电脑的改动');
  const localSnapshot = await exportSnapshot();
  check('备份带 revision', localSnapshot.takes.find((t) => t.id === 't1')?.revision === 2);

  // 另一台：在共同基线上改了 t1（同 rev 冲突）、t2（rev2 胜出）；新增 t5；没动 t3/t4
  const incomingSnapshot = structuredClone(localSnapshot);
  const it1 = incomingSnapshot.takes.find((t) => t.id === 't1')!;
  it1.grade = '废';
  it1.updatedAt = Date.now() + 1000;
  const it2 = incomingSnapshot.takes.find((t) => t.id === 't2')!;
  it2.grade = '废';
  it2.revision = 2;
  it2.updatedAt = Date.now() + 1000;
  incomingSnapshot.takes.push({
    id: 't5',
    sessionId: 'ss1',
    takeNo: 't5',
    startTc: '00:00:03:00',
    endTc: '00:00:04:00',
    grade: '待定',
    issues: ['无'],
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  console.log('逐条合并导入');
  const beforeCounts = await countAll();
  const result = await mergeSnapshot(incomingSnapshot);
  {
    check('新增 1（t5）', result.summary.added === 1, result.summary);
    check('并入 1（t2 导入 rev2）', result.summary.updated === 1, result.summary);
    check('冲突 1（t1 同 rev 两边都改）', result.summary.conflicted === 1, result.summary);
    check('t2 已被导入版覆盖', (await db.takes.get('t2'))?.grade === '废');
    check('t3 本机改动保留', (await db.takes.get('t3'))?.grade === '可用');
    check('t4 无变化保留', (await db.takes.get('t4'))?.grade === '待定');
    check('t5 已新增', (await db.takes.get('t5'))?.grade === '待定');
    const conflicts = await listConflicts();
    check('冲突表有 1 条 t1', conflicts.length === 1 && conflicts[0].rowId === 't1', conflicts);
    check('冲突两版并列（本机可用 / 导入废）', (conflicts[0].localVersion as unknown as TakeRow).grade === '可用' && (conflicts[0].incomingVersion as unknown as TakeRow).grade === '废');
  }

  console.log('冲突裁决：挑导入版落地，修订号 max+1');
  {
    const [conflict] = await listConflicts();
    await resolveConflict(conflict.id, 'incoming');
    const t1 = await db.takes.get('t1');
    check('t1 落地为导入版（废）', t1?.grade === '废', t1);
    check('落地修订号 = 3', t1?.revision === 3, t1);
    check('冲突已删除', (await listConflicts()).length === 0);
  }

  console.log('重复合并：自动消解后旧冲突被清理');
  {
    const stale = structuredClone(localSnapshot);
    const t = stale.takes.find((x) => x.id === 't1')!;
    t.grade = '待定';
    t.revision = 1;
    // t1 现在本机 rev3（已裁决），再来 rev1 内容不同 → 本机胜，不产生冲突
    await mergeSnapshot(stale);
    check('不会重新产生已消解的冲突', (await listConflicts()).length === 0);
  }

  console.log('旧备份缺修订号：回填为 1 后参与合并');
  {
    const legacy = structuredClone(localSnapshot);
    for (const row of [...legacy.takes, ...legacy.projects, ...legacy.songs, ...legacy.sessions, ...legacy.picks, ...legacy.retakes]) {
      delete (row as { revision?: number }).revision;
    }
    // 内容与当前一致时不冲突
    const countsBefore = await countAll();
    const r = await mergeSnapshot(legacy);
    check('旧备份同内容不产生冲突', r.summary.conflicted === 0, r.summary);
    check('旧备份行未覆盖本机较高修订号', (await db.takes.get('t1'))?.revision === 3);
    check('行数不变', (await countAll()).takes === countsBefore.takes);
  }

  console.log('非法备份：事务回滚成导入前的样子');
  {
    const before = await db.takes.toArray();
    const bad = structuredClone(localSnapshot);
    bad.takes.push({ id: 't9', sessionId: 'ss1', takeNo: 't9' } as never); // 缺业务字段，但有 id；先过结构校验
    // 结构校验（缺 id 场景）
    const bad2 = structuredClone(localSnapshot);
    (bad2.songs as unknown[]).push({ title: '无 id' });
    let threw = false;
    try {
      await mergeSnapshot(bad2 as never);
    } catch {
      threw = true;
    }
    check('缺 id 抛错', threw);
    check('失败后数据不变', JSON.stringify(await db.takes.toArray()) === JSON.stringify(before));
    void bad;
  }

  console.log('合并中途失败：整体回滚（写入冲突表前抛错）');
  {
    const before = await db.takes.toArray();
    const beforeConflicts = await db.conflicts.count();
    // 构造一个在事务内才会失败的场景：非法表名字段通过不了校验，所以改用重复 id 的脏行触发 bulkPut 后断言不变更——
    // 这里用 monkeypatch conflicts.bulkPut 抛错验证事务回滚
    const original = db.conflicts.bulkPut.bind(db.conflicts);
    db.conflicts.bulkPut = (() => {
      throw new Error('模拟磁盘错误');
    }) as typeof db.conflicts.bulkPut;
    const clash = structuredClone(localSnapshot);
    const t = clash.takes.find((x) => x.id === 't2')!;
    t.grade = '待定';
    t.revision = 1; // 当前 t2 rev2，内容不同 → rev 相同于？当前 rev2，导入 rev1 → 本机胜，无冲突
    // 制造冲突：找一条当前 rev1 的行，两侧同 rev 改不同
    const t4 = clash.takes.find((x) => x.id === 't4')!;
    t4.grade = '废';
    t4.updatedAt = Date.now() + 5000;
    let threw = false;
    try {
      await mergeSnapshot(clash);
    } catch (error) {
      threw = error instanceof Error && error.message.includes('模拟磁盘错误');
    }
    db.conflicts.bulkPut = original;
    check('事务内抛错冒泡', threw);
    check('takes 回滚为导入前', JSON.stringify(await db.takes.toArray()) === JSON.stringify(before));
    check('conflicts 回滚为导入前', (await db.conflicts.count()) === beforeConflicts);
  }

  void beforeCounts;
  if (failures > 0) {
    console.error(`\n${failures} 项失败`);
    process.exit(1);
  }
  console.log('\n全部通过');
  await db.close();
}

void main();
