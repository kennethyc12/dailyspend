import type { Settings } from '@/models/types'
import { IndexedDbAdapter } from './indexedDbAdapter'
import { defaultCategories, defaultSettings, migrateSettings } from './defaults'
import type { StoragePort } from './port'

export * from './port'
export { IndexedDbAdapter } from './indexedDbAdapter'
export { toIdbRange } from './indexedDbAdapter'
export { defaultCategories, defaultSettings, migrateSettings } from './defaults'
export { DB_NAME, DB_VERSION } from './schema'

/**
 * 首次開啟時補上預設類別與設定。seed 與 persist 申請都在這裡做完，
 * 之後 service 層拿到的 StoragePort 一定已經可用。
 */
export async function seed(storage: StoragePort): Promise<Settings> {
  const existing = await storage.get<Partial<Settings>>('settings', 'settings')
  if (existing) {
    // 每次開啟都補一次缺鍵，新增設定欄位時不必另外寫 migration。
    const migrated = migrateSettings(existing)
    if (JSON.stringify(migrated) !== JSON.stringify(existing)) {
      await storage.put('settings', migrated)
    }
    return migrated
  }

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
