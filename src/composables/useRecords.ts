import { computed, shallowRef } from 'vue'
import type { Category, SpendRecord } from '@/models/types'
import { getStorage } from '@/storage'

// shallowRef 不是偏好而是必要：這些物件之後會寫回 IndexedDB，
// 深層響應式會把它們變成 Proxy，structured clone 直接拒絕（design.md §11.3）。
const records = shallowRef<SpendRecord[]>([])
const categories = shallowRef<Category[]>([])
const loading = shallowRef(false)

export const pendingRecords = computed(() =>
  records.value.filter((r) => r.status === 'pending'),
)

export const categoryName = computed(() => {
  const map = new Map(categories.value.map((c) => [c.id, c.name]))
  return (id: string | null) => (id === null ? '待確認' : (map.get(id) ?? id))
})

export const activeCategories = computed(() =>
  [...categories.value].filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
)

export async function refreshRecords() {
  loading.value = true
  try {
    const storage = getStorage()
    const [rs, cs] = await Promise.all([
      storage.getAll<SpendRecord>('records'),
      storage.getAll<Category>('categories'),
    ])
    records.value = rs.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    categories.value = cs
  } finally {
    loading.value = false
  }
}

export function useRecords() {
  return { records, categories, loading }
}
