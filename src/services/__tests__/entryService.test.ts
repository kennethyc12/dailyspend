import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { RecordItem, Rule, SpendRecord } from '@/models/types'
import { todayIso } from '@/parsing/quickInput'
import { addDays } from '@/analysis/dates'
import { IndexedDbAdapter, seed, StorageConflictError } from '@/storage'
import { loadActiveRules, seedBuiltinRules } from '@/services/ruleService'
import {
  computeRecordUpdate,
  confirmRecord,
  correctCategory,
  createFromText,
  deleteRecord,
  getRecord,
  learnItemRule,
  resolvePending,
  updateRecordFields,
  ValidationError,
} from '../entryService'

const NOW = 1_760_000_000_000

let storage: IndexedDbAdapter

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
  await seed(storage)
  await seedBuiltinRules(storage, NOW)
})

async function ruleFor(pattern: string): Promise<Rule> {
  const found = (await storage.getAll<Rule>('rules')).find((r) => r.pattern === pattern)
  if (!found) throw new Error(`找不到規則「${pattern}」`)
  return found
}

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
    // 今天用本地日期（同 parseQuickInput）；UTC 日期在台北 00:00–08:00 會等於本地的昨天
    expect(r.date).toBe(addDays(todayIso(), -1))
  })
})

describe('修正分類（§6.2 在真實流程中）', () => {
  it('改分類時，過時的 missing_merchant 也一併解除', async () => {
    await createFromText(storage, '全家 地瓜 55', NOW)
    const stale: SpendRecord = {
      ...(await only()),
      status: 'pending',
      pendingReasons: ['missing_merchant', 'no_category_match'],
    }
    // B4.1 之前存下的舊資料：店家已補上，原因還掛著。
    await storage.put('records', stale)

    const { record } = await correctCategory(storage, stale, 'food')
    expect(record.pendingReasons).toEqual([])
    expect(record.status).toBe('confirmed')
  })

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

describe('待確認的確認與記住規則（B4.2a）', () => {
  const learnedRules = async () =>
    (await storage.getAll<Rule>('rules')).filter((r) => r.origin === 'userCorrection')

  it('確認：套用類別、清掉原因，不建規則', async () => {
    await createFromText(storage, '某店 320', NOW)
    const out = await resolvePending(storage, await only(), {
      categoryId: 'fun',
      remember: false,
      now: NOW + 1,
    })

    expect(out.kind).toBe('confirmed')
    const r = await only()
    expect(r).toMatchObject({
      status: 'confirmed',
      categoryId: 'fun',
      categorySource: 'user',
      pendingReasons: [],
    })
    expect(await learnedRules()).toHaveLength(0)
  })

  it('確認並記住：沒有品項 → 店家規則', async () => {
    await createFromText(storage, '某店 320', NOW)
    const out = await resolvePending(storage, await only(), { categoryId: 'fun', remember: true })

    expect(out.kind === 'confirmed' && out.learned).toMatchObject({
      type: 'merchant',
      pattern: '某店',
      categoryId: 'fun',
    })
    expect((await only()).status).toBe('confirmed')
    expect(await learnedRules()).toHaveLength(1)
  })

  it('確認並記住：一個品項 → 品項規則', async () => {
    await createFromText(storage, '某店 不明物 320', NOW)
    const out = await resolvePending(storage, await only(), { categoryId: 'fun', remember: true })

    expect(out.kind === 'confirmed' && out.learned).toMatchObject({
      type: 'itemKeyword',
      pattern: '不明物',
    })
  })

  it('確認並記住：多個品項 → needs_per_item，什麼都不寫', async () => {
    await createFromText(storage, '某店 甲甲 乙乙 100', NOW)
    const before = await only()
    const out = await resolvePending(storage, before, { categoryId: 'fun', remember: true })

    expect(out).toEqual({ kind: 'needs_per_item', itemNames: ['甲甲', '乙乙'] })
    expect(await only()).toEqual(before)
    expect(await learnedRules()).toHaveLength(0)
  })

  it('多個品項略過逐項指定 → 店家規則並確認', async () => {
    await createFromText(storage, '某店 甲甲 乙乙 100', NOW)
    const out = await resolvePending(storage, await only(), {
      categoryId: 'fun',
      remember: true,
      skipPerItem: true,
    })

    expect(out.kind === 'confirmed' && out.learned).toMatchObject({
      type: 'merchant',
      pattern: '某店',
    })
    expect((await only()).status).toBe('confirmed')
  })

  it('沒有店家也沒有品項：沒東西可記，照樣確認', async () => {
    await createFromText(storage, '320', NOW)
    expect((await only()).pendingReasons).toContain('missing_merchant')

    const out = await resolvePending(storage, await only(), { categoryId: 'fun', remember: true })

    expect(out.kind === 'confirmed' && out.learned).toBeNull()
    expect(await only()).toMatchObject({ status: 'confirmed', pendingReasons: [] })
    expect(await learnedRules()).toHaveLength(0)
  })

  it('類別沒改就確認：維持規則判斷的來源與信心', async () => {
    await createFromText(storage, '全家 咖啡 55 麵包', NOW)
    const before = await only()
    expect(before.categoryId).toBe('drink')

    await resolvePending(storage, before, { categoryId: 'drink', remember: false })

    expect(await only()).toMatchObject({
      status: 'confirmed',
      categoryId: 'drink',
      categorySource: 'rule',
      classifyConfidence: before.classifyConfidence,
    })
  })

  it('記住但沒有類別 → ValidationError，資料不變', async () => {
    await createFromText(storage, '某店 320', NOW)
    const before = await only()

    await expect(
      resolvePending(storage, before, { categoryId: null, remember: true }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await only()).toEqual(before)
  })

  it('規則與紀錄同一個 transaction：紀錄寫入失敗時規則也不留', async () => {
    await createFromText(storage, '某店 320', NOW)
    const pending = await only()
    await storage.put('records', { ...pending, id: 'other', invoiceKey: 'K' })
    // 業務上不會發生：故意讓紀錄撞 unique index，模擬寫入失敗
    const colliding: SpendRecord = { ...pending, invoiceKey: 'K' }

    await expect(
      resolvePending(storage, colliding, { categoryId: 'fun', remember: true }),
    ).rejects.toThrow()

    expect(await learnedRules()).toHaveLength(0)
    expect(await getRecord(storage, pending.id)).toEqual(pending)
  })

  it('確認不經過 prepareRecord：日期壞掉的發票也清空原因', async () => {
    await createFromText(storage, '某店 320', NOW)
    const broken: SpendRecord = {
      ...(await only()),
      date: '2026-13-40',
      invoiceNumber: 'AB12345678',
      pendingReasons: ['missing_invoice_date'],
      status: 'pending',
    }
    await storage.put('records', broken)

    await resolvePending(storage, broken, { categoryId: null, remember: false })

    expect(await only()).toMatchObject({ status: 'confirmed', pendingReasons: [] })
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

describe('編輯既有紀錄', () => {
  it('補上店家後 missing_merchant 解除', async () => {
    await createFromText(storage, '55', NOW)
    const before = await only()
    expect(before.pendingReasons).toContain('missing_merchant')

    const next = await updateRecordFields(
      storage,
      before,
      { merchant: '全家', itemNames: ['咖啡'] },
      NOW + 1,
    )
    expect(next.pendingReasons).not.toContain('missing_merchant')
    expect(next.status).toBe('confirmed')
  })

  it('改金額與店家後存回', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const next = await updateRecordFields(
      storage,
      await only(),
      { merchant: '7-11', amount: 45, note: '改過' },
      NOW + 1,
    )

    expect(next.merchant).toBe('7-11')
    expect(next.amount).toBe(45)
    expect(next.note).toBe('改過')
    expect(next.updatedAt).toBe(NOW + 1)
    expect((await only()).amount).toBe(45)
  })

  it('金額必須是整數且非負', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const r = await only()
    await expect(updateRecordFields(storage, r, { amount: 55.5 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(updateRecordFields(storage, r, { amount: -1 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect((await only()).amount).toBe(55)
  })

  it('保存正規化前的原始輸入，編輯後不變', async () => {
    await createFromText(storage, '全家　咖啡　５５', NOW)
    const r = await only()
    expect(r.rawInput).toBe('全家　咖啡　５５')

    await updateRecordFields(storage, r, { note: '改過' }, NOW + 1)
    expect((await only()).rawInput).toBe('全家　咖啡　５５')
  })

  it('日期格式正確但不存在（2026-02-30）時擋下', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const r = await only()
    await expect(updateRecordFields(storage, r, { date: '2026-02-30' })).rejects.toThrow('日期不存在')
    expect((await only()).date).toBe(r.date)
  })

  it('日期格式不合法時擋下', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    await expect(
      updateRecordFields(storage, await only(), { date: '2026/10/09' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('改品項會重跑分類', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    expect((await only()).categoryId).toBe('drink')

    const next = await updateRecordFields(storage, await only(), { itemNames: ['衛生紙'] }, NOW + 1)
    expect(next.categoryId).toBe('daily')
    expect(next.items[0]?.categoryId).toBe('daily')
  })

  it('改品項重跑分類時累計命中次數', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const before = await ruleFor('衛生紙')

    await updateRecordFields(storage, await only(), { itemNames: ['衛生紙'] }, NOW + 1)

    expect((await ruleFor('衛生紙')).hitCount).toBe(before.hitCount + 1)
  })

  it('使用者指定過的分類不會被重跑的規則蓋掉', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const { record } = await correctCategory(storage, await only(), 'food')
    expect(record.categorySource).toBe('user')

    const next = await updateRecordFields(storage, record, { itemNames: ['衛生紙'] }, NOW + 1)
    expect(next.categoryId).toBe('food')
    expect(next.categorySource).toBe('user')
  })

  it('同名品項保留既有的 categoryId，新品項才重新分類', async () => {
    await createFromText(storage, '全聯 咖啡 200', NOW)
    const next = await updateRecordFields(
      storage,
      await only(),
      { itemNames: ['咖啡', '衛生紙'] },
      NOW + 1,
    )
    expect(next.items.map((i) => i.categoryId)).toEqual(['drink', 'daily'])
  })

  it('改日期會重算 invoiceKey', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const withInvoice = { ...(await only()), invoiceNumber: 'AB12345678' }
    const keyed = await updateRecordFields(storage, withInvoice, { date: '2026-10-05' }, NOW + 1)
    expect(keyed.invoiceKey).toBe('11509-AB12345678')

    // 跨到另一個期別，key 必須跟著變，否則索引內容會對不上。
    const moved = await updateRecordFields(storage, keyed, { date: '2026-12-05' }, NOW + 2)
    expect(moved.invoiceKey).toBe('11511-AB12345678')
  })

  it('改成分不出類別的品項會轉回待確認', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    expect((await only()).status).toBe('confirmed')

    const next = await updateRecordFields(storage, await only(), { itemNames: ['不明物'] }, NOW + 1)
    expect(next.status).toBe('pending')
    expect(next.pendingReasons).toContain('no_category_match')
  })

  it('沒傳 itemNames 時品項原樣保留', async () => {
    await createFromText(storage, '全聯 咖啡 衛生紙 200', NOW)
    const before = await only()
    const next = await updateRecordFields(storage, before, { amount: 210 }, NOW + 1)
    expect(next.items).toEqual(before.items)
  })

  it('getRecord 取得單筆', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const r = await only()
    expect((await getRecord(storage, r.id))?.id).toBe(r.id)
    expect(await getRecord(storage, 'nope')).toBeUndefined()
  })
})

describe('編輯品項：同名品項各自保留', () => {
  const item = (name: string, qty: number, amount: number | null, categoryId: string | null = null): RecordItem => ({
    name,
    qty,
    unitPrice: null,
    amount,
    categoryId,
  })

  async function withItems(items: RecordItem[], over: Partial<SpendRecord> = {}): Promise<SpendRecord> {
    await createFromText(storage, '某店 某品 100', NOW)
    return { ...(await only()), items, ...over }
  }

  const shape = (r: SpendRecord) => r.items.map((i) => [i.name, i.qty, i.amount])
  const edit = async (record: SpendRecord, itemNames: string[]) =>
    (await computeRecordUpdate(storage, record, { itemNames }, { now: NOW + 1 })).record

  it('加一個品項：兩個同名品項各自保留數量與金額', async () => {
    const r = await withItems([item('綠茶', 1, 29), item('綠茶', 1, 28)])
    expect(shape(await edit(r, ['綠茶', '綠茶', '某品']))).toEqual([
      ['綠茶', 1, 29],
      ['綠茶', 1, 28],
      ['某品', 1, null],
    ])
  })

  it('刪掉第二個同名品項：留下第一個', async () => {
    const r = await withItems([item('洗衣精', 1, 369), item('回饋金', 1, -90), item('洗衣精', 3, 111)])
    expect(shape(await edit(r, ['洗衣精', '回饋金']))).toEqual([
      ['洗衣精', 1, 369],
      ['回饋金', 1, -90],
    ])
  })

  it('換順序：同名品項依原本的順序配對', async () => {
    const r = await withItems([item('洗衣精', 1, 369), item('洗衣精', 3, 111), item('回饋金', 1, -90)])
    expect(shape(await edit(r, ['回饋金', '洗衣精', '洗衣精']))).toEqual([
      ['回饋金', 1, -90],
      ['洗衣精', 1, 369],
      ['洗衣精', 3, 111],
    ])
  })

  // 舊的品名 Map 是後值勝，這個情境碰巧對；修正後仍須成立
  it('刪掉第一個同名品項：留下第二個', async () => {
    const r = await withItems([item('洗衣精', 1, 369), item('回饋金', 1, -90), item('洗衣精', 3, 111)])
    expect(shape(await edit(r, ['回饋金', '洗衣精']))).toEqual([
      ['回饋金', 1, -90],
      ['洗衣精', 3, 111],
    ])
  })

  it('相鄰的同名品項刪掉一個：分不出刪的是哪個，保留前面那個', async () => {
    const r = await withItems([item('綠茶', 1, 29), item('綠茶', 1, 28)])
    expect(shape(await edit(r, ['綠茶']))).toEqual([['綠茶', 1, 29]])
  })

  it('使用者指定的逐項分類：同名品項各自保留', async () => {
    const r = await withItems([item('綠茶', 1, 29, 'drink'), item('綠茶', 1, 28, 'daily')], {
      categorySource: 'user',
    })
    const out = await computeRecordUpdate(
      storage,
      r,
      { itemNames: ['綠茶', '綠茶', '某品'] },
      { now: NOW + 1, reclassify: false },
    )
    expect(out.record.items.map((i) => i.categoryId)).toEqual(['drink', 'daily', null])
  })

  it('再加一個同名品項：前兩個各自保留，第三個是新品項', async () => {
    const r = await withItems([item('綠茶', 1, 29), item('綠茶', 1, 28)])
    expect(shape(await edit(r, ['綠茶', '綠茶', '綠茶']))).toEqual([
      ['綠茶', 1, 29],
      ['綠茶', 1, 28],
      ['綠茶', 1, null],
    ])
  })
})

describe('就地編輯的 service（B4.2b-2）', () => {
  it('computeRecordUpdate 只算不寫：重分類結果與命中的規則都回傳，DB 與命中次數不變', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)
    const before = await only()
    const tissue = await ruleFor('衛生紙')

    const out = await computeRecordUpdate(storage, before, { itemNames: ['衛生紙'] }, { now: NOW + 1 })

    expect(out.record).toMatchObject({ categoryId: 'daily', items: [{ name: '衛生紙' }] })
    expect(out.matchedRuleIds).toContain(tissue.id)
    expect(await only()).toEqual(before)
    expect((await ruleFor('衛生紙')).hitCount).toBe(tissue.hitCount)
  })

  it('computeRecordUpdate 可以不重分類', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW)

    const out = await computeRecordUpdate(
      storage,
      await only(),
      { itemNames: ['衛生紙'] },
      { now: NOW + 1, reclassify: false },
    )

    expect(out.record.categoryId).toBe('drink')
    expect(out.matchedRuleIds).toEqual([])
  })

  it('computeRecordUpdate 補好店家會解除原因，但 DB 仍待確認', async () => {
    await createFromText(storage, '55', NOW)

    const out = await computeRecordUpdate(storage, await only(), { merchant: '某店' })

    expect(out.record.pendingReasons).not.toContain('missing_merchant')
    expect((await only()).status).toBe('pending')
  })

  it('resolvePending 帶 hitRuleIds：確認時累計命中次數', async () => {
    await createFromText(storage, '某店 320', NOW)
    const tissue = await ruleFor('衛生紙')

    await resolvePending(storage, await only(), {
      categoryId: null,
      remember: false,
      hitRuleIds: [tissue.id],
    })

    expect((await ruleFor('衛生紙')).hitCount).toBe(tissue.hitCount + 1)
    expect((await only()).status).toBe('confirmed')
  })

  it('resolvePending 紀錄寫入失敗時命中次數也不留', async () => {
    await createFromText(storage, '某店 320', NOW)
    const pending = await only()
    await storage.put('records', { ...pending, id: 'other', invoiceKey: 'K' })
    const tissue = await ruleFor('衛生紙')

    await expect(
      resolvePending(storage, { ...pending, invoiceKey: 'K' }, {
        categoryId: null,
        remember: false,
        hitRuleIds: [tissue.id],
      }),
    ).rejects.toBeInstanceOf(StorageConflictError)

    expect((await ruleFor('衛生紙')).hitCount).toBe(tissue.hitCount)
  })

  it('learnItemRule 只學規則、不動紀錄，pattern 是正規化後的品名', async () => {
    await createFromText(storage, '某店 甲甲 乙乙 100', NOW)
    const before = await only()

    const rule = await learnItemRule(storage, [{ name: 'ＡＡ' }, { name: '乙乙' }], 0, 'fun')

    expect(rule).toMatchObject({ type: 'itemKeyword', pattern: 'AA', categoryId: 'fun' })
    expect(await only()).toEqual(before)
  })

  it('learnItemRule 遇到同名規則回傳更新後的規則', async () => {
    await learnItemRule(storage, [{ name: '甲甲' }], 0, 'fun')

    const rule = await learnItemRule(storage, [{ name: '甲甲' }], 0, 'daily')

    expect(rule).toMatchObject({ pattern: '甲甲', categoryId: 'daily' })
  })

  it('learnItemRule 沒有品項可學時回傳 null', async () => {
    const count = (await storage.getAll<Rule>('rules')).length

    expect(await learnItemRule(storage, [{ name: '甲甲' }], 5, 'fun')).toBeNull()
    expect(await storage.getAll<Rule>('rules')).toHaveLength(count)
  })
})
