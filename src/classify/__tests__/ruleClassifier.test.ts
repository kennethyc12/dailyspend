import { describe, expect, it } from 'vitest'
import type { Rule, RuleOrigin, RuleType } from '@/models/types'
import { classifyWithRules, CONFIDENCE, RuleClassifier } from '../ruleClassifier'
import { basePriority, compareRules, majority, resolve, ruleMatches } from '../matching'
import { builtinRules } from '../builtinRules'

let seq = 0

function rule(
  type: RuleType,
  pattern: string,
  categoryId: string,
  over: Partial<Rule> = {},
): Rule {
  const origin: RuleOrigin = over.origin ?? 'builtin'
  return {
    id: over.id ?? `r${seq++}`,
    type,
    pattern,
    matchMode: 'contains',
    categoryId,
    priority: basePriority(type, origin),
    origin,
    isActive: true,
    hitCount: 0,
    lastHitAt: null,
    createdAt: seq,
    updatedAt: seq,
    ...over,
  }
}

const BASE = [
  rule('itemKeyword', '咖啡', 'drink'),
  rule('itemKeyword', '拿鐵', 'drink'),
  rule('itemKeyword', '衛生紙', 'daily'),
  rule('itemKeyword', '便當', 'food'),
  rule('merchant', 'Netflix', 'subscription'),
]

describe('§6.1 五條分支', () => {
  it('items 全部命中且同一類別 → 0.95', () => {
    const out = classifyWithRules({ merchant: '星巴克', items: [{ name: '咖啡' }, { name: '拿鐵' }] }, BASE)
    expect(out.categoryId).toBe('drink')
    expect(out.classifyConfidence).toBe(CONFIDENCE.allItemsSameCategory)
    expect(out.pendingReasons).toEqual([])
  })

  it('items 部分命中 → 多數決 0.7', () => {
    const out = classifyWithRules(
      { merchant: '全聯', items: [{ name: '咖啡' }, { name: '拿鐵' }, { name: '不明物' }] },
      BASE,
    )
    expect(out.categoryId).toBe('drink')
    expect(out.classifyConfidence).toBe(CONFIDENCE.partialItems)
    expect(out.itemCategoryIds).toEqual(['drink', 'drink', null])
  })

  it('items 無命中但 merchant 命中單一類別 → 0.8', () => {
    const out = classifyWithRules({ merchant: 'Netflix', items: [] }, BASE)
    expect(out.categoryId).toBe('subscription')
    expect(out.classifyConfidence).toBe(CONFIDENCE.merchantOnly)
  })

  it('merchant 命中多類別且 items 為空 → ambiguous_merchant', () => {
    const rules = [
      ...BASE,
      rule('merchant', '蝦皮', 'daily'),
      rule('merchant', '蝦皮', 'fun'),
    ]
    const out = classifyWithRules({ merchant: '蝦皮', items: [] }, rules)
    expect(out.categoryId).toBeNull()
    expect(out.pendingReasons).toContain('ambiguous_merchant')
  })

  it('全無命中 → no_category_match', () => {
    const out = classifyWithRules({ merchant: '某間店', items: [{ name: '某樣東西' }] }, BASE)
    expect(out.categoryId).toBeNull()
    expect(out.pendingReasons).toEqual(['no_category_match'])
  })
})

describe('§6.1 五條分支之外的縫隙', () => {
  it('全部命中但類別分歧 → 視同部分命中，走多數決 0.7', () => {
    const out = classifyWithRules(
      { merchant: '全聯', items: [{ name: '咖啡' }, { name: '拿鐵' }, { name: '衛生紙' }] },
      BASE,
    )
    expect(out.categoryId).toBe('drink')
    expect(out.classifyConfidence).toBe(CONFIDENCE.partialItems)
  })

  it('品項命中時完全不看店家（品項優先於店家）', () => {
    const rules = [...BASE, rule('merchant', '星巴克', 'food')]
    const out = classifyWithRules({ merchant: '星巴克', items: [{ name: '咖啡' }] }, rules)
    expect(out.categoryId).toBe('drink')
  })

  it('merchant 為 null 時不當機', () => {
    const out = classifyWithRules({ merchant: null, items: [] }, BASE)
    expect(out.categoryId).toBeNull()
    expect(out.pendingReasons).toEqual(['no_category_match'])
  })

  it('低於 pendingBelow 門檻時加記 low_confidence', () => {
    const out = classifyWithRules({ merchant: 'Netflix', items: [] }, BASE, 0.9)
    expect(out.categoryId).toBe('subscription')
    expect(out.pendingReasons).toContain('low_confidence')
  })
})

describe('規則優先序', () => {
  it('基準值符合 §3.4', () => {
    expect(basePriority('itemKeyword', 'userCorrection')).toBe(400)
    expect(basePriority('itemKeyword', 'builtin')).toBe(300)
    expect(basePriority('merchant', 'userCorrection')).toBe(200)
    expect(basePriority('merchant', 'builtin')).toBe(100)
  })

  it('使用者修正蓋過內建規則', () => {
    const rules = [
      rule('itemKeyword', '咖啡', 'drink'),
      rule('itemKeyword', '咖啡', 'food', { origin: 'userCorrection' }),
    ]
    expect(resolve(rules, 'itemKeyword', '咖啡').categoryId).toBe('food')
  })

  it('使用者修正過的店家不會被內建規則拖成 ambiguous', () => {
    const rules = [
      rule('merchant', '蝦皮', 'daily'),
      rule('merchant', '蝦皮', 'fun', { origin: 'userCorrection' }),
    ]
    const r = resolve(rules, 'merchant', '蝦皮')
    expect(r.ambiguous).toBe(false)
    expect(r.categoryId).toBe('fun')
  })

  it('同優先層再比 pattern 長度（長者較具體）', () => {
    const rules = [
      rule('itemKeyword', '茶', 'drink'),
      rule('itemKeyword', '茶葉蛋', 'food'),
    ]
    expect(resolve(rules, 'itemKeyword', '茶葉蛋').categoryId).toBe('food')
  })

  it('compareRules 依 priority → 長度 → createdAt 排序', () => {
    const a = rule('itemKeyword', 'aa', 'x', { origin: 'userCorrection', createdAt: 1 })
    const b = rule('itemKeyword', 'aa', 'y', { createdAt: 2 })
    const c = rule('itemKeyword', 'aaa', 'z', { createdAt: 3 })
    expect([b, c, a].sort(compareRules).map((r) => r.categoryId)).toEqual(['x', 'z', 'y'])
  })
})

describe('規則比對', () => {
  it('停用的規則不命中', () => {
    const r = rule('itemKeyword', '咖啡', 'drink', { isActive: false })
    expect(ruleMatches(r, '咖啡')).toBe(false)
  })

  it('contains / exact / regex', () => {
    expect(ruleMatches(rule('itemKeyword', '咖啡', 'x'), '冰咖啡')).toBe(true)
    expect(ruleMatches(rule('itemKeyword', '咖啡', 'x', { matchMode: 'exact' }), '冰咖啡')).toBe(false)
    expect(ruleMatches(rule('itemKeyword', '^冰', 'x', { matchMode: 'regex' }), '冰咖啡')).toBe(true)
  })

  it('壞掉的 regex 視為不命中，不讓整次分類爆掉', () => {
    expect(ruleMatches(rule('itemKeyword', '[', 'x', { matchMode: 'regex' }), '任何東西')).toBe(false)
  })

  it('比對不分大小寫與全半形', () => {
    expect(ruleMatches(rule('merchant', 'Netflix', 'x'), 'NETFLIX')).toBe(true)
    expect(ruleMatches(rule('itemKeyword', '55', 'x'), '５５')).toBe(true)
  })
})

describe('多數決', () => {
  it('取出現次數最多的類別', () => {
    expect(
      majority([
        { categoryId: 'a', priority: 300 },
        { categoryId: 'a', priority: 300 },
        { categoryId: 'b', priority: 300 },
      ]),
    ).toBe('a')
  })

  it('平手時由最高優先的規則決定', () => {
    expect(
      majority([
        { categoryId: 'a', priority: 300 },
        { categoryId: 'b', priority: 400 },
      ]),
    ).toBe('b')
  })

  it('空輸入回 null', () => {
    expect(majority([])).toBeNull()
  })
})

describe('內建規則', () => {
  it('不含超商與量販店（§3.3）', () => {
    const merchants = builtinRules()
      .filter((r) => r.type === 'merchant')
      .map((r) => r.pattern)
    for (const m of ['7-11', '全家', '萊爾富', 'OK超商', '全聯', '家樂福', '大潤發']) {
      expect(merchants).not.toContain(m)
    }
  })

  it('全家買咖啡進飲料，全家沒打品項則進待確認', () => {
    const rules = builtinRules()
    expect(classifyWithRules({ merchant: '全家', items: [{ name: '咖啡' }] }, rules).categoryId).toBe(
      'drink',
    )

    const noItems = classifyWithRules({ merchant: '全家', items: [] }, rules)
    expect(noItems.categoryId).toBeNull()
    expect(noItems.pendingReasons).toEqual(['no_category_match'])
  })

  it('id 穩定，重新產生不會變動', () => {
    expect(builtinRules(1).map((r) => r.id)).toEqual(builtinRules(2).map((r) => r.id))
  })
})

describe('RuleClassifier', () => {
  it('實作 ClassifierPort，source 為 rule', async () => {
    const c = new RuleClassifier(() => BASE)
    expect(c.source).toBe('rule')
    const out = await c.classify({ merchant: 'Netflix', items: [] })
    expect(out.source).toBe('rule')
    expect(out.categoryId).toBe('subscription')
    expect(out.matchedRuleIds).toHaveLength(1)
  })
})
