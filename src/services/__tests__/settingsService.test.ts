import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Settings } from '@/models/types'
import { IndexedDbAdapter, seed } from '@/storage'
import { updateSettings } from '../settingsService'

const NOW = 1_760_000_000_000

let storage: IndexedDbAdapter

const stored = () => storage.get<Settings>('settings', 'settings')

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
})

describe('updateSettings', () => {
  beforeEach(async () => {
    await seed(storage)
  })

  it('寫入 update 的結果並回傳，updatedAt 是 now', async () => {
    const saved = await updateSettings(storage, (s) => ({ ...s, photo: { ...s.photo, quality: 0.5 } }), NOW)

    expect(saved?.photo.quality).toBe(0.5)
    expect(saved?.updatedAt).toBe(NOW)
    expect(await stored()).toEqual(saved)
  })

  it('並行改不同欄位，兩個都留下', async () => {
    await Promise.all([
      updateSettings(storage, (s) => ({ ...s, photo: { ...s.photo, quality: 0.5 } })),
      updateSettings(storage, (s) => ({ ...s, photo: { ...s.photo, maxEdge: 1200 } })),
    ])

    const s = await stored()
    expect(s?.photo.quality).toBe(0.5)
    expect(s?.photo.maxEdge).toBe(1200)
  })

  it('update 丟錯時不寫入', async () => {
    const before = await stored()

    await expect(
      updateSettings(storage, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await stored()).toEqual(before)
  })
})

describe('updateSettings：沒有 settings', () => {
  it('回傳 null，不寫入', async () => {
    const saved = await updateSettings(storage, (s) => ({ ...s, photo: { ...s.photo, quality: 0.5 } }))

    expect(saved).toBeNull()
    expect(await storage.getAll('settings')).toEqual([])
  })
})
