import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

// hash 模式：GitHub Pages 沒有 SPA rewrite，history 模式下重新整理任何子路徑都會 404。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/backup', name: 'backup', component: () => import('@/views/BackupView.vue') },
  ],
})
