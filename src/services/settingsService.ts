import type { Settings } from '@/models/types'
import type { StoragePort } from '@/storage'

/**
 * settings 是單一文件，各頁只改其中一組欄位；在同一個 transaction 裡讀新鮮值再寫，
 * 連續改不同欄位時才不會用舊副本把前一次蓋回去。update 必須是同步函式。
 */
export async function updateSettings(
  storage: StoragePort,
  update: (current: Settings) => Settings,
  now = Date.now(),
): Promise<Settings | null> {
  return storage.transaction(['settings'], async (tx) => {
    const current = await tx.get<Settings>('settings', 'settings')
    if (!current) return null
    const next: Settings = { ...update(current), updatedAt: now }
    await tx.put('settings', next)
    return next
  })
}
