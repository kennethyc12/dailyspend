import { onUnmounted, ref, shallowRef } from 'vue'
import type { Photo, Settings } from '@/models/types'
import { getStorage } from '@/storage'
import { compressPhoto } from '@/photo/compress'

/**
 * 從檔案輸入拿到照片、壓縮、並管理預覽用的 object URL。
 *
 * §13.4：用 `<input type="file" capture="environment">` 而非 getUserMedia。
 * iOS standalone 下即時鏡頭的權限行為不穩定，而 v1 的流程只需要拍一張。
 */
export function usePhotoPicker() {
  const photo = shallowRef<Photo | null>(null)
  const previewUrl = ref<string | null>(null)
  const working = ref(false)
  const error = ref<string | null>(null)

  function revoke() {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }

  function showPreview(blob: Blob) {
    revoke()
    previewUrl.value = URL.createObjectURL(blob)
  }

  async function pick(event: Event): Promise<Photo | null> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // 同一張照片連選兩次也要能觸發 change
    if (!file) return null

    working.value = true
    error.value = null
    try {
      const settings = await getStorage().get<Settings>('settings', 'settings')
      const opts = settings?.photo ?? { maxEdge: 1600, thumbEdge: 320, quality: 0.8 }
      const result = await compressPhoto(file, opts)
      photo.value = result
      showPreview(result.blob)
      return result
    } catch (e) {
      error.value = `照片處理失敗：${(e as Error).message}`
      return null
    } finally {
      working.value = false
    }
  }

  function clear() {
    photo.value = null
    revoke()
    error.value = null
  }

  onUnmounted(revoke)

  return { photo, previewUrl, working, error, pick, clear, showPreview }
}
