import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Rule } from '@/models/types'
import { planCorrection, toBrand } from '../correction'
import { basePriority } from '../matching'
import { builtinRules } from '../builtinRules'
import { IndexedDbAdapter } from '@/storage'
import {
  applyCorrection,
  BuiltinRuleDeleteError,
  deleteRule,
  listRules,
  loadActiveRules,
  recordHits,
  seedBuiltinRules,
  setRuleActive,
} from '@/services/ruleService'
import { classifyWithRules } from '../ruleClassifier'

const NOW = 1_760_000_000_000

function existing(pattern: string, categoryId: string, type: Rule['type'] = 'itemKeyword'): Rule {
  return {
    id: 'existing-1',
    type,
    pattern,
    matchMode: 'contains',
    categoryId,
    priority: basePriority(type, 'userCorrection'),
    origin: 'userCorrection',
    isActive: true,
    hitCount: 3,
    lastHitAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('§6.2 四種情境', () => {
  it('items 為空 → 建 merchant 規則', () => {
    const plan = planCorrection({
      merchant: '蝦皮',
      items: [],
      targetCategoryId: 'fun',
      scope: { kind: 'record' },
      existingRules: [],
      now: NOW,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.rule.type).toBe('merchant')
    expect(plan.rule.pattern).toBe('蝦皮')
    expect(plan.rule.priority).toBe(200)
    expect(plan.rule.origin).toBe('userCorrection')
  })

  it('單一品項 → 建 itemKeyword 規則', () => {
    const plan = planCorrection({
      merchant: '全家',
      items: [{ name: '拿鐵' }],
      targetCategoryId: 'drink',
      scope: { kind: 'record' },
      existingRules: [],
      now: NOW,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.rule.type).toBe('itemKeyword')
    expect(plan.rule.pattern).toBe('拿鐵')
    expect(plan.rule.priority).toBe(400)
  })

  it('多品項改整筆 → 不自動學，交回 UI 逐項指定', () => {
    const plan = planCorrection({
      merchant: '全聯',
      items: [{ name: '雞胸' }, { name: '衛生紙' }],
      targetCategoryId: 'food',
      scope: { kind: 'record' },
      existingRules: [],
      now: NOW,
    })
    expect(plan).toEqual({ kind: 'needs_per_item', itemNames: ['雞胸', '衛生紙'] })
  })

  it('多品項改整筆且選「略過」→ 只建 merchant 規則，不教錯品項', () => {
    const plan = planCorrection({
      merchant: '全聯',
      items: [{ name: '雞胸' }, { name: '衛生紙' }],
      targetCategoryId: 'food',
      scope: { kind: 'record' },
      skipPerItem: true,
      existingRules: [],
      now: NOW,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.rule.type).toBe('merchant')
    expect(plan.rule.pattern).toBe('全聯')
    // 關鍵：絕不能學到「衛生紙 → 飲食」。
    expect(plan.rule.pattern).not.toBe('衛生紙')
  })

  it('多品項改單一品項 → 直接為該品項建規則', () => {
    const plan = planCorrection({
      merchant: '全聯',
      items: [{ name: '雞胸' }, { name: '衛生紙' }],
      targetCategoryId: 'daily',
      scope: { kind: 'item', index: 1 },
      existingRules: [],
      now: NOW,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return
    expect(plan.rule.pattern).toBe('衛生紙')
    expect(plan.rule.categoryId).toBe('daily')
  })
})

describe('§6.2 共同行為', () => {
  it('已存在同 pattern + type 的規則 → 更新而非新增', () => {
    const plan = planCorrection({
      merchant: '全家',
      items: [{ name: '拿鐵' }],
      targetCategoryId: 'food',
      scope: { kind: 'record' },
      existingRules: [existing('拿鐵', 'drink')],
      now: NOW + 1,
    })
    expect(plan).toEqual({
      kind: 'update',
      ruleId: 'existing-1',
      categoryId: 'food',
      updatedAt: NOW + 1,
    })
  })

  it('同 pattern 但不同 type 視為不同規則', () => {
    const plan = planCorrection({
      merchant: '拿鐵',
      items: [],
      targetCategoryId: 'drink',
      scope: { kind: 'record' },
      existingRules: [existing('拿鐵', 'drink', 'itemKeyword')],
      now: NOW,
    })
    expect(plan.kind).toBe('create')
  })

  it('空白 pattern 不建規則', () => {
    expect(
      planCorrection({
        merchant: '   ',
        items: [],
        targetCategoryId: 'x',
        scope: { kind: 'record' },
        existingRules: [],
      }),
    ).toEqual({ kind: 'none', why: 'no_pattern' })
  })

  it('item index 超出範圍不當機', () => {
    expect(
      planCorrection({
        merchant: '全聯',
        items: [{ name: '雞胸' }],
        targetCategoryId: 'x',
        scope: { kind: 'item', index: 9 },
        existingRules: [],
      }),
    ).toEqual({ kind: 'none', why: 'no_pattern' })
  })
})

describe('修正後立刻生效', () => {
  it('把「衛生紙」改成日用品後，下一筆同品項就分對', () => {
    const rules = builtinRules(NOW).filter((r) => r.pattern !== '衛生紙')
    const before = classifyWithRules({ merchant: '全聯', items: [{ name: '衛生紙' }] }, rules)
    expect(before.categoryId).toBeNull()

    const plan = planCorrection({
      merchant: '全聯',
      items: [{ name: '衛生紙' }],
      targetCategoryId: 'daily',
      scope: { kind: 'record' },
      existingRules: rules,
      now: NOW,
    })
    expect(plan.kind).toBe('create')
    if (plan.kind !== 'create') return

    const after = classifyWithRules({ merchant: '全聯', items: [{ name: '衛生紙' }] }, [
      ...rules,
      plan.rule,
    ])
    expect(after.categoryId).toBe('daily')
  })
})

describe('ruleService', () => {
  let storage: IndexedDbAdapter

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    storage = new IndexedDbAdapter()
  })

  it('seed 內建規則，重複呼叫不重複寫入', async () => {
    const n = await seedBuiltinRules(storage, NOW)
    expect(n).toBeGreaterThan(0)
    expect(await seedBuiltinRules(storage, NOW)).toBe(0)
    expect(await storage.count('rules')).toBe(n)
  })

  it('依 type / origin / active 篩選', async () => {
    await seedBuiltinRules(storage, NOW)
    expect((await listRules(storage, { type: 'merchant' })).every((r) => r.type === 'merchant')).toBe(
      true,
    )
    expect(await listRules(storage, { origin: 'userCorrection' })).toEqual([])
  })

  it('builtin 不可刪除，只能停用', async () => {
    await seedBuiltinRules(storage, NOW)
    const [first] = await listRules(storage, { origin: 'builtin' })
    await expect(deleteRule(storage, first!.id)).rejects.toBeInstanceOf(BuiltinRuleDeleteError)

    await setRuleActive(storage, first!.id, false)
    const active = await loadActiveRules(storage)
    expect(active.find((r) => r.id === first!.id)).toBeUndefined()
    expect(await storage.get<Rule>('rules', first!.id)).toBeDefined()
  })

  it('userCorrection 可刪除', async () => {
    const plan = planCorrection({
      merchant: '蝦皮',
      items: [],
      targetCategoryId: 'fun',
      scope: { kind: 'record' },
      existingRules: [],
      now: NOW,
    })
    if (plan.kind !== 'create') throw new Error('expected create')

    await applyCorrection(storage, plan)
    expect(await storage.count('rules')).toBe(1)
    await deleteRule(storage, plan.rule.id)
    expect(await storage.count('rules')).toBe(0)
  })

  it('applyCorrection 的 update 會改到既有規則', async () => {
    const r = existing('拿鐵', 'drink')
    await storage.put('rules', r)
    await applyCorrection(storage, {
      kind: 'update',
      ruleId: r.id,
      categoryId: 'food',
      updatedAt: NOW + 5,
    })
    const after = await storage.get<Rule>('rules', r.id)
    expect(after?.categoryId).toBe('food')
    expect(after?.updatedAt).toBe(NOW + 5)
    expect(await storage.count('rules')).toBe(1)
  })

  it('recordHits 累計命中次數', async () => {
    await seedBuiltinRules(storage, NOW)
    const rules = await loadActiveRules(storage)
    const target = rules.find((r) => r.pattern === '咖啡')!

    await recordHits(storage, [target.id], NOW + 1)
    await recordHits(storage, [target.id], NOW + 2)

    const after = await storage.get<Rule>('rules', target.id)
    expect(after?.hitCount).toBe(2)
    expect(after?.lastHitAt).toBe(NOW + 2)
  })

  it('recordHits 遇到不存在的 id 不當機', async () => {
    await expect(recordHits(storage, ['nope'])).resolves.toBeUndefined()
  })
})

describe('店家規則學品牌（rule-pattern）', () => {
  // repo 是公開的：店名一律虛構，形狀和載具 CSV 的公司登記全名相同
  const NORTH = '測試超商股份有限公司北區第一分公司'
  const SOUTH = '測試超商股份有限公司南區第二分公司'

  describe('toBrand', () => {
    it.each([
      ['股份有限公司與分店字樣', NORTH, '測試超商'],
      ['有限公司', '星河咖啡有限公司', '星河咖啡'],
      ['兩個字樣都在時取最早的位置', '示範股份有限公司', '示範'],
      ['不含字樣：商行', '範例商行', '範例商行'],
      ['不含字樣：手輸店家', '全家', '全家'],
      ['不含字樣：英文公司', 'Acme Trading Inc.', 'Acme Trading Inc.'],
      ['切完只剩 1 字用原字串', '甲股份有限公司', '甲股份有限公司'],
      ['切完 2 字可以', '甲乙有限公司', '甲乙'],
      ['字樣在開頭', '有限公司某某', '有限公司某某'],
      ['含「有限」不含「有限公司」', '示範有限責任合作社', '示範有限責任合作社'],
      ['字樣前有空白', '測試超商 股份有限公司北區分公司', '測試超商'],
      ['空白之後只剩 1 字', '甲 股份有限公司', '甲 股份有限公司'],
    ])('%s', (_label, merchant, brand) => {
      expect(toBrand(merchant)).toBe(brand)
    })
  })

  function plan(merchant: string, existingRules: Rule[], items: { name: string }[] = [], skipPerItem = false) {
    return planCorrection({
      merchant,
      items,
      targetCategoryId: 'daily',
      scope: { kind: 'record' },
      skipPerItem,
      existingRules,
      now: NOW,
    })
  }

  it('0 品項：建品牌 merchant 規則', () => {
    const p = plan(NORTH, [])
    expect(p.kind === 'create' && p.rule.pattern).toBe('測試超商')
  })

  it('多品項略過逐項：建品牌 merchant 規則', () => {
    const p = plan(NORTH, [], [{ name: '甲' }, { name: '乙' }], true)
    expect(p.kind === 'create' && p.rule.pattern).toBe('測試超商')
  })

  it('品牌規則已存在，第二家分店修正 → 更新同一條', () => {
    const brandRule = existing('測試超商', 'drink', 'merchant')
    expect(plan(SOUTH, [brandRule])).toMatchObject({ kind: 'update', ruleId: brandRule.id, categoryId: 'daily' })
  })

  it('舊全名規則命中這家分店，再修正 → 更新舊規則，不另建品牌規則', () => {
    const old = existing(NORTH, 'drink', 'merchant')
    expect(plan(NORTH, [old])).toMatchObject({ kind: 'update', ruleId: old.id })
  })

  it('全名與品牌兩條都命中 → 更新比對時會贏的較長那條', () => {
    const brandRule = { ...existing('測試超商', 'fun', 'merchant'), id: 'brand' }
    const fullRule = { ...existing(NORTH, 'drink', 'merchant'), id: 'full' }
    expect(plan(NORTH, [brandRule, fullRule])).toMatchObject({ kind: 'update', ruleId: 'full' })
  })

  it('停用的舊全名規則不算命中，改建品牌規則', () => {
    const off = { ...existing(NORTH, 'drink', 'merchant'), isActive: false }
    const p = plan(NORTH, [off])
    expect(p.kind === 'create' && p.rule.pattern).toBe('測試超商')
  })

  it('內建 merchant 規則命中不被更新，改建使用者規則', () => {
    const builtin = { ...existing(NORTH, 'drink', 'merchant'), origin: 'builtin' as const }
    const p = plan(NORTH, [builtin])
    expect(p.kind === 'create' && p.rule.pattern).toBe('測試超商')
  })

  it('別家店的使用者店家規則不被當成命中', () => {
    const other = existing('另一家店', 'drink', 'merchant')
    expect(plan(NORTH, [other])).toMatchObject({ kind: 'create', rule: { pattern: '測試超商' } })
  })

  it('品牌剛好等於內建規則的 pattern：不改內建規則，另建使用者規則', () => {
    const builtin = { ...existing('測試超商', 'drink', 'merchant'), origin: 'builtin' as const }
    expect(plan(NORTH, [builtin])).toMatchObject({
      kind: 'create',
      rule: { pattern: '測試超商', origin: 'userCorrection' },
    })
  })

  it('品牌剛好等於停用規則的 pattern：不改停用規則，另建一條', () => {
    const off = { ...existing('測試超商', 'drink', 'merchant'), isActive: false }
    expect(plan(NORTH, [off])).toMatchObject({ kind: 'create', rule: { pattern: '測試超商' } })
  })

  it('品項規則不受影響：品名含「有限公司」原樣學', () => {
    const p = plan(NORTH, [], [{ name: '示範有限公司禮盒' }])
    expect(p.kind === 'create' && p.rule).toMatchObject({ type: 'itemKeyword', pattern: '示範有限公司禮盒' })
  })

  it('品項規則的 pattern 剛好是店名的子字串：不被當成店家規則更新', () => {
    const item = existing('測試超商', 'drink', 'itemKeyword')
    const p = plan(NORTH, [item])
    expect(p.kind === 'create' && p.rule).toMatchObject({ type: 'merchant', pattern: '測試超商' })
  })

  it('學了一家分店之後，另一家分店自動分到同一類', () => {
    const p = plan(NORTH, [])
    if (p.kind !== 'create') throw new Error('應該建新規則')
    const out = classifyWithRules({ merchant: SOUTH, items: [] }, [p.rule])
    expect(out.categoryId).toBe('daily')
  })
})
