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
      },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
  },
})
