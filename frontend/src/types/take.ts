/** Take 评级 */
export type TakeGrade = '可用' | '待定' | '废';
/** 问题标签 */
export type TakeIssue = '音准' | '节奏' | '噪声' | '破音' | '无';

/** 录制条次：一次录制的起止时间码与质量标记 */
export interface Take {
  id: string;
  /** 所属场次 */
  sessionId: string;
  /** Take 号 */
  takeNo: string;
  /** 起始时间码 HH:MM:SS:FF */
  startTc: string;
  /** 结束时间码 HH:MM:SS:FF */
  endTc: string;
  /** 评级 */
  grade: TakeGrade;
  /** 问题标签 */
  issues: TakeIssue[];
}

export const TAKE_GRADES: TakeGrade[] = ['可用', '待定', '废'];
export const TAKE_ISSUES: TakeIssue[] = ['音准', '节奏', '噪声', '破音', '无'];

export function createEmptyTake(): Omit<Take, 'id'> {
  return { sessionId: '', takeNo: '', startTc: '00:00:00:00', endTc: '00:00:00:00', grade: '待定', issues: ['无'] };
}
