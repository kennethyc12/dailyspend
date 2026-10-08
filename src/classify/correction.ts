import type { Rule, RuleType } from '@/models/types'
import { basePriority } from './matching'
import { normalizeInput } from '@/parsing/quickInput'

export type CorrectionScope = { kind: 'record' } | { kind: 'item'; index: number }

export interface CorrectionInput {
  merchant: string | null
  items: { name: string }[]
  targetCategoryId: string
  scope: CorrectionScope
  /** 多品項改整筆時，使用者在「要記住嗎？」面板按了「略過」。 */
  skipPerItem?: boolean
  existingRules: Rule[]
  now?: number
}

export type CorrectionPlan =
  | { kind: 'create'; rule: Rule }
  | { kind: 'update'; ruleId: string; categoryId: string; updatedAt: number }
  /** 多品項改整筆：不自動學，交回 UI 讓使用者逐項指定（§6.2）。 */
  | { kind: 'needs_per_item'; itemNames: string[] }
  | { kind: 'none'; why: 'no_pattern' }

function findExisting(rules: Rule[], type: RuleType, pattern: string): Rule | undefined {
  const p = normalizeInput(pattern).toLowerCase()
  return rules.find((r) => r.type === type && normalizeInput(r.pattern).toLowerCase() === p)
}

function planRule(
  input: CorrectionInput,
  type: RuleType,
  pattern: string,
  now: number,
): CorrectionPlan {
  if (!normalizeInput(pattern)) return { kind: 'none', why: 'no_pattern' }

  const existing = findExisting(input.existingRules, type, pattern)
  if (existing) {
    return {
      kind: 'update',
      ruleId: existing.id,
      categoryId: input.targetCategoryId,
      updatedAt: now,
    }
  }

  return {
    kind: 'create',
    rule: {
      id: crypto.randomUUID(),
      type,
      pattern: normalizeInput(pattern),
      matchMode: 'contains',
      categoryId: input.targetCategoryId,
      priority: basePriority(type, 'userCorrection'),
      origin: 'userCorrection',
      isActive: true,
      hitCount: 0,
      lastHitAt: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

/**
 * §6.2 的四種情境。回傳的是「計畫」而非直接寫入，讓呼叫端能在
 * transaction 外決定要不要套用、並支援 undo。
 */
export function planCorrection(input: CorrectionInput): CorrectionPlan {
  const now = input.now ?? Date.now()

  if (input.scope.kind === 'item') {
    const item = input.items[input.scope.index]
    if (!item) return { kind: 'none', why: 'no_pattern' }
    return planRule(input, 'itemKeyword', item.name, now)
  }

  if (input.items.length === 0) {
    return input.merchant
      ? planRule(input, 'merchant', input.merchant, now)
      : { kind: 'none', why: 'no_pattern' }
  }

  if (input.items.length === 1) {
    return planRule(input, 'itemKeyword', input.items[0]!.name, now)
  }

  // 多品項改整筆：不自動建 itemKeyword 規則。一筆 [雞胸, 衛生紙] 被改成
  // 「飲食」時，自動學習會得出「衛生紙 → 飲食」這條錯規則。
  if (!input.skipPerItem) {
    return { kind: 'needs_per_item', itemNames: input.items.map((i) => i.name) }
  }

  return input.merchant
    ? planRule(input, 'merchant', input.merchant, now)
    : { kind: 'none', why: 'no_pattern' }
}
