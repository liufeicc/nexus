import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // 主进程入口
        entry: 'src/main/index.ts',
        onstart({ startup }) {
          console.log('[vite-plugin-electron] 主进程编译完成，启动 Electron...')
          // 使用 --no-sandbox 参数解决 Linux 权限问题
          startup(['.', '--no-sandbox'])
        },
        vite: {
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'node-pty'],
            },
          },
        },
      },
      {
        // 预加载脚本（主窗口）
        entry: 'src/main/preload.ts',
        onstart(options) {
          // 通知主进程重新加载预加载脚本
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist',
            lib: {
              entry: 'src/main/preload.ts',
              fileName: 'preload',
              format: 'cjs',
            },
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  // 多页面入口支持
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'dynamic-island': path.resolve(__dirname, 'dynamic-island.html'),
        onboarding: path.resolve(__dirname, 'onboarding.html'),
      },
    },
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@core': path.resolve(__dirname, './src/core'),
    },
  },
  base: './',
  server: {
    port: 5173,
  },
})
