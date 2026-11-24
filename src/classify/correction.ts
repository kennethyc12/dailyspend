import type { Rule, RuleType } from '@/models/types'
import { basePriority, compareRules, ruleMatches } from './matching'
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

const COMPANY_MARKERS = ['股份有限公司', '有限公司']
const MIN_BRAND_LENGTH = 2

/**
 * 公司登記全名 → 品牌：載具 CSV 的店家帶分店字樣，用全名學到的規則換一家分店就不命中。
 * 取兩個字樣中最早出現的位置切掉（先找「有限公司」會留下「…股份」）。
 * 切完太短就用原字串：2 字品牌用 contains 可能誤命中別家公司的全名，這是已知限制（design §6.2）。
 */
export function toBrand(merchant: string): string {
  // 沒有字樣時 Math.min() 是 Infinity，slice 取整串，結果就是原字串
  const cut = Math.min(...COMPANY_MARKERS.map((m) => merchant.indexOf(m)).filter((i) => i >= 0))
  const brand = merchant.slice(0, cut).trim()
  return brand.length >= MIN_BRAND_LENGTH ? brand : merchant
}

/**
 * 已有使用者規則能命中這家店時更新它，而不是另建品牌規則：
 * 舊的全名規則 pattern 較長，比對時會贏過新的品牌規則（compareRules 依長度），新修正會被吃掉。
 * ruleMatches 不看 type，所以要自己篩 merchant。
 */
function planMerchantRule(input: CorrectionInput, merchant: string, now: number): CorrectionPlan {
  const hit = input.existingRules
    .filter((r) => r.type === 'merchant' && r.origin === 'userCorrection' && ruleMatches(r, merchant))
    .sort(compareRules)[0]
  if (hit) return { kind: 'update', ruleId: hit.id, categoryId: input.targetCategoryId, updatedAt: now }
  // 品牌可能剛好等於內建或停用規則的 pattern（例如內建的加油站品牌）：planRule 的 findExisting
  // 不看 origin／isActive，會改掉那條。只讓它看啟用中的使用者規則，否則另建一條。
  const own = input.existingRules.filter((r) => r.origin === 'userCorrection' && r.isActive)
  return planRule({ ...input, existingRules: own }, 'merchant', toBrand(merchant), now)
}

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
      ? planMerchantRule(input, input.merchant, now)
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
    ? planMerchantRule(input, input.merchant, now)
    : { kind: 'none', why: 'no_pattern' }
}
