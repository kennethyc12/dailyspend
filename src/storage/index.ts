import type { Settings } from '@/models/types'
import { IndexedDbAdapter } from './indexedDbAdapter'
import { defaultCategories, defaultSettings } from './defaults'
import type { StoragePort } from './port'

export * from './port'
export { IndexedDbAdapter } from './indexedDbAdapter'
export { toIdbRange } from './indexedDbAdapter'
export { defaultCategories, defaultSettings } from './defaults'
export { DB_NAME, DB_VERSION } from './schema'

/**
 * 首次開啟時補上預設類別與設定。seed 與 persist 申請都在這裡做完，
 * 之後 service 層拿到的 StoragePort 一定已經可用。
 */
export async function seed(storage: StoragePort): Promise<Settings> {
  const existing = await storage.get<Settings>('settings', 'settings')
  if (existing) return existing

  const now = Date.now()
  const categories = defaultCategories(now)
  const settings = defaultSettings(now)

  await storage.transaction(['categories', 'settings'], async (tx) => {
    for (const c of categories) await tx.put('categories', c)
    await tx.put('settings', settings)
  })

  return settings
}

let instance: StoragePort | null = null

export function getStorage(): StoragePort {
  instance ??= new IndexedDbAdapter()
  return instance
}

export function setStorage(port: StoragePort | null) {
  instance = port
}
