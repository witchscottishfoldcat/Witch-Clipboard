import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Tauri 桌面壳复用现有 React 渲染层。 */
export default defineConfig({
  root: resolve(__dirname, 'src'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'electron/shared'),
      '@res': resolve(__dirname, 'resources'),
    },
  },
  server: {
    strictPort: true,
    fs: { allow: [resolve(__dirname)] },
  },
  build: {
    outDir: resolve(__dirname, 'out/tauri-renderer'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/index.html') },
  },
})
