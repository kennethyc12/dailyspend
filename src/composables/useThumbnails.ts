import { onUnmounted, shallowRef, watch } from 'vue'
import { getStorage } from '@/storage'
import { getPhoto } from '@/services/entryService'

/**
 * photoId → 縮圖 object URL。以 photoId 為 key：編輯頁換照片會換 id，
 * 用紀錄 id 當 key 會顯示舊圖。讀取例外不在這裡接，交給全域（D3）。
 */
export function useThumbnails(photoIds: () => (string | null)[]) {
  const storage = getStorage()
  const urls = shallowRef<Record<string, string>>({})
  const loading = new Set<string>()
  let wanted = new Set<string>()
  let disposed = false

  async function load(id: string) {
    loading.add(id)
    try {
      const photo = await getPhoto(storage, id)
      // 讀取期間卡片可能已確認或刪除、頁面可能已離開
      if (!photo || disposed || !wanted.has(id)) return
      urls.value = { ...urls.value, [id]: URL.createObjectURL(photo.thumbBlob) }
    } finally {
      loading.delete(id)
    }
  }

  watch(
    () => photoIds().filter((id): id is string => id !== null),
    (ids) => {
      wanted = new Set(ids)
      const kept: Record<string, string> = {}
      for (const [id, url] of Object.entries(urls.value)) {
        if (wanted.has(id)) kept[id] = url
        else URL.revokeObjectURL(url)
      }
      urls.value = kept
      const missing = [...wanted].filter((id) => !(id in kept) && !loading.has(id))
      // 回傳 promise，reject 才會經 Vue 送到 errorHandler
      return Promise.all(missing.map(load))
    },
    { immediate: true },
  )

  onUnmounted(() => {
    disposed = true
    for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
    urls.value = {}
  })

  return urls
}
