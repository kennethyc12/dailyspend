import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 服務於 https://<user>.github.io/<repo>/，base 必須與 repo 名一致，
// 否則 service worker 的 scope 會落在根目錄而註冊失敗。CI 由 BASE_PATH 覆寫。
const base = process.env.BASE_PATH ?? '/dailyspend/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon-180.png'],
      manifest: {
        name: 'DailySpend 記帳',
        short_name: 'DailySpend',
        description: '個人記帳工具',
        lang: 'zh-Hant-TW',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf9f7',
        theme_color: '#1f6f5c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
