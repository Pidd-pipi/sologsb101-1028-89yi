/** 编制 */
export type SongArrangement = '乐队' | '弦乐' | '钢琴独奏' | '合唱';
/** 曲目录制状态 */
export type SongState = '待录' | '录制中' | '已完成';

/** 曲目：属于某个录音项目 */
export interface Song {
  id: string;
  /** 所属项目 */
  projectId: string;
  /** 曲名 */
  title: string;
  /** 时长（秒） */
  durationSec: number;
  /** 编制 */
  arrangement: SongArrangement;
  /** 录制状态 */
  state: SongState;
}

export const SONG_ARRANGEMENTS: SongArrangement[] = ['乐队', '弦乐', '钢琴独奏', '合唱'];
export const SONG_STATES: SongState[] = ['待录', '录制中', '已完成'];

export function createEmptySong(): Omit<Song, 'id'> {
  return { projectId: '', title: '', durationSec: 210, arrangement: '乐队', state: '待录' };
}
