/** 录音项目状态 */
export type ProjectState = '筹备' | '录制中' | '混音中' | '已交付';

/** 录音项目：曲目、场次与 Take 的顶层容器 */
export interface Project {
  id: string;
  /** 项目名称 */
  name: string;
  /** 委托方 */
  client: string;
  /** 开始日期 YYYY-MM-DD */
  startDate: string;
  /** 交付日期 YYYY-MM-DD */
  deliverDate: string;
  /** 项目状态 */
  state: ProjectState;
}

export const PROJECT_STATES: ProjectState[] = ['筹备', '录制中', '混音中', '已交付'];

export function createEmptyProject(): Omit<Project, 'id'> {
  const today = new Date().toISOString().slice(0, 10);
  return { name: '', client: '', startDate: today, deliverDate: today, state: '筹备' };
}

/** 项目卡片回显的派生统计 */
export interface ProjectStats {
  songCount: number;
  sessionCount: number;
  pickedTakeCount: number;
  availableTakeCount: number;
}
