import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'github-pages' ? '/Spadchina/' : '/',
  plugins: [
    react(),
    {
      name: 'spadchyna-archive-integration',
      transformIndexHtml: {
        order: 'post',
        handler() {
          return [{ tag: 'script', attrs: { type: 'module', src: '/integration.js' }, injectTo: 'body' }]
        },
      },
    },
  ],
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        ['index', 'catalog', 'place', 'rating', 'shop', 'profile', 'battles'].map((page) => [
          page,
          resolve(projectRoot, `${page}.html`),
        ]),
      ),
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
      },
    },
  },
}))
