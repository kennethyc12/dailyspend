import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Photo, Settings, SpendRecord } from '@/models/types'
import { IndexedDbAdapter, migrateSettings, seed } from '@/storage'
import { defaultSettings } from '@/storage/defaults'
import { seedBuiltinRules } from '@/services/ruleService'
import {
  attachPhoto,
  createFromText,
  deleteRecord,
  getPhoto,
  removePhoto,
} from '@/services/entryService'
import { fitWithin } from '../compress'

const NOW = 1_760_000_000_000
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

function photo(id: string): Photo {
  return {
    id,
    blob: new Blob([BYTES], { type: 'image/jpeg' }),
    thumbBlob: new Blob([BYTES.slice(0, 2)], { type: 'image/jpeg' }),
    width: 1600,
    height: 1200,
    bytes: BYTES.length,
    capturedAt: NOW,
  }
}

describe('fitWithin', () => {
  it('長邊縮到上限，比例不變', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('原圖較小時不放大', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('極扁的圖短邊不會變成 0', () => {
    expect(fitWithin(5000, 3, 1600).height).toBeGreaterThanOrEqual(1)
  })

  it('零尺寸不當機', () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 0, height: 0 })
  })
})

describe('settings 遷移', () => {
  it('舊版缺 photo 欄位時補上預設值', () => {
    const old = defaultSettings(NOW) as Partial<Settings>
    delete old.photo

    const migrated = migrateSettings(old, NOW)
    expect(migrated.photo).toEqual({ maxEdge: 1600, thumbEdge: 320, quality: 0.8 })
  })

  it('既有設定不會被預設值蓋掉', () => {
    const stored = defaultSettings(NOW)
    stored.backup.lastBackupAt = 12345
    stored.thresholds.suggestion.topN = 9

    const migrated = migrateSettings(stored, NOW)
    expect(migrated.backup.lastBackupAt).toBe(12345)
    expect(migrated.thresholds.suggestion.topN).toBe(9)
  })

  it('thresholds 子群組缺鍵也補得到', () => {
    const old = defaultSettings(NOW) as unknown as Record<string, Record<string, unknown>>
    delete (old.thresholds as Record<string, unknown>).repeatPurchase

    const migrated = migrateSettings(old as unknown as Settings, NOW)
    expect(migrated.thresholds.repeatPurchase.minRepeat).toBe(3)
  })

  it('完全沒有舊設定時回傳全套預設', () => {
    expect(migrateSettings(undefined, NOW)).toEqual(defaultSettings(NOW))
  })
})

describe('照片與紀錄', () => {
  let storage: IndexedDbAdapter

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory()
    storage = new IndexedDbAdapter()
    await seed(storage)
    await seedBuiltinRules(storage, NOW)
  })

  async function only(): Promise<SpendRecord> {
    const all = await storage.getAll<SpendRecord>('records')
    expect(all).toHaveLength(1)
    return all[0]!
  }

  it('seed 會把缺少的 photo 設定補回資料庫', async () => {
    const stored = (await storage.get<Settings>('settings', 'settings'))!
    delete (stored as Partial<Settings>).photo
    await storage.put('settings', stored)

    const migrated = await seed(storage)
    expect(migrated.photo.maxEdge).toBe(1600)
    expect((await storage.get<Settings>('settings', 'settings'))?.photo).toBeDefined()
  })

  it('記帳時附照片，照片與紀錄同一個 transaction 寫入', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW, photo('p1'))
    const r = await only()

    expect(r.photoId).toBe('p1')
    expect(await storage.count('photos')).toBe(1)
  })

  it('附照片不會把 sourceType 改成 photo', async () => {
    // 照片只是證據，金額仍是手打的。sourceType 影響 §7.3 的 merge 優先序，
    // 等 QR 真的解出欄位才改。
    await createFromText(storage, '全家 咖啡 55', NOW, photo('p1'))
    expect((await only()).sourceType).toBe('manual')
  })

  it('更換照片會刪掉舊的，不留孤兒', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW, photo('p1'))
    const next = await attachPhoto(storage, await only(), photo('p2'), NOW + 1)

    expect(next.photoId).toBe('p2')
    expect(await storage.get('photos', 'p1')).toBeUndefined()
    expect(await storage.count('photos')).toBe(1)
  })

  it('移除照片', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW, photo('p1'))
    const next = await removePhoto(storage, await only(), NOW + 1)

    expect(next.photoId).toBeNull()
    expect(await storage.count('photos')).toBe(0)
  })

  it('沒有照片時移除是 no-op', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const r = await only()
    expect(await removePhoto(storage, r)).toBe(r)
  })

  it('刪除紀錄會一併刪掉照片', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW, photo('p1'))
    await deleteRecord(storage, await only())
    expect(await storage.count('photos')).toBe(0)
  })

  it('照片位元組往返一致', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW, photo('p1'))
    const stored = await getPhoto(storage, 'p1')
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(BYTES)
  })
})
