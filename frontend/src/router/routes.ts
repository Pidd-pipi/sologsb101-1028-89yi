/**
 * 路由常量与导航配置（叶子模块）
 * 只导出路径常量与导航元数据，不 import 任何应用内模块（尤其不 import App / 页面 / store）。
 * 目的：切断 App.tsx ⇄ router/index.tsx 的循环依赖 —— App 在模块顶层读取 ROUTES 构造图标表，
 * 若这些常量仍定义在 router/index.tsx 中，就会出现「Cannot access 'X' before initialization」的 TDZ 报错。
 * 路径与项目提示词逐字一致：/projects、/sessions、/takes、/picks、/retakes
 */

/** 全部路由路径 */
export const ROUTES = {
  projects: '/projects',
  sessions: '/sessions',
  takes: '/takes',
  picks: '/picks',
  retakes: '/retakes'
} as const;

export type RouteKey = keyof typeof ROUTES;

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  hint: string;
}

/** 侧边导航配置（与路由一一对应） */
export const NAV_ITEMS: NavItem[] = [
  { path: ROUTES.projects, label: '项目与曲目', icon: '📀', hint: '录音项目台账' },
  { path: ROUTES.sessions, label: '场次排期', icon: '🗓️', hint: '棚号与乐手安排' },
  { path: ROUTES.takes, label: 'Take 标记台', icon: '⏱️', hint: '时间码与评级' },
  { path: ROUTES.picks, label: '优选与剪接', icon: '✂️', hint: '剪接清单汇总' },
  { path: ROUTES.retakes, label: '补录计划', icon: '🔁', hint: '补录与记录表导出' }
];
