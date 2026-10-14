import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Rule, SpendRecord } from '@/models/types'
import { IndexedDbAdapter, seed } from '@/storage'
import { seedBuiltinRules } from '@/services/ruleService'
import { saveRecord } from '@/services/recordService'
import { confirmRecord } from '@/services/entryService'
import { parseCarrierCsv } from '@/parsing/carrierCsv'
import { carrierCsv, type CarrierRowOptions } from '@/test/fixtures'
import {
  CarrierImportChoiceError,
  CarrierImportStaleError,
  commitCarrierImport,
  planWrites,
  prepareCarrierImport,
  type ImportEntry,
} from '../carrierImportService'

const NOW = 1_760_000_000_000
const DATE = '2026-09-01'
const KEY = '11509-ZZ00000001'

let storage: IndexedDbAdapter

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
  await seed(storage)
  await seedBuiltinRules(storage)
})

function rec(over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    id: crypto.randomUUID(),
    date: DATE,
    merchant: '全家',
    amount: 55,
    items: [{ name: '咖啡', qty: 1, unitPrice: null, amount: null, categoryId: 'drink' }],
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
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...over,
  }
}

async function prepare(rows: CarrierRowOptions[], now = NOW) {
  const parsed = parseCarrierCsv(carrierCsv(rows))
  if (!parsed.ok) throw new Error(parsed.reason)
  return prepareCarrierImport(storage, parsed, now)
}

function only<K extends ImportEntry['kind']>(entries: ImportEntry[], kind: K) {
  expect(entries.map((e) => e.kind)).toEqual([kind])
  return entries[0] as Extract<ImportEntry, { kind: K }>
}

async function importRows(rows: CarrierRowOptions[], choices = new Map<number, string>()) {
  const preview = await prepare(rows)
  return commitCarrierImport(storage, preview, choices, NOW)
}

async function hitCountOf(pattern: string): Promise<number> {
  const rules = await storage.getAll<Rule>('rules')
  return rules.find((r) => r.pattern === pattern)!.hitCount
}

async function totalHits(): Promise<number> {
  return (await storage.getAll<Rule>('rules')).reduce((s, r) => s + r.hitCount, 0)
}

const MYSTERY: CarrierRowOptions[] = [{ item: '神秘', subtotal: '55', total: '55' }]

const TWO_ITEMS: CarrierRowOptions[] = [
  { item: '咖啡', subtotal: '55', total: '110' },
  { item: '拿鐵', subtotal: '55' },
]

describe('prepareCarrierImport 分桶', () => {
  it('空資料庫 → insert，帶 invoiceKey 與載具形狀的品項', async () => {
    const entry = only((await prepare([{ total: '55' }])).entries, 'insert')
    expect(entry.write.record).toMatchObject({
      invoiceKey: KEY,
      sourceType: 'carrier',
      amount: 55,
      items: [{ name: '咖啡', qty: 1, unitPrice: null, amount: 55 }],
    })
  })

  it('同號碼同期的 QR 紀錄 → merge，品項較多的載具資料換掉品項，隨機碼保留', async () => {
    await saveRecord(
      storage,
      rec({ invoiceNumber: 'ZZ00000001', sourceType: 'photo', amount: 110, invoiceRandomCode: '1234' }),
    )
    const entry = only((await prepare(TWO_ITEMS)).entries, 'merge')
    expect(entry.write.itemsReplaced).toBe(true)
    expect(entry.write.record.items.map((i) => i.name)).toEqual(['咖啡', '拿鐵'])
    expect(entry.write.record.invoiceRandomCode).toBe('1234')
  })

  it('QR 紀錄金額不同 → merge 並記衝突', async () => {
    await saveRecord(storage, rec({ invoiceNumber: 'ZZ00000001', sourceType: 'photo', amount: 100 }))
    const entry = only((await prepare(TWO_ITEMS)).entries, 'merge')
    expect(entry.write.conflicts).toContain('amount')
    expect(entry.write.record.pendingReasons).toContain('duplicate_conflict')
  })

  it('沒有 key、同日同額的手輸紀錄 → candidate', async () => {
    const manual = await saveRecord(storage, rec())
    const entry = only((await prepare([{ total: '55' }])).entries, 'candidate')
    expect(entry.merges.map((m) => m.existing.id)).toEqual([manual.record.id])
  })

  it('金額差 1 → 不是候選', async () => {
    await saveRecord(storage, rec({ amount: 54 }))
    only((await prepare([{ total: '55' }])).entries, 'insert')
  })

  it('已有發票號碼的同日同額紀錄 → 不是候選', async () => {
    await saveRecord(storage, rec({ invoiceNumber: 'ZZ99999999' }))
    only((await prepare([{ total: '55' }])).entries, 'insert')
  })

  it('兩張同日同額的發票 → 都列出同一個候選', async () => {
    const manual = await saveRecord(storage, rec())
    const { entries } = await prepare([
      { total: '55' },
      { number: 'ZZ00000002', total: '55' },
    ])
    expect(entries.map((e) => (e.kind === 'candidate' ? e.merges.map((m) => m.existing.id) : []))).toEqual(
      [[manual.record.id], [manual.record.id]],
    )
  })

  it('店家空白 → 新增時帶 missing_merchant', async () => {
    const entry = only((await prepare([{ merchant: '', total: '55' }])).entries, 'insert')
    expect(entry.write.record.pendingReasons).toContain('missing_merchant')
    expect(entry.write.record.status).toBe('pending')
  })

  it('使用者指定過類別的紀錄被合併 → 類別不變', async () => {
    await saveRecord(
      storage,
      rec({ invoiceNumber: 'ZZ00000001', sourceType: 'photo', amount: 110, categoryId: 'fun', categorySource: 'user' }),
    )
    const entry = only((await prepare(TWO_ITEMS)).entries, 'merge')
    expect(entry.write.record).toMatchObject({ categoryId: 'fun', categorySource: 'user' })
    expect(entry.write.matchedRuleIds).toEqual([])
  })

  it('合併後分得出類別 → 舊的 no_category_match 清掉', async () => {
    await saveRecord(
      storage,
      rec({
        invoiceNumber: 'ZZ00000001',
        sourceType: 'photo',
        amount: 110,
        items: [{ name: '神秘', qty: 1, unitPrice: null, amount: null, categoryId: null }],
        categoryId: null,
        status: 'pending',
        pendingReasons: ['no_category_match'],
      }),
    )
    const entry = only((await prepare(TWO_ITEMS)).entries, 'merge')
    expect(entry.write.record.pendingReasons).not.toContain('no_category_match')
    expect(entry.write.record).toMatchObject({ categoryId: 'drink', status: 'confirmed' })
  })

  it('parser 的拒收原樣帶到 preview', async () => {
    const preview = await prepare([{ total: '' }])
    expect(preview.entries).toEqual([])
    expect(preview.rejected.map((r) => r.reason)).toEqual(['total_missing'])
  })
})

describe('重新匯入（冪等）', () => {
  it('同一份再匯入 → 全部 unchanged，總筆數不變', async () => {
    await importRows([{ total: '55' }])
    only((await prepare([{ total: '55' }])).entries, 'unchanged')
    await importRows([{ total: '55' }])
    expect(await storage.count('records')).toBe(1)
  })

  it('分不出類別的紀錄被「確認」後再匯入 → unchanged，仍是 confirmed', async () => {
    await importRows(MYSTERY)
    const [stored] = await storage.getAll<SpendRecord>('records')
    expect(stored!.categoryId).toBeNull()
    await confirmRecord(storage, stored!)

    only((await prepare(MYSTERY)).entries, 'unchanged')
    await importRows(MYSTERY)
    const [after] = await storage.getAll<SpendRecord>('records')
    expect(after!.status).toBe('confirmed')
  })
})

describe('planWrites', () => {
  it('分不出類別的新增計入 newlyPending', async () => {
    const preview = await prepare([...MYSTERY, { number: 'ZZ00000002', total: '55' }])
    expect(planWrites(preview, new Map()).newlyPending).toBe(1)
  })

  it('選合併的候選若結果是待確認，也計入 newlyPending', async () => {
    const manual = await saveRecord(storage, rec())
    const preview = await prepare(MYSTERY)
    expect(planWrites(preview, new Map()).newlyPending).toBe(1)
    expect(planWrites(preview, new Map([[0, manual.record.id]])).newlyPending).toBe(1)
  })

  it('合併進已經在待確認的紀錄、結果仍是待確認 → 不計入 newlyPending', async () => {
    await saveRecord(
      storage,
      rec({
        invoiceNumber: 'ZZ00000001',
        sourceType: 'photo',
        amount: 110,
        status: 'pending',
        pendingReasons: ['ambiguous_item_tokens'],
      }),
    )
    const preview = await prepare(TWO_ITEMS)
    expect(only(preview.entries, 'merge').write.record.status).toBe('pending')
    expect(planWrites(preview, new Map()).newlyPending).toBe(0)
  })

  it('選擇指向不是可能重複的那一筆 → CarrierImportChoiceError', async () => {
    const preview = await prepare([{ total: '55' }])
    expect(() => planWrites(preview, new Map([[0, 'x']]))).toThrow(CarrierImportChoiceError)
  })

  it('選的紀錄不在這一筆的候選裡 → CarrierImportChoiceError', async () => {
    await saveRecord(storage, rec())
    const preview = await prepare([{ total: '55' }])
    expect(() => planWrites(preview, new Map([[0, 'not-a-candidate']]))).toThrow(
      CarrierImportChoiceError,
    )
  })

  it('同一個候選被兩張發票選 → CarrierImportChoiceError', async () => {
    const manual = await saveRecord(storage, rec())
    const preview = await prepare([{ total: '55' }, { number: 'ZZ00000002', total: '55' }])
    const id = manual.record.id
    expect(() => planWrites(preview, new Map([[0, id], [1, id]]))).toThrow(CarrierImportChoiceError)
  })
})

describe('commitCarrierImport', () => {
  it('選合併 → 手輸紀錄補上 invoiceKey、品項換成發票明細，筆數不變', async () => {
    const manual = await saveRecord(storage, rec({ amount: 110, rawInput: '全家 咖啡 110' }))
    await importRows(TWO_ITEMS, new Map([[0, manual.record.id]]))

    const all = await storage.getAll<SpendRecord>('records')
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: manual.record.id, invoiceKey: KEY, rawInput: '全家 咖啡 110' })
    expect(all[0]!.items.map((i) => i.name)).toEqual(['咖啡', '拿鐵'])
  })

  it('預設兩筆都留；再匯入同一份 → unchanged，不再問', async () => {
    await saveRecord(storage, rec())
    await importRows([{ total: '55' }])
    expect(await storage.count('records')).toBe(2)
    only((await prepare([{ total: '55' }])).entries, 'unchanged')
  })

  it('預覽後既有紀錄被編輯 → CarrierImportStaleError，整批不寫、命中次數不變', async () => {
    const qr = await saveRecord(storage, rec({ invoiceNumber: 'ZZ00000001', sourceType: 'photo', amount: 110 }))
    const preview = await prepare([{ number: 'ZZ00000002', total: '55' }, ...TWO_ITEMS])
    const hitsBefore = await totalHits()
    await storage.put('records', { ...qr.record, note: '改過', updatedAt: NOW + 5 })

    await expect(commitCarrierImport(storage, preview, new Map(), NOW)).rejects.toBeInstanceOf(
      CarrierImportStaleError,
    )
    expect(await storage.count('records')).toBe(1)
    expect(await totalHits()).toBe(hitsBefore)
  })

  it('預覽後同一個 invoiceKey 被別筆寫入 → CarrierImportStaleError', async () => {
    const preview = await prepare([{ total: '55' }])
    await saveRecord(storage, rec({ invoiceNumber: 'ZZ00000001', amount: 999 }))
    await expect(commitCarrierImport(storage, preview, new Map(), NOW)).rejects.toBeInstanceOf(
      CarrierImportStaleError,
    )
  })

  it('預覽後新增了同日同額、沒有號碼的紀錄 → CarrierImportStaleError', async () => {
    const preview = await prepare([{ total: '55' }])
    await saveRecord(storage, rec())
    await expect(commitCarrierImport(storage, preview, new Map(), NOW)).rejects.toBeInstanceOf(
      CarrierImportStaleError,
    )
  })

  it('規則命中次數依命中的紀錄數累加', async () => {
    const before = await hitCountOf('咖啡')
    await importRows([{ total: '55' }, { number: 'ZZ00000002', total: '55' }])
    expect(await hitCountOf('咖啡')).toBe(before + 2)
  })

  it('合併進使用者指定類別的紀錄 → 不累加命中次數', async () => {
    await saveRecord(
      storage,
      rec({ invoiceNumber: 'ZZ00000001', sourceType: 'photo', amount: 110, categoryId: 'fun', categorySource: 'user' }),
    )
    const before = await totalHits()
    await importRows(TWO_ITEMS)
    expect(await totalHits()).toBe(before)
  })

  it('全部 unchanged → 不寫入，updatedAt 與命中次數都不變', async () => {
    await importRows([{ total: '55' }])
    const [before] = await storage.getAll<SpendRecord>('records')
    const hits = await totalHits()

    const preview = await prepare([{ total: '55' }], NOW + 1000)
    await commitCarrierImport(storage, preview, new Map(), NOW + 1000)
    const [after] = await storage.getAll<SpendRecord>('records')
    expect(after!.updatedAt).toBe(before!.updatedAt)
    expect(await totalHits()).toBe(hits)
  })
})
