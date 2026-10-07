/** 优选用途 */
export type PickUsage = '主歌' | '副歌' | '独奏' | '全曲';

/** 优选 Take：从可用条次中挑选出的剪接素材 */
export interface Pick {
  id: string;
  /** 被优选的 Take */
  takeId: string;
  /** 用途 */
  usage: PickUsage;
  /** 剪接清单中的顺序 */
  order: number;
  /** 备注 */
  note: string;
}

export const PICK_USAGES: PickUsage[] = ['主歌', '副歌', '独奏', '全曲'];

export function createEmptyPick(): Omit<Pick, 'id' | 'order'> {
  return { takeId: '', usage: '主歌', note: '' };
}
