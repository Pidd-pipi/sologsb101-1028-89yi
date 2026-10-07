/** 生成本地唯一 id（不依赖后端，纯前端可用） */
export function createId(prefix = 'row'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/** 当前时间的 ISO 字符串 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 今天 YYYY-MM-DD */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 两个日期之间的天数差（后者减前者） */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}
