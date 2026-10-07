/**
 * 路由表：/projects、/sessions、/takes、/picks、/retakes
 * 页面按路由懒加载，构建时自动分包。
 *
 * 路径常量与导航配置定义在叶子模块 ./routes 中：本文件 import App，App 也 import 这些常量，
 * 常量留在本文件会形成 App ⇄ router 循环依赖并在首屏抛 TDZ 错误（整站白屏）。
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import App from '@/App';
import { ROUTES } from './routes';

const ProjectList = lazy(() => import('@/pages/ProjectList'));
const SessionPlan = lazy(() => import('@/pages/SessionPlan'));
const TakeBoard = lazy(() => import('@/pages/TakeBoard'));
const PickSummary = lazy(() => import('@/pages/PickSummary'));
const RetakePlan = lazy(() => import('@/pages/RetakePlan'));

/** 兼容出口：路径常量与导航配置请优先直接从 './routes' 引入（叶子模块，不产生环） */
export { ROUTES, NAV_ITEMS } from './routes';
export type { NavItem, RouteKey } from './routes';

function withSuspense(node: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      }
    >
      {node}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to={ROUTES.projects} replace /> },
      { path: 'projects', element: withSuspense(<ProjectList />) },
      { path: 'sessions', element: withSuspense(<SessionPlan />) },
      { path: 'takes', element: withSuspense(<TakeBoard />) },
      { path: 'picks', element: withSuspense(<PickSummary />) },
      { path: 'retakes', element: withSuspense(<RetakePlan />) },
      { path: '*', element: <Navigate to={ROUTES.projects} replace /> }
    ]
  }
]);

export default router;
