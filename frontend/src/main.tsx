import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider } from 'react-router-dom';
import 'antd/dist/reset.css';
import '@/styles/main.css';
import { router } from '@/router';
import { initDatabase } from '@/utils/db';

/** 先打开本地库并播种演示数据，保证首屏每个页面打开都有内容 */
async function bootstrap(): Promise<void> {
  try {
    await initDatabase();
  } catch (error) {
    // 本地库不可用时仍然渲染界面，页面内会给出可读的错误提示
    console.error('本地数据库初始化失败', error);
  }
  const container = document.getElementById('root');
  if (!container) throw new Error('缺少 #root 挂载点');
  createRoot(container).render(
    <StrictMode>
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#2f6f8f', borderRadius: 8 } }}>
        <RouterProvider router={router} />
      </ConfigProvider>
    </StrictMode>
  );
}

void bootstrap();
