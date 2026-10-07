/** 应用外壳：左侧导航 + 顶部概览 + 路由出口 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Layout, Menu, Space, Tag, Typography, message } from 'antd';
import {
  AudioOutlined,
  ClockCircleOutlined,
  FolderOpenOutlined,
  ScissorOutlined,
  ReloadOutlined
} from '@ant-design/icons';
// 路由常量与导航配置取自叶子模块 @/router/routes：App 在模块顶层就要用 ROUTES 构造图标表，
// 若从 @/router（会 import App）引入会形成循环依赖 → TDZ「Cannot access before initialization」
import { NAV_ITEMS, ROUTES } from '@/router/routes';
import { initDatabase, countAll, DB_NAME, DB_SCHEMA_VERSION } from '@/utils/db';
import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore } from '@/stores/sessionStore';

const { Header, Sider, Content, Footer } = Layout;

const MENU_ICONS: Record<string, JSX.Element> = {
  [ROUTES.projects]: <FolderOpenOutlined />,
  [ROUTES.sessions]: <ClockCircleOutlined />,
  [ROUTES.takes]: <AudioOutlined />,
  [ROUTES.picks]: <ScissorOutlined />,
  [ROUTES.retakes]: <ReloadOutlined />
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [messageApi, contextHolder] = message.useMessage();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);

  async function refreshCounts(): Promise<void> {
    setCounts(await countAll());
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await initDatabase();
        if (cancelled) return;
        await refreshCounts();
      } catch (error) {
        if (cancelled) return;
        messageApi.error(`本地数据库初始化失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageApi, location.pathname]);

  const activeKey = useMemo(() => {
    const match = NAV_ITEMS.find((item) => location.pathname.startsWith(item.path));
    return match ? match.path : ROUTES.projects;
  }, [location.pathname]);

  const currentTitle = useMemo(
    () => NAV_ITEMS.find((item) => item.path === activeKey)?.label ?? '录音棚场次与 Take 标记台',
    [activeKey]
  );

  return (
    <>
      {contextHolder}
      <Layout style={{ minHeight: '100vh', background: '#f4f7f9' }}>
        <Sider width={228} breakpoint="lg" collapsedWidth={0} style={{ background: '#1d2b3a' }}>
          <div style={{ padding: '18px 16px 10px' }}>
            <Typography.Title level={5} style={{ color: '#e9f1f6', margin: 0 }}>
              录音棚场次与 Take 标记台
            </Typography.Title>
            <Typography.Text style={{ color: 'rgba(233,241,246,0.6)', fontSize: 12 }}>
              gbstudiotake · 棚务统筹
            </Typography.Text>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[activeKey]}
            style={{ background: 'transparent' }}
            onClick={({ key }) => navigate(key)}
            items={NAV_ITEMS.map((item) => ({
              key: item.path,
              icon: MENU_ICONS[item.path] ?? <FolderOpenOutlined />,
              label: item.label
            }))}
          />
          <div style={{ padding: '12px 16px', color: 'rgba(233,241,246,0.55)', fontSize: 11, lineHeight: 1.9 }}>
            <div>
              本地库 {DB_NAME} · v{DB_SCHEMA_VERSION}
            </div>
            <div>
              项目 {counts.projects ?? 0} · 曲目 {counts.songs ?? 0} · 场次 {counts.sessions ?? 0}
            </div>
            <div>
              Take {counts.takes ?? 0} · 优选 {counts.picks ?? 0} · 补录 {counts.retakes ?? 0}
            </div>
          </div>
        </Sider>

        <Layout style={{ background: '#f4f7f9' }}>
          <Header
            style={{
              background: '#ffffff',
              borderBottom: '1px solid #e2ebf1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingInline: 20
            }}
          >
            <Space size={10} wrap>
              <Typography.Text strong>{currentTitle}</Typography.Text>
              <Tag color="cyan">项目上下文：{currentProjectId ?? '未选择'}</Tag>
              <Tag>场次上下文：{currentSessionId ?? '未选择'}</Tag>
            </Space>
            <Space size={8}>
              <Badge count={counts.takes ?? 0} showZero color="#2f6f8f" title="Take 总数" />
              <Link to={ROUTES.takes}>去标记 Take</Link>
            </Space>
          </Header>

          <Content style={{ padding: 20, minHeight: 320 }}>
            <Outlet />
          </Content>

          <Footer style={{ textAlign: 'center', background: 'transparent', color: 'rgba(0,0,0,0.45)' }}>
            数据仅保存在本机浏览器（IndexedDB / Dexie），无后端服务 ·
            <Link to={ROUTES.projects} style={{ marginLeft: 6 }}>
              返回项目台账
            </Link>
          </Footer>
        </Layout>
      </Layout>
    </>
  );
}
