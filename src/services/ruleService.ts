import type { Rule, RuleOrigin, RuleType } from '@/models/types'
import type { StoragePort, Tx } from '@/storage'
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
  await storage.transaction(['rules'], (tx) => bumpHits(tx, ruleIds, now))
}

/** transaction 內累加命中次數。同一個 id 出現 n 次就加 n（匯入時跨紀錄的重複命中照次數算）。 */
export async function bumpHits(tx: Tx, ruleIds: string[], now: number): Promise<void> {
  const counts = new Map<string, number>()
  for (const id of ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, n] of counts) {
    const rule = await tx.get<Rule>('rules', id)
    if (rule) await tx.put('rules', { ...rule, hitCount: rule.hitCount + n, lastHitAt: now })
  }
}

/** transaction 內套用修正計畫。確認並記住（B4.2a）要和紀錄在同一個 transaction 寫入。 */
export async function writeCorrection(tx: Tx, plan: CorrectionPlan): Promise<Rule | null> {
  if (plan.kind === 'create') {
    await tx.put('rules', plan.rule)
    return plan.rule
  }
  if (plan.kind === 'update') {
    const rule = await tx.get<Rule>('rules', plan.ruleId)
    if (!rule) return null
    const next: Rule = { ...rule, categoryId: plan.categoryId, updatedAt: plan.updatedAt }
    await tx.put('rules', next)
    return next
  }
  return null
}

export function applyCorrection(storage: StoragePort, plan: CorrectionPlan): Promise<Rule | null> {
  return storage.transaction(['rules'], (tx) => writeCorrection(tx, plan))
}
