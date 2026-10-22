import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Photo, SpendRecord } from '@/models/types'
import { IndexedDbAdapter, seed } from '@/storage'
import { seedBuiltinRules } from '@/services/ruleService'
import { parseEInvoicePayload, type RecognizedInvoice } from '@/recognize/einvoicePayload'
import { leftQr, REAL_B_LEFT, REAL_B_RIGHT } from '@/test/fixtures'
import { createFromInvoice } from '../invoiceService'

const NOW = Date.UTC(2026, 9, 11, 4, 0, 0)
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

let storage: IndexedDbAdapter

function photo(id = 'p1'): Photo {
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

function recognized(patch: Partial<RecognizedInvoice> = {}): RecognizedInvoice {
  return {
    invoiceNumber: 'AB12345678',
    date: '2026-10-11',
    randomCode: '3456',
    totalAmount: 1050,
    salesAmount: 1000,
    items: [{ name: '咖啡', qty: 1, value: 55 }],
    kinds: ['left'],
    notes: [],
    confidence: 1,
    ...patch,
  }
}

async function only(): Promise<SpendRecord> {
  const all = await storage.getAll<SpendRecord>('records')
  expect(all).toHaveLength(1)
  return all[0]!
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
  await seed(storage)
  await seedBuiltinRules(storage, NOW)
})

describe('從發票存檔', () => {
  it('帶入號碼、日期、總計額與品項，並算出 invoiceKey', async () => {
    const result = await createFromInvoice(
      storage,
      { recognized: recognized(), merchant: '全家', amount: null, photo: photo() },
      NOW,
    )

    expect(result.ok).toBe(true)
    const r = await only()
    expect(r.invoiceNumber).toBe('AB12345678')
    expect(r.date).toBe('2026-10-11')
    expect(r.amount).toBe(1050)
    expect(r.items.map((i) => i.name)).toEqual(['咖啡'])
    expect(r.sourceType).toBe('photo')
    // 11509 = 民國 115 年、9–10 月期
    expect(r.invoiceKey).toBe('11509-AB12345678')
  })

  it('品項照樣跑分類', async () => {
    await createFromInvoice(
      storage,
      { recognized: recognized(), merchant: '全家', amount: null },
      NOW,
    )

    expect((await only()).categoryId).toBe('drink')
  })

  it('品項的數字不寫進 unitPrice/amount，原始值留在 rawRecognition', async () => {
    await createFromInvoice(
      storage,
      { recognized: recognized(), merchant: '全家', amount: null },
      NOW,
    )

    const r = await only()
    expect(r.items[0]!.unitPrice).toBeNull()
    expect(r.items[0]!.amount).toBeNull()
    expect((r.rawRecognition as RecognizedInvoice).items[0]!.value).toBe(55)
  })

  it('沒有總計額時用使用者輸入的金額', async () => {
    const result = await createFromInvoice(
      storage,
      {
        recognized: recognized({ totalAmount: null, confidence: 0.5, kinds: ['unknown'] }),
        merchant: '康是美',
        amount: 1179,
      },
      NOW,
    )

    expect(result.ok).toBe(true)
    expect((await only()).amount).toBe(1179)
  })

  it('沒有總計額又沒輸入金額時擋下，不寫入', async () => {
    const result = await createFromInvoice(
      storage,
      { recognized: recognized({ totalAmount: null }), merchant: '康是美', amount: null },
      NOW,
    )

    expect(result).toEqual({ ok: false, blocked: 'amount_missing' })
    expect(await storage.count('records')).toBe(0)
  })

  it('有總計額時忽略手輸金額，不產生 amount_mismatch（§5.4、D2c）', async () => {
    await createFromInvoice(
      storage,
      { recognized: recognized(), merchant: '全家', amount: 999 },
      NOW,
    )

    const r = await only()
    expect(r.amount).toBe(1050)
    expect(r.pendingReasons).not.toContain('amount_mismatch')
  })

  it('沒填店家時標記 missing_merchant', async () => {
    await createFromInvoice(storage, { recognized: recognized(), merchant: '  ', amount: null }, NOW)

    expect((await only()).pendingReasons).toContain('missing_merchant')
  })

  it('有表頭但沒有品項時，不標記 recognition_failed（§5.4、D2b）', async () => {
    await createFromInvoice(
      storage,
      { recognized: recognized({ items: [], confidence: 0.8 }), merchant: '全家', amount: null },
      NOW,
    )

    expect((await only()).pendingReasons).not.toContain('recognition_failed')
  })

  it('沒有表頭但有品項時，不標記 recognition_failed', async () => {
    await createFromInvoice(
      storage,
      {
        recognized: recognized({ invoiceNumber: null, date: null, totalAmount: null, confidence: 0.5 }),
        merchant: '全家',
        amount: 120,
        date: '2026-10-11',
      },
      NOW,
    )

    expect((await only()).pendingReasons).not.toContain('recognition_failed')
  })

  it('同一張發票存兩次會合併成一筆（§7.2）', async () => {
    await createFromInvoice(storage, { recognized: recognized(), merchant: '全家', amount: null }, NOW)
    const second = await createFromInvoice(
      storage,
      { recognized: recognized(), merchant: '全家', amount: null },
      NOW + 1000,
    )

    expect(second.ok && second.save.action).toBe('merge')
    expect(await storage.count('records')).toBe(1)
  })

  it('沒有發票號碼時 invoiceKey 是 null，不參與去重', async () => {
    await createFromInvoice(
      storage,
      {
        recognized: recognized({ invoiceNumber: null, date: null, totalAmount: null }),
        merchant: '康是美',
        amount: 100,
        date: '2026-09-01',
      },
      NOW,
    )

    const r = await only()
    expect(r.invoiceKey).toBeNull()
    expect(r.date).toBe('2026-09-01')
  })

  it('沒有表頭又沒填日期時擋下，不再預設今天、不寫入', async () => {
    const result = await createFromInvoice(
      storage,
      { recognized: recognized({ invoiceNumber: null, date: null, totalAmount: null }), merchant: '康是美', amount: 100 },
      NOW,
    )

    expect(result).toEqual({ ok: false, blocked: 'date_missing' })
    expect(await storage.count('records')).toBe(0)
  })

  it('沒有表頭時填了不存在的日期 → date_invalid', async () => {
    const result = await createFromInvoice(
      storage,
      {
        recognized: recognized({ invoiceNumber: null, date: null, totalAmount: null }),
        merchant: '康是美',
        amount: 100,
        date: '2026-02-30',
      },
      NOW,
    )

    expect(result).toEqual({ ok: false, blocked: 'date_invalid' })
    expect(await storage.count('records')).toBe(0)
  })

  it('有表頭時以 QR 的日期為準，忽略使用者傳入的日期（它決定 invoiceKey）', async () => {
    await createFromInvoice(storage, { recognized: recognized(), merchant: '全家', amount: null, date: '2026-01-01' }, NOW)

    expect((await only()).date).toBe('2026-10-11')
  })

  it('負數金額的品項照收（回饋金）', async () => {
    await createFromInvoice(
      storage,
      {
        recognized: recognized({
          items: [
            { name: '回饋金', qty: 1, value: -300 },
            { name: '雞精', qty: 2, value: 1479 },
          ],
        }),
        merchant: '康是美',
        amount: null,
      },
      NOW,
    )

    expect((await only()).items.map((i) => i.name)).toEqual(['回饋金', '雞精'])
  })
})

describe('一張照片讀到多張發票', () => {
  it('拒絕帶入後手輸金額存檔 → 沒有品項、進待確認，不是默默存成已確認', async () => {
    const rejected = parseEInvoicePayload([
      leftQr({ invoiceNumber: 'AA12345678' }),
      leftQr({ invoiceNumber: 'BB12345678' }),
    ])

    const result = await createFromInvoice(
      storage,
      { recognized: rejected, merchant: '全家', amount: 120, date: '2026-10-11' },
      NOW,
    )
    expect(result.ok).toBe(true)

    const r = await only()
    expect(r.items).toEqual([])
    expect(r.invoiceNumber).toBeNull()
    expect(r.status).toBe('pending')
    expect(r.pendingReasons).toContain('recognition_failed')
  })
})

describe('實拍 B：單價帶小數', () => {
  it('三個品項都存進去，不因解析失敗轉待確認；品項金額欄位維持 null', async () => {
    const recognized = parseEInvoicePayload([REAL_B_LEFT, REAL_B_RIGHT])

    const result = await createFromInvoice(storage, { recognized, merchant: '燒肉店', amount: null }, NOW)
    expect(result.ok).toBe(true)

    const r = await only()
    expect(r.items.map((i) => [i.name, i.qty, i.unitPrice, i.amount])).toEqual([
      ['炙燒明太子', 1, null, null],
      ['蒜味美乃滋', 1, null, null],
      ['炸雞翅', 1, null, null],
    ])
    expect(r.pendingReasons).not.toContain('recognition_failed')
    expect(r.amount).toBe(840)
  })
})

