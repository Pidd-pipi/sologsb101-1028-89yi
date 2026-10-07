/**
 * 行修订号（叶子模块）
 * 定义在此处而不是 utils/db.ts，是为了让 utils/seed.ts 无需在运行期 import utils/db.ts，
 * 从而切断 utils/db.ts ⇄ utils/seed.ts 的循环依赖（db 负责建表、seed 负责灌数）。
 *
 * revision 是「逐行改动计数」：新建行为 ROW_REVISION，之后每次改动 +1。
 * 两台电脑离线各改一份备份后，逐条合并导入就靠它判断同一行谁先谁后。
 */

/** 新建行的初始修订号（每次调整行结构 +1 并在 upgrade() 中补迁移） */
export const ROW_REVISION = 1;

/**
 * 为缺少修订号 / 时间戳的历史行按现有值回填（结构升级与合并导入共用）：
 * - createdAt 缺失时先看现有 updatedAt，updatedAt 缺失时再看现有 createdAt，都没有才用当前时间；
 * - revision 缺失时按 ROW_REVISION 回填。
 * 回填只补缺省值，不覆盖已有值；回填之后该行才参与逐条合并比较。
 */
export function backfillRevisionFields(row: Record<string, unknown>): void {
  const now = Date.now();
  if (typeof row.createdAt !== 'number') {
    row.createdAt = typeof row.updatedAt === 'number' ? row.updatedAt : now;
  }
  if (typeof row.updatedAt !== 'number') {
    row.updatedAt = row.createdAt;
  }
  if (typeof row.revision !== 'number') {
    row.revision = ROW_REVISION;
  }
}
