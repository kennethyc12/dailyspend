import { createRouter, createWebHashHistory } from 'vue-router'
import QuickInputView from '@/views/QuickInputView.vue'

// hash 模式：GitHub Pages 沒有 SPA rewrite，history 模式下重新整理任何子路徑都會 404。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'entry', component: QuickInputView },
    { path: '/records', name: 'records', component: () => import('@/views/RecordsView.vue') },
    { path: '/pending', name: 'pending', component: () => import('@/views/PendingView.vue') },
    { path: '/analysis', name: 'analysis', component: () => import('@/views/AnalysisView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    { path: '/backup', name: 'backup', component: () => import('@/views/BackupView.vue') },
  ],
})
