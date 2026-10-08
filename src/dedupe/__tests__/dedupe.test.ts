import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Photo, SpendRecord } from '@/models/types'
import {
  buildInvoiceKey,
  buildInvoicePeriod,
  isStandardInvoiceNumber,
  normalizeInvoiceNumber,
  periodStartMonth,
  rocYear,
} from '../invoiceKey'
import { mergeRecords, sourceOf } from '../merge'
import { IndexedDbAdapter } from '@/storage'
import { prepareRecord, saveRecord } from '@/services/recordService'

const NOW = 1_760_000_000_000

function rec(over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    id: over.id ?? crypto.randomUUID(),
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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function photo(id: string): Photo {
  return {
    id,
    blob: new Blob(['x']),
    thumbBlob: new Blob(['t']),
    width: 1,
    height: 1,
    bytes: 1,
    capturedAt: NOW,
  }
}

describe('§7.1 invoiceKey', () => {
  it('期別起始月：1–2月期=01、3–4月期=03…11–12月期=11', () => {
    expect([1, 2, 3, 4, 9, 10, 11, 12].map(periodStartMonth)).toEqual([1, 1, 3, 3, 9, 9, 11, 11])
  })

  it('民國年換算', () => {
    expect(rocYear(2026)).toBe(115)
  })

  it('2026-10-05 → 11509（設計文件的例子）', () => {
    expect(buildInvoicePeriod('2026-10-05')).toBe('11509')
  })

  it('組出 11509-AB12345678', () => {
    expect(buildInvoiceKey('2026-10-05', 'AB12345678').invoiceKey).toBe('11509-AB12345678')
  })

  it('跨年度同號碼不會撞鍵（這是改用 invoiceKey 的理由）', () => {
    const a = buildInvoiceKey('2025-10-05', 'AB12345678').invoiceKey
    const b = buildInvoiceKey('2026-10-05', 'AB12345678').invoiceKey
    expect(a).not.toBe(b)
  })

  it('同一期內不同日期得到同一個 key', () => {
    expect(buildInvoiceKey('2026-09-01', 'AB12345678').invoiceKey).toBe(
      buildInvoiceKey('2026-10-31', 'AB12345678').invoiceKey,
    )
  })

  it('缺日期或缺號碼 → key 為 null，不參與去重', () => {
    expect(buildInvoiceKey(null, 'AB12345678').invoiceKey).toBeNull()
    expect(buildInvoiceKey('2026-10-05', null).invoiceKey).toBeNull()
    expect(buildInvoiceKey(null, null).invoiceKey).toBeNull()
  })

  it('壞掉的日期不產生 key', () => {
    for (const d of ['2026-13-01', '2026-10-99', '26-10-05', 'yesterday', '']) {
      expect(buildInvoicePeriod(d)).toBeNull()
    }
  })

  it('號碼正規化：去空白與破折號、轉大寫', () => {
    expect(normalizeInvoiceNumber(' ab-1234 5678 ')).toBe('AB12345678')
    expect(normalizeInvoiceNumber('')).toBeNull()
  })

  it('非標準格式仍可產生 key（樣本未到，不拿假設擋下去重）', () => {
    expect(isStandardInvoiceNumber('AB12345678')).toBe(true)
    expect(isStandardInvoiceNumber('XYZ123')).toBe(false)
    expect(buildInvoiceKey('2026-10-05', 'XYZ123').invoiceKey).toBe('11509-XYZ123')
  })
})

describe('§7.3 merge 規則', () => {
  it('來源優先序：carrier > qr > manual', () => {
    expect(sourceOf(rec({ sourceType: 'carrier' }))).toBe('carrier')
    expect(sourceOf(rec({ sourceType: 'photo' }))).toBe('qr')
    expect(sourceOf(rec({ sourceType: 'manual' }))).toBe('manual')
  })

  it('金額不同：取高優先來源，但標記衝突', () => {
    const existing = rec({ amount: 55, sourceType: 'manual' })
    const incoming = rec({ amount: 60, sourceType: 'photo' })
    const m = mergeRecords(existing, incoming, NOW)

    expect(m.record.amount).toBe(60)
    expect(m.conflicts).toContain('amount')
    expect(m.record.pendingReasons).toContain('duplicate_conflict')
    expect(m.record.status).toBe('pending')
  })

  it('同優先層且值不同：保留既有，仍標記衝突', () => {
    const m = mergeRecords(
      rec({ amount: 55, sourceType: 'manual' }),
      rec({ amount: 60, sourceType: 'manual' }),
      NOW,
    )
    expect(m.record.amount).toBe(55)
    expect(m.conflicts).toContain('amount')
  })

  it('值相同不算衝突', () => {
    const m = mergeRecords(rec({ amount: 55 }), rec({ amount: 55, sourceType: 'photo' }), NOW)
    expect(m.conflicts).toEqual([])
    expect(m.record.pendingReasons).not.toContain('duplicate_conflict')
  })

  it('一邊為 null 時直接補上，不算衝突', () => {
    const m = mergeRecords(
      rec({ invoiceNumber: null }),
      rec({ invoiceNumber: 'AB12345678', sourceType: 'photo' }),
      NOW,
    )
    expect(m.record.invoiceNumber).toBe('AB12345678')
    expect(m.conflicts).toEqual([])
  })

  it('items 取項數較多的那份', () => {
    const many = [
      { name: '咖啡', qty: 1, unitPrice: null, amount: null, categoryId: null },
      { name: '麵包', qty: 1, unitPrice: null, amount: null, categoryId: null },
    ]
    const m = mergeRecords(rec(), rec({ items: many, sourceType: 'photo' }), NOW)
    expect(m.record.items).toHaveLength(2)
  })

  it('items 項數相同時取高優先來源', () => {
    const other = [{ name: '拿鐵', qty: 1, unitPrice: null, amount: null, categoryId: null }]
    const m = mergeRecords(rec(), rec({ items: other, sourceType: 'carrier' }), NOW)
    expect(m.record.items[0]!.name).toBe('拿鐵')
  })

  it('既有分類是使用者設的 → 不動，也不重跑分類', () => {
    const many = [
      { name: '咖啡', qty: 1, unitPrice: null, amount: null, categoryId: null },
      { name: '麵包', qty: 1, unitPrice: null, amount: null, categoryId: null },
    ]
    const m = mergeRecords(
      rec({ categoryId: 'food', categorySource: 'user' }),
      rec({ categoryId: 'drink', items: many, sourceType: 'photo' }),
      NOW,
    )
    expect(m.record.categoryId).toBe('food')
    expect(m.record.categorySource).toBe('user')
    expect(m.needsReclassify).toBe(false)
  })

  it('既有分類是規則來的且品項變了 → 要求重跑分類', () => {
    const many = [
      { name: '咖啡', qty: 1, unitPrice: null, amount: null, categoryId: null },
      { name: '麵包', qty: 1, unitPrice: null, amount: null, categoryId: null },
    ]
    const m = mergeRecords(rec(), rec({ items: many, sourceType: 'photo' }), NOW)
    expect(m.needsReclassify).toBe(true)
  })

  it('照片：既有為 null 才填入', () => {
    const m = mergeRecords(rec({ photoId: null }), rec({ photoId: 'p2' }), NOW)
    expect(m.record.photoId).toBe('p2')
    expect(m.discardedPhotoId).toBeNull()
  })

  it('照片：兩張都有則保留既有，新的丟棄並回報', () => {
    const m = mergeRecords(rec({ photoId: 'p1' }), rec({ photoId: 'p2' }), NOW)
    expect(m.record.photoId).toBe('p1')
    expect(m.discardedPhotoId).toBe('p2')
  })

  it('note 串接且去重', () => {
    expect(mergeRecords(rec({ note: 'A' }), rec({ note: 'B' }), NOW).record.note).toBe('A\nB')
    expect(mergeRecords(rec({ note: 'A' }), rec({ note: 'A' }), NOW).record.note).toBe('A')
    expect(mergeRecords(rec({ note: '' }), rec({ note: 'B' }), NOW).record.note).toBe('B')
  })

  it('updatedAt 一律更新', () => {
    expect(mergeRecords(rec(), rec(), NOW + 99).record.updatedAt).toBe(NOW + 99)
  })

  it('兩邊的 pendingReasons 聯集保留', () => {
    const m = mergeRecords(
      rec({ pendingReasons: ['no_category_match'], status: 'pending' }),
      rec({ pendingReasons: ['recognition_failed'] }),
      NOW,
    )
    expect(m.record.pendingReasons).toEqual(
      expect.arrayContaining(['no_category_match', 'recognition_failed']),
    )
  })

  it('載具來源會升級 sourceType，讓之後的合併有正確優先序', () => {
    const m = mergeRecords(rec({ sourceType: 'manual' }), rec({ sourceType: 'carrier' }), NOW)
    expect(m.record.sourceType).toBe('carrier')
  })
})

describe('prepareRecord', () => {
  it('補上 invoicePeriod 與 invoiceKey', () => {
    const r = prepareRecord(rec({ date: '2026-10-05', invoiceNumber: 'AB12345678' }))
    expect(r.invoicePeriod).toBe('11509')
    expect(r.invoiceKey).toBe('11509-AB12345678')
  })

  it('有號碼但日期壞掉 → missing_invoice_date 並轉 pending', () => {
    const r = prepareRecord(rec({ date: 'not-a-date', invoiceNumber: 'AB12345678' }))
    expect(r.invoiceKey).toBeNull()
    expect(r.pendingReasons).toContain('missing_invoice_date')
    expect(r.status).toBe('pending')
  })

  it('純手輸無號碼 → key 為 null，不進待確認', () => {
    const r = prepareRecord(rec())
    expect(r.invoiceKey).toBeNull()
    expect(r.pendingReasons).toEqual([])
    expect(r.status).toBe('confirmed')
  })
})

describe('§7.2 寫入判斷（真 IndexedDB）', () => {
  let storage: IndexedDbAdapter

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    storage = new IndexedDbAdapter()
  })

  it('無發票號碼的紀錄各自獨立，不會互相合併', async () => {
    for (let i = 0; i < 3; i++) await saveRecord(storage, rec())
    expect(await storage.count('records')).toBe(3)
  })

  it('同一張發票不論來自手輸或照片，只留一筆', async () => {
    const first = await saveRecord(
      storage,
      rec({ date: '2026-10-05', invoiceNumber: 'AB12345678', sourceType: 'manual', amount: 55 }),
    )
    expect(first.action).toBe('insert')

    const second = await saveRecord(
      storage,
      rec({ date: '2026-10-05', invoiceNumber: 'AB12345678', sourceType: 'photo', amount: 55 }),
    )
    expect(second.action).toBe('merge')
    expect(await storage.count('records')).toBe(1)
  })

  it('載具匯入走同一條路徑，去重後重複筆數為 0', async () => {
    const invoices = ['AB12345678', 'CD87654321', 'EF11112222']

    for (const n of invoices) {
      await saveRecord(storage, rec({ date: '2026-10-05', invoiceNumber: n, sourceType: 'manual' }))
    }
    // 同一批資料再以載具來源匯入一次。
    for (const n of invoices) {
      await saveRecord(storage, rec({ date: '2026-10-20', invoiceNumber: n, sourceType: 'carrier' }))
    }

    expect(await storage.count('records')).toBe(3)
  })

  it('合併時照片與紀錄同一個 transaction', async () => {
    await saveRecord(storage, rec({ date: '2026-10-05', invoiceNumber: 'AB12345678' }))
    const out = await saveRecord(
      storage,
      rec({ date: '2026-10-05', invoiceNumber: 'AB12345678', sourceType: 'photo', photoId: 'p1' }),
      { photo: photo('p1') },
    )

    expect(out.action).toBe('merge')
    expect(out.record.photoId).toBe('p1')
    expect(await storage.get('photos', 'p1')).toBeDefined()
    expect(await storage.count('records')).toBe(1)
  })

  it('既有已有照片時，新照片不寫入，不留孤兒', async () => {
    await saveRecord(
      storage,
      rec({ date: '2026-10-05', invoiceNumber: 'AB12345678', photoId: 'p1' }),
      { photo: photo('p1') },
    )
    const out = await saveRecord(
      storage,
      rec({ date: '2026-10-05', invoiceNumber: 'AB12345678', sourceType: 'photo', photoId: 'p2' }),
      { photo: photo('p2') },
    )

    expect(out.discardedPhotoId).toBe('p2')
    expect(await storage.get('photos', 'p2')).toBeUndefined()
    expect(await storage.count('photos')).toBe(1)
  })

  it('更新同一筆紀錄（id 相同）不會被當成重複', async () => {
    const r = prepareRecord(rec({ date: '2026-10-05', invoiceNumber: 'AB12345678' }))
    await saveRecord(storage, r)
    const again = await saveRecord(storage, { ...r, note: '改過' })

    expect(again.action).toBe('insert')
    expect(await storage.count('records')).toBe(1)
    expect((await storage.get<SpendRecord>('records', r.id))?.note).toBe('改過')
  })

  it('跨年度同號碼視為兩筆不同消費', async () => {
    await saveRecord(storage, rec({ date: '2025-10-05', invoiceNumber: 'AB12345678' }))
    await saveRecord(storage, rec({ date: '2026-10-05', invoiceNumber: 'AB12345678' }))
    expect(await storage.count('records')).toBe(2)
  })
})
