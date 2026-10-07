/**
 * 行结构修订号与行修订号工具（叶子模块）
 * 定义在此处而不是 utils/db.ts，是为了让 utils/seed.ts 无需在运行期 import utils/db.ts，
 * 从而切断 utils/db.ts ⇄ utils/seed.ts 的循环依赖（db 负责建表、seed 负责灌数）。
 */

/** 行结构修订号：每次调整行结构 +1 并在 upgrade() 中补迁移 */
export const ROW_REVISION = 1;

/** 行修订号初始值：新建行 / 历史行回填都从 1 开始，每次改动 +1 */
export const INITIAL_LINE_REVISION = 1;

/**
 * 取一行的行修订号。已有数据（结构升级或旧备份）缺号时按现有值回填为初始值，再参与合并。
 */
export function lineRevision(row: { revision?: number } | null | undefined): number {
  if (row && typeof row.revision === 'number' && row.revision >= INITIAL_LINE_REVISION) {
    return Math.floor(row.revision);
  }
  return INITIAL_LINE_REVISION;
}

/** 下一个行修订号（本地每次改动 +1） */
export function nextLineRevision(current: number | undefined): number {
  return lineRevision({ revision: current }) + 1;
}
