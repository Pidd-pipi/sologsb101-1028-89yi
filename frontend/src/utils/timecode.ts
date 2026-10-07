/**
 * 时间码工具：时:分:秒:帧 ↔ 秒数互转、时长汇总、重叠检测与排序
 * 被 Take 标记台、优选汇总页与场次记录表导出共同消费。
 */

/** 帧率（与棚内工程文件保持一致） */
export const FPS = 25;

/** 时间码正则：HH:MM:SS:FF */
const TC_PATTERN = /^(\d{1,2}):([0-5]?\d):([0-5]?\d):(\d{1,2})$/;

/** 校验时间码格式 */
export function isTimecode(value: string): boolean {
  const match = TC_PATTERN.exec(value.trim());
  if (!match) return false;
  return Number(match[4]) < FPS;
}

/** 时:分:秒:帧 → 秒数；非法返回 NaN */
export function tcToSeconds(tc: string): number {
  const match = TC_PATTERN.exec(tc.trim());
  if (!match) return Number.NaN;
  const [, hh, mm, ss, ff] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ff) / FPS;
}

/** 秒数 → 时:分:秒:帧 */
export function secondsToTc(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const frames = Math.round((safe - Math.floor(safe)) * FPS);
  const pad = (value: number): string => String(value).padStart(2, '0');
  // 帧进位兜底
  if (frames >= FPS) return secondsToTc(Math.floor(safe) + 1);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** 秒数 → mm:ss 或 hh:mm:ss（用于展示时长） */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 单个 Take 的时长（秒），非法时间码返回 0 */
export function takeDuration(startTc: string, endTc: string): number {
  const start = tcToSeconds(startTc);
  const end = tcToSeconds(endTc);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return end - start;
}

/** 汇总一组 Take 的总时长（秒） */
export function totalDuration(list: Array<{ startTc: string; endTc: string }>): number {
  return list.reduce((sum, item) => sum + takeDuration(item.startTc, item.endTc), 0);
}

/** 时间码区间是否重叠（端点相接不算重叠） */
export function isOverlapping(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const as = tcToSeconds(aStart);
  const ae = tcToSeconds(aEnd);
  const bs = tcToSeconds(bStart);
  const be = tcToSeconds(bEnd);
  if ([as, ae, bs, be].some((value) => Number.isNaN(value))) return false;
  return as < be && bs < ae;
}

/** 按起始时间码排序 */
export function sortByStart<T extends { startTc: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const av = tcToSeconds(a.startTc);
    const bv = tcToSeconds(b.startTc);
    if (Number.isNaN(av) || Number.isNaN(bv)) return a.startTc.localeCompare(b.startTc);
    return av - bv;
  });
}

/** 自动递增 Take 号：T03 → T04；纯数字则数字 +1 */
export function suggestNextTakeNo(existing: Array<{ takeNo: string }>): string {
  if (existing.length === 0) return 'T01';
  const max = existing.reduce((acc, item) => {
    const digits = item.takeNo.replace(/\D/g, '');
    return Math.max(acc, Number(digits) || 0);
  }, 0);
  const prefix = existing[existing.length - 1].takeNo.replace(/\d/g, '') || 'T';
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

/** 生成「拼接清单」文本：按顺序拼出剪接时间码序列 */
export function buildEditList(list: Array<{ takeNo: string; startTc: string; endTc: string }>): string {
  return list.map((item, index) => `${index + 1}. ${item.takeNo} ${item.startTc} → ${item.endTc}`).join('\n');
}
