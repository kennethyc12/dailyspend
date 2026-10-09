import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Rule, SpendRecord } from '@/models/types'
import { IndexedDbAdapter, seed } from '@/storage'
import { loadActiveRules, seedBuiltinRules } from '@/services/ruleService'
import {
  confirmRecord,
  correctCategory,
  createFromText,
  deleteRecord,
  merchantDictionary,
} from '../entryService'

const NOW = 1_760_000_000_000

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

describe('文字輸入的完整流程（§9）', () => {
  it('「全家 咖啡 55」→ 飲料、已確認', async () => {
    const result = await createFromText(storage, '全家 咖啡 55', NOW)
    expect(result.ok).toBe(true)

    const r = await only()
    expect(r.merchant).toBe('全家')
    expect(r.amount).toBe(55)
    expect(r.items.map((i) => i.name)).toEqual(['咖啡'])
    expect(r.categoryId).toBe('drink')
    expect(r.categorySource).toBe('rule')
    expect(r.status).toBe('confirmed')
  })

  it('「全家 55」→ 無品項、超商不猜類別，進待確認', async () => {
    await createFromText(storage, '全家 55', NOW)
    const r = await only()
    expect(r.categoryId).toBeNull()
    expect(r.status).toBe('pending')
    expect(r.pendingReasons).toContain('no_category_match')
  })

  it('缺金額時擋下，不寫入任何東西', async () => {
    const result = await createFromText(storage, '全家 咖啡', NOW)
    expect(result).toMatchObject({ ok: false, blocked: 'amount_missing' })
    expect(await storage.count('records')).toBe(0)
  })

  it('剖析與分類的 pendingReasons 會合併', async () => {
    await createFromText(storage, '全聯 咖啡 55 麵包 30', NOW)
    const r = await only()
    expect(r.items.map((i) => i.name)).toEqual(['咖啡', '麵包'])
    // 剖析階段的 ambiguous_item_tokens 要跟著一路帶到紀錄上。
    expect(r.pendingReasons).toContain('ambiguous_item_tokens')
    expect(r.status).toBe('pending')
  })

  it('品項層級的分類也寫進 items', async () => {
    await createFromText(storage, '全聯 咖啡 衛生紙 200', NOW)
    const r = await only()
    expect(r.items.map((i) => i.categoryId)).toEqual(['drink', 'daily'])
  })

  it('命中的規則會累計 hitCount', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    await createFromText(storage, '7-11 咖啡 45', NOW)

    const rules = await loadActiveRules(storage)
    expect(rules.find((r) => r.pattern === '咖啡')?.hitCount).toBe(2)
  })

  it('「昨天」前綴會改日期', async () => {
    await createFromText(storage, '昨天 全家 咖啡 55', NOW)
    const r = await only()
    const today = new Date().toISOString().slice(0, 10)
    expect(r.date).not.toBe(today)
  })

  it('店家字典會納入歷史紀錄', async () => {
    await createFromText(storage, '鼎泰豐 小籠包 250', NOW)
    expect(await merchantDictionary(storage)).toContain('鼎泰豐')
  })
})

describe('修正分類（§6.2 在真實流程中）', () => {
  it('單品項修正後建立規則，下一筆同品項直接分對', async () => {
    await createFromText(storage, '小農 地瓜 60', NOW)
    const first = await only()
    expect(first.categoryId).toBeNull()

    const { plan } = await correctCategory(storage, first, 'food')
    expect(plan.kind).toBe('create')

    await createFromText(storage, '全聯 地瓜 45', NOW)
    const all = await storage.getAll<SpendRecord>('records')
    const second = all.find((r) => r.merchant === '全聯')!
    expect(second.categoryId).toBe('food')
    expect(second.status).toBe('confirmed')
  })

  it('修正後紀錄轉為 user 來源並離開待確認', async () => {
    await createFromText(storage, '蝦皮 320', NOW)
    const { record } = await correctCategory(storage, await only(), 'fun')

    expect(record.categoryId).toBe('fun')
    expect(record.categorySource).toBe('user')
    expect(record.status).toBe('confirmed')
    expect(record.pendingReasons).toEqual([])
  })

  it('多品項整筆修正不建品項規則，回傳 needs_per_item', async () => {
    await createFromText(storage, '全聯 雞胸 不明物 300', NOW)
    const { plan, record } = await correctCategory(storage, await only(), 'food')

    expect(plan.kind).toBe('needs_per_item')
    expect(record.categoryId).toBe('food')

    const rules = await storage.getAll<Rule>('rules')
    expect(rules.find((r) => r.pattern === '不明物')).toBeUndefined()
  })

  it('逐項指定會各建一條品項規則', async () => {
    await createFromText(storage, '全聯 雞胸 不明物 300', NOW)
    let r = await only()
    r = (await correctCategory(storage, r, 'food', { kind: 'item', index: 0 })).record
    r = (await correctCategory(storage, r, 'daily', { kind: 'item', index: 1 })).record

    expect(r.items.map((i) => i.categoryId)).toEqual(['food', 'daily'])
    const rules = await storage.getAll<Rule>('rules')
    expect(rules.find((x) => x.pattern === '雞胸')?.categoryId).toBe('food')
    expect(rules.find((x) => x.pattern === '不明物')?.categoryId).toBe('daily')
  })

  it('略過逐項指定時只建店家規則', async () => {
    await createFromText(storage, '某店 雞胸 不明物 300', NOW)
    const r = await only()
    await correctCategory(storage, r, 'food', { kind: 'record' }, { skipPerItem: true })

    const rules = await storage.getAll<Rule>('rules')
    const learned = rules.filter((x) => x.origin === 'userCorrection')
    expect(learned).toHaveLength(1)
    expect(learned[0]).toMatchObject({ type: 'merchant', pattern: '某店' })
  })
})

describe('確認與刪除', () => {
  it('確認會清掉所有待確認原因', async () => {
    await createFromText(storage, '全家 55', NOW)
    const r = await confirmRecord(storage, await only(), {}, NOW + 1)

    expect(r.status).toBe('confirmed')
    expect(r.pendingReasons).toEqual([])
    expect((await only()).status).toBe('confirmed')
  })

  it('刪除紀錄會一併刪掉照片，不留孤兒', async () => {
    await storage.put('photos', {
      id: 'p1',
      blob: new Blob(['x']),
      thumbBlob: new Blob(['t']),
      width: 1,
      height: 1,
      bytes: 1,
      capturedAt: NOW,
    })
    await createFromText(storage, '全家 咖啡 55', NOW)
    const r = { ...(await only()), photoId: 'p1' }
    await storage.put('records', r)

    await deleteRecord(storage, r)
    expect(await storage.count('records')).toBe(0)
    expect(await storage.count('photos')).toBe(0)
  })
})
