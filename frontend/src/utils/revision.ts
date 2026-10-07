/**
 * 行结构修订号（叶子模块）
 * 定义在此处而不是 utils/db.ts，是为了让 utils/seed.ts 无需在运行期 import utils/db.ts，
 * 从而切断 utils/db.ts ⇄ utils/seed.ts 的循环依赖（db 负责建表、seed 负责灌数）。
 */

/** 行结构修订号：每次调整行结构 +1 并在 upgrade() 中补迁移 */
export const ROW_REVISION = 1;
