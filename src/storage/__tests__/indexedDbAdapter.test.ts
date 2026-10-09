import { beforeEach, describe, expect, it } from 'vitest'
import { reactive, ref, shallowRef } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbAdapter, toIdbRange } from '../indexedDbAdapter'
import { StorageConflictError } from '../port'
import { seed } from '../index'
import { DB_NAME } from '../schema'
import type { SpendRecord } from '@/models/types'

function makeRecord(over: Partial<SpendRecord> = {}): SpendRecord {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    date: '2026-10-05',
    merchant: '全家',
    amount: 55,
    items: [{ name: '咖啡', qty: 1, unitPrice: null, amount: null, categoryId: null }],
    categoryId: 'drink',
    categorySource: 'rule',
    classifyConfidence: 0.95,
    recognizeConfidence: null,
    status: 'confirmed',
    pendingReasons: [],
    invoiceNumber: null,
    invoicePeriod: null,
    invoiceKey: null,
    invoiceRandomCode: null,
    sourceType: 'manual',
    photoId: null,
    rawRecognition: null,
    note: '',
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

let storage: IndexedDbAdapter

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
})

describe('KeyRange → IDBKeyRange', () => {
  it('空範圍回傳 null（代表全範圍）', () => {
    expect(toIdbRange({})).toBeNull()
  })

  it('gte + lte 轉成閉區間', () => {
    const r = toIdbRange({ gte: '2026-10-01', lte: '2026-10-31' })!
    expect(r.lower).toBe('2026-10-01')
    expect(r.upper).toBe('2026-10-31')
    expect(r.lowerOpen).toBe(false)
    expect(r.upperOpen).toBe(false)
  })

  it('gt + lt 轉成開區間', () => {
    const r = toIdbRange({ gt: 1, lt: 9 })!
    expect(r.lowerOpen).toBe(true)
    expect(r.upperOpen).toBe(true)
  })

  it('單邊與 eq', () => {
    expect(toIdbRange({ gte: 5 })!.upper).toBeUndefined()
    expect(toIdbRange({ lte: 5 })!.lower).toBeUndefined()
    const only = toIdbRange({ eq: 'x' })!
    expect(only.lower).toBe('x')
    expect(only.upper).toBe('x')
  })
})

describe('by_invoiceKey 的 sparse unique 行為', () => {
  // 設計文件 §3.1 指名必測：去重設計的前提是「invoiceKey 為 null 的紀錄
  // 不進索引」，多筆 null 不得觸發 unique 衝突。
  it('多筆 invoiceKey=null 可同時存在，不觸發 ConstraintError', async () => {
    for (let i = 0; i < 3; i++) {
      await storage.put('records', makeRecord({ invoiceKey: null }))
    }
    expect(await storage.count('records')).toBe(3)
  })

  it('相同的非 null invoiceKey 會被 unique index 擋下', async () => {
    const key = '11509-AB12345678'
    await storage.put('records', makeRecord({ invoiceKey: key }))

    await expect(storage.put('records', makeRecord({ invoiceKey: key }))).rejects.toBeInstanceOf(
      StorageConflictError,
    )
    expect(await storage.count('records')).toBe(1)
  })

  it('不同 invoiceKey 可並存，且查得到', async () => {
    await storage.put('records', makeRecord({ invoiceKey: '11509-AB12345678' }))
    await storage.put('records', makeRecord({ invoiceKey: '11509-CD87654321' }))

    const found = await storage.getByIndex<SpendRecord>(
      'records',
      'by_invoiceKey',
      '11509-CD87654321',
    )
    expect(found?.invoiceKey).toBe('11509-CD87654321')
    expect(await storage.count('records')).toBe(2)
  })
})

describe('query by_date 字串範圍', () => {
  // 移除 by_yearMonth 衍生欄位的前提：by_date 的字串比較足以取出整個月份。
  it('用字串區間取出整個月，不需要衍生欄位', async () => {
    for (const date of ['2026-09-30', '2026-10-01', '2026-10-15', '2026-10-31', '2026-11-01']) {
      await storage.put('records', makeRecord({ date }))
    }

    const october = await storage.query<SpendRecord>('records', 'by_date', {
      gte: '2026-10-01',
      lte: '2026-10-31',
    })

    expect(october.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-15', '2026-10-31'])
  })

  it('direction 與 limit 生效', async () => {
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03']) {
      await storage.put('records', makeRecord({ date }))
    }

    const latest = await storage.query<SpendRecord>(
      'records',
      'by_date',
      {},
      { direction: 'desc', limit: 2 },
    )
    expect(latest.map((r) => r.date)).toEqual(['2026-10-03', '2026-10-02'])
  })
})

describe('transaction', () => {
  it('同一個 transaction 內的多筆寫入全部生效', async () => {
    await storage.transaction(['records', 'photos'], async (tx) => {
      await tx.put('photos', {
        id: 'p1',
        blob: new Blob(['x']),
        thumbBlob: new Blob(['t']),
        width: 100,
        height: 100,
        bytes: 1,
        capturedAt: Date.now(),
      })
      await tx.put('records', makeRecord({ id: 'r1', photoId: 'p1' }))
    })

    expect(await storage.get('photos', 'p1')).toBeDefined()
    expect(await storage.get('records', 'r1')).toBeDefined()
  })

  it('fn 中途拋錯時整個 transaction 回滾，不留半套資料', async () => {
    await expect(
      storage.transaction(['records', 'photos'], async (tx) => {
        await tx.put('photos', {
          id: 'orphan',
          blob: new Blob(['x']),
          thumbBlob: new Blob(['t']),
          width: 1,
          height: 1,
          bytes: 1,
          capturedAt: Date.now(),
        })
        throw new Error('分類失敗')
      }),
    ).rejects.toThrow('分類失敗')

    // 照片不該留下來變成孤兒。
    expect(await storage.count('photos')).toBe(0)
  })
})

describe('Blob 寫入與讀回', () => {
  it('Blob 內容在往返後保持一致', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    await storage.put('photos', {
      id: 'p-blob',
      blob: new Blob([bytes], { type: 'image/jpeg' }),
      thumbBlob: new Blob([bytes.slice(0, 2)], { type: 'image/jpeg' }),
      width: 1600,
      height: 1200,
      bytes: bytes.length,
      capturedAt: Date.now(),
    })

    const got = await storage.get<{ blob: Blob; thumbBlob: Blob }>('photos', 'p-blob')
    expect(got!.blob.type).toBe('image/jpeg')
    expect(new Uint8Array(await got!.blob.arrayBuffer())).toEqual(bytes)
    expect(got!.thumbBlob.size).toBe(2)
  })
})

describe('Vue 響應式物件不可直接寫入', () => {
  // 真機上還原備份整個沒反應，原因是 restorePreview 放在 ref() 裡，
  // 裡面每筆 record 都變成 Proxy，IndexedDB 的 structured clone 直接拒絕。
  // fake-indexeddb 不會重現這個拒絕，所以這裡直接釘住瀏覽器的實際行為。
  it('ref().value 與 reactive() 無法被 structured clone', () => {
    const plain = makeRecord()
    expect(() => structuredClone(ref(plain).value)).toThrow(/could not be cloned/)
    expect(() => structuredClone(reactive(plain))).toThrow(/could not be cloned/)
  })

  it('shallowRef().value 可以', () => {
    expect(() => structuredClone(shallowRef(makeRecord()).value)).not.toThrow()
  })
})

describe('seed', () => {
  it('首次開啟補上 12 個內建類別與設定，且不含「超商」', async () => {
    const settings = await seed(storage)
    const categories = await storage.getAll<{ name: string; isBuiltin: boolean }>('categories')

    expect(categories).toHaveLength(12)
    expect(categories.every((c) => c.isBuiltin)).toBe(true)
    expect(categories.map((c) => c.name)).not.toContain('超商')
    expect(settings.thresholds.suggestion.topN).toBe(3)
    expect(settings.thresholds.subscription.maxMonthlyOccurrences).toBe(2)
  })

  it('重複呼叫不會重複寫入', async () => {
    await seed(storage)
    await seed(storage)
    expect(await storage.count('categories')).toBe(12)
  })
})

describe('資料庫名稱', () => {
  it('固定為 dailyspend', () => {
    expect(DB_NAME).toBe('dailyspend')
  })
})
