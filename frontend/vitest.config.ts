import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// 合并逻辑单测：纯数据层（Dexie + fake-indexeddb），不加载 React 插件
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
