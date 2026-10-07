/** 时段 */
export type SessionPeriod = '上午' | '下午' | '晚上' | '通宵';
/** 场次状态 */
export type SessionState = '已排期' | '已完成' | '已取消';

/** 录制场次：某曲目某天的录制安排 */
export interface Session {
  id: string;
  /** 所属曲目 */
  songId: string;
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 时段 */
  period: SessionPeriod;
  /** 录音师 */
  engineer: string;
  /** 棚号 */
  roomNo: string;
  /** 参与乐手（顿号分隔） */
  musicians: string;
  /** 场次状态 */
  state: SessionState;
}

export const SESSION_PERIODS: SessionPeriod[] = ['上午', '下午', '晚上', '通宵'];
export const SESSION_STATES: SessionState[] = ['已排期', '已完成', '已取消'];

export function createEmptySession(): Omit<Session, 'id'> {
  return {
    songId: '',
    date: new Date().toISOString().slice(0, 10),
    period: '上午',
    engineer: '',
    roomNo: 'A 棚',
    musicians: '',
    state: '已排期'
  };
}

/** 棚号候选 */
export const STUDIO_ROOMS = ['A 棚', 'B 棚', 'C 棚', '大排练厅'];
