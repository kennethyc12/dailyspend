import type { Rule, RuleOrigin, RuleType } from '@/models/types'
import type { StoragePort } from '@/storage'
import { builtinRules } from '@/classify/builtinRules'
import { compareRules } from '@/classify/matching'
import type { CorrectionPlan } from '@/classify/correction'

export class BuiltinRuleDeleteError extends Error {
  constructor(readonly ruleId: string) {
    super('內建規則不可刪除，只能停用')
    this.name = 'BuiltinRuleDeleteError'
  }
}

export async function seedBuiltinRules(storage: StoragePort, now = Date.now()): Promise<number> {
  const existing = await storage.getAll<Rule>('rules')
  if (existing.some((r) => r.origin === 'builtin')) return 0

  const rules = builtinRules(now)
  await storage.transaction(['rules'], async (tx) => {
    for (const r of rules) await tx.put('rules', r)
  })
  return rules.length
}

export interface RuleFilter {
  type?: RuleType
  origin?: RuleOrigin
  activeOnly?: boolean
}

export async function listRules(storage: StoragePort, filter: RuleFilter = {}): Promise<Rule[]> {
  const all = await storage.getAll<Rule>('rules')
  return all
    .filter(
      (r) =>
        (filter.type === undefined || r.type === filter.type) &&
        (filter.origin === undefined || r.origin === filter.origin) &&
        (filter.activeOnly !== true || r.isActive),
    )
    .sort(compareRules)
}

export function loadActiveRules(storage: StoragePort): Promise<Rule[]> {
  return listRules(storage, { activeOnly: true })
}

export async function setRuleActive(
  storage: StoragePort,
  ruleId: string,
  isActive: boolean,
  now = Date.now(),
): Promise<void> {
  const rule = await storage.get<Rule>('rules', ruleId)
  if (!rule) return
  await storage.put('rules', { ...rule, isActive, updatedAt: now })
}

/** §6.3：只有 userCorrection 可刪，builtin 請用 setRuleActive(false)。 */
export async function deleteRule(storage: StoragePort, ruleId: string): Promise<void> {
  const rule = await storage.get<Rule>('rules', ruleId)
  if (!rule) return
  if (rule.origin === 'builtin') throw new BuiltinRuleDeleteError(ruleId)
  await storage.delete('rules', ruleId)
}

/**
 * 分類完成後累計命中次數。刻意與 classify 分開：classify 必須是純函式，
 * 才能在 transaction 之外安全呼叫（§2.2）。
 */
export async function recordHits(
  storage: StoragePort,
  ruleIds: string[],
  now = Date.now(),
): Promise<void> {
  if (ruleIds.length === 0) return
  const rules = await Promise.all(ruleIds.map((id) => storage.get<Rule>('rules', id)))
  const found = rules.filter((r): r is Rule => r !== undefined)
  if (found.length === 0) return

  await storage.transaction(['rules'], async (tx) => {
    for (const r of found) {
      await tx.put('rules', { ...r, hitCount: r.hitCount + 1, lastHitAt: now })
    }
  })
}

export async function applyCorrection(
  storage: StoragePort,
  plan: CorrectionPlan,
): Promise<Rule | null> {
  if (plan.kind === 'create') {
    await storage.put('rules', plan.rule)
    return plan.rule
  }
  if (plan.kind === 'update') {
    const rule = await storage.get<Rule>('rules', plan.ruleId)
    if (!rule) return null
    const next: Rule = { ...rule, categoryId: plan.categoryId, updatedAt: plan.updatedAt }
    await storage.put('rules', next)
    return next
  }
  return null
}
