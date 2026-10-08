import type { Rule, RuleOrigin, RuleType } from '@/models/types'
import { normalizeInput } from '@/parsing/quickInput'

export function basePriority(type: RuleType, origin: RuleOrigin): number {
  if (type === 'itemKeyword') return origin === 'userCorrection' ? 400 : 300
  return origin === 'userCorrection' ? 200 : 100
}

function norm(s: string): string {
  return normalizeInput(s).toLowerCase()
}

export function ruleMatches(rule: Rule, text: string): boolean {
  if (!rule.isActive) return false
  const target = norm(text)
  const pattern = norm(rule.pattern)
  if (!target || !pattern) return false

  switch (rule.matchMode) {
    case 'exact':
      return target === pattern
    case 'contains':
      return target.includes(pattern)
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(text)
      } catch {
        // 壞掉的 regex 規則視為不命中，而不是讓整次分類爆掉。
        return false
      }
  }
}

/** §3.4：priority 高者優先 → pattern 長者優先 → createdAt 新者優先。 */
export function compareRules(a: Rule, b: Rule): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length
  return b.createdAt - a.createdAt
}

export interface Resolution {
  categoryId: string | null
  matchedRuleIds: string[]
  /** 最高優先層內仍有多個類別彼此衝突。 */
  ambiguous: boolean
}

const NO_MATCH: Resolution = { categoryId: null, matchedRuleIds: [], ambiguous: false }

/**
 * 取出命中的最高優先層。只有當同一層內出現兩個以上不同類別時才算 ambiguous——
 * 若直接拿「所有命中規則的類別數」判斷，使用者修正過的規則（priority 較高）
 * 會永遠被內建規則拖成 ambiguous，§6.2 的「修正即成規則」就形同失效。
 */
export function resolve(rules: Rule[], type: RuleType, text: string): Resolution {
  const hits = rules.filter((r) => r.type === type && ruleMatches(r, text)).sort(compareRules)
  if (hits.length === 0) return NO_MATCH

  const top = hits[0]!
  const topTier = hits.filter(
    (r) => r.priority === top.priority && r.pattern.length === top.pattern.length,
  )
  const categories = new Set(topTier.map((r) => r.categoryId))

  if (categories.size > 1) {
    return { categoryId: null, matchedRuleIds: topTier.map((r) => r.id), ambiguous: true }
  }
  return { categoryId: top.categoryId, matchedRuleIds: [top.id], ambiguous: false }
}

/** 多數決；平手時由最高優先的命中規則決定，保持確定性。 */
export function majority(picks: Array<{ categoryId: string; priority: number }>): string | null {
  if (picks.length === 0) return null

  const counts = new Map<string, number>()
  for (const p of picks) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1)

  let best: string | null = null
  let bestCount = -1
  for (const [categoryId, count] of counts) {
    if (count > bestCount) {
      best = categoryId
      bestCount = count
      continue
    }
    if (count === bestCount && best !== null) {
      const topOf = (id: string) =>
        Math.max(...picks.filter((p) => p.categoryId === id).map((p) => p.priority))
      if (topOf(categoryId) > topOf(best)) best = categoryId
    }
  }
  return best
}
