/**
 * 逐条合并引擎自测（开发辅助，不进生产构建）
 * 运行：npx esbuild src/utils/merge.test.ts --bundle --platform=node --format=esm --outfile=/tmp/merge.test.mjs && node /tmp/merge.test.mjs
 */
import {
  buildMergePlan,
  mergeTable,
  normalizeIncoming,
  sameBusinessFields,
  summarizePlan,
  validateMergePayload,
  resolvedRevision,
  type MergeableRow
} from './merge';
import type { ConflictTable } from '../types/conflict';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}`, detail ?? '');
  }
}

function take(id: string, grade: string, revision?: number): TakeMergeRow {
  return { id, sessionId: 'ss-1', takeNo: id, startTc: '00:00:01:00', endTc: '00:00:02:00', grade, issues: ['无'], ...(revision ? { revision } : {}) };
}

interface TakeMergeRow extends MergeableRow {
  sessionId: string;
  takeNo: string;
  startTc: string;
  endTc: string;
  grade: string;
  issues: string[];
}

console.log('回填：历史行缺修订号');
{
  const row = normalizeIncoming({ id: 'x', grade: '废' } as MergeableRow, 1000);
  check('revision 回填为 1', row.revision === 1, row);
  check('时间戳回填', row.createdAt === 1000 && row.updatedAt === 1000);
}

console.log('业务字段比较忽略修订号 / 时间戳');
{
  check('同内容不同修订号视为相同', sameBusinessFields(take('a', '可用', 1), take('a', '可用', 3)));
  check('评级不同视为不同', !sameBusinessFields(take('a', '可用', 1), take('a', '废', 1)));
}

console.log('单表逐条合并');
{
  const local = [take('only-local', '可用', 2), take('both-new', '废', 1), take('remote-new', '待定', 3), take('conflict', '可用', 2), take('same', '可用', 1)];
  const incoming = [
    take('only-incoming', '可用', 1),
    take('both-new', '可用', 2),
    take('remote-new', '可用', 2),
    take('conflict', '废', 2),
    take('same', '可用', 1)
  ];
  const result = mergeTable(local, incoming);
  check('仅导入侧有的新增', result.added === 1 && result.puts.some((r) => r.id === 'only-incoming'), result);
  check('仅本机有的保留不动', !result.puts.some((r) => r.id === 'only-local'));
  check('导入修订号更大 → 并入', result.puts.some((r) => r.id === 'both-new' && r.grade === '可用'), result.puts);
  check('本机修订号更大 → 本机保留', !result.puts.some((r) => r.id === 'remote-new'));
  check('同修订号且内容不同 → 冲突两版并列', result.conflicted === 1 && result.conflicts[0].rowId === 'conflict', result.conflicts);
  const conflict = result.conflicts[0];
  check('冲突保留两版内容', conflict.localVersion.grade === '可用' && conflict.incomingVersion.grade === '废');
  check('内容一致 → 无变化', result.unchanged >= 1);
}

console.log('两边都多次改动：修订号大者代表只被一边继续改过');
{
  // 共同基线 rev1；录音师本机改了 2 次（rev3），制作人那边没动这条（rev1）
  const result = mergeTable([take('a', '废', 3)], [take('a', '待定', 1)]);
  check('本机 rev3 胜出', !result.puts.some((r) => r.id === 'a') && result.unchanged === 1);
  const result2 = mergeTable([take('a', '废', 1)], [take('a', '待定', 3)]);
  check('导入 rev3 胜出', result2.puts.some((r) => r.id === 'a' && r.grade === '待定'));
}

console.log('旧备份整体合并：缺修订号回填后同内容不冲突');
{
  const local: Record<ConflictTable, MergeableRow[]> = {
    projects: [],
    songs: [],
    sessions: [],
    takes: [take('a', '可用', 1)],
    picks: [],
    retakes: []
  };
  const incoming: Record<ConflictTable, MergeableRow[]> = {
    projects: [],
    songs: [],
    sessions: [],
    takes: [{ ...take('a', '可用') }],
    picks: [],
    retakes: []
  };
  const plan = buildMergePlan(local, incoming);
  check('历史行回填后同内容无冲突', plan.takes.unchanged === 1 && plan.takes.conflicted === 0, plan.takes);
  check('汇总为 0 冲突', summarizePlan(plan).conflicted === 0);
}

console.log('校验：缺数组 / 缺 id 直接失败');
{
  let threw = false;
  try {
    validateMergePayload({ projects: [], songs: [], sessions: [], takes: [{ id: 1 } as unknown as MergeableRow], picks: [], retakes: [] });
  } catch {
    threw = true;
  }
  check('id 非字符串抛错', threw);
  threw = false;
  try {
    validateMergePayload({ projects: [], songs: [], sessions: [], takes: [], picks: [] });
  } catch {
    threw = true;
  }
  check('缺 retakes 数组抛错', threw);
}

console.log('裁决落地修订号在两版之上 +1');
{
  check('resolvedRevision = max + 1', resolvedRevision(3, 5) === 6);
  check('resolvedRevision 不低于初始值', resolvedRevision(0, 0) === 2);
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
