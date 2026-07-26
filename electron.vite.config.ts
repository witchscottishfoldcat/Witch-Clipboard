import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'electron/main/index.ts') },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'electron/shared') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'electron/preload/index.ts') },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'electron/shared') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'electron/shared'),
        // 界面里的 logo 直接用 resources 下的母版 SVG，不在 src 里再放一份
        '@res': resolve(__dirname, 'resources'),
      },
    },
    // Vite 的 root 是 src/，要显式允许它读到项目根下的 resources/
    server: { fs: { allow: [resolve(__dirname)] } },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
  },
})
