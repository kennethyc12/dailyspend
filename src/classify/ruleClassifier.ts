import type { PendingReason, Rule } from '@/models/types'
import type { ClassifierPort, ClassifyInput, ClassifyOutput } from './port'
import { majority, resolve } from './matching'

export const CONFIDENCE = {
  allItemsSameCategory: 0.95,
  merchantOnly: 0.8,
  partialItems: 0.7,
} as const

export class RuleClassifier implements ClassifierPort {
  readonly source = 'rule' as const

  constructor(
    private readonly loadRules: () => Promise<Rule[]> | Rule[],
    private readonly pendingBelow = 0.6,
  ) {}

  async classify(input: ClassifyInput): Promise<ClassifyOutput> {
    const rules = await this.loadRules()
    return classifyWithRules(input, rules, this.pendingBelow)
  }
}

export function classifyWithRules(
  input: ClassifyInput,
  rules: Rule[],
  pendingBelow = 0.6,
): ClassifyOutput {
  const byId = new Map(rules.map((r) => [r.id, r]))
  const matchedRuleIds = new Set<string>()
  const pendingReasons: PendingReason[] = []

  // 步驟 1：品項先跑，這就是「品項優先於店家」的實作位置（§3.4 註記）。
  const itemResolutions = input.items.map((item) => resolve(rules, 'itemKeyword', item.name))
  const itemCategoryIds = itemResolutions.map((r) => r.categoryId)
  for (const r of itemResolutions) for (const id of r.matchedRuleIds) matchedRuleIds.add(id)

  // 步驟 2：店家
  const merchantRes = input.merchant
    ? resolve(rules, 'merchant', input.merchant)
    : { categoryId: null, matchedRuleIds: [], ambiguous: false }

  // 步驟 3
  const matchedItems = itemResolutions.filter((r) => r.categoryId !== null)
  const hasItems = input.items.length > 0

  let categoryId: string | null = null
  let classifyConfidence = 0

  if (hasItems && matchedItems.length > 0) {
    const picks = matchedItems.map((r) => ({
      categoryId: r.categoryId!,
      priority: byId.get(r.matchedRuleIds[0]!)?.priority ?? 0,
    }))
    const distinct = new Set(picks.map((p) => p.categoryId))
    const allMatched = matchedItems.length === input.items.length

    // 全部命中且同一類別才給 0.95。全部命中但類別分歧（§6.1 五條分支之間的
    // 縫隙）視同部分命中，走多數決 0.7——分歧本身就是信心不足的訊號。
    if (allMatched && distinct.size === 1) {
      categoryId = picks[0]!.categoryId
      classifyConfidence = CONFIDENCE.allItemsSameCategory
    } else {
      categoryId = majority(picks)
      classifyConfidence = CONFIDENCE.partialItems
    }
  } else if (merchantRes.ambiguous) {
    for (const id of merchantRes.matchedRuleIds) matchedRuleIds.add(id)
    pendingReasons.push('ambiguous_merchant')
  } else if (merchantRes.categoryId !== null) {
    for (const id of merchantRes.matchedRuleIds) matchedRuleIds.add(id)
    categoryId = merchantRes.categoryId
    classifyConfidence = CONFIDENCE.merchantOnly
  } else {
    pendingReasons.push('no_category_match')
  }

  // 步驟 4
  if (categoryId !== null && classifyConfidence < pendingBelow) {
    pendingReasons.push('low_confidence')
  }

  return {
    categoryId,
    itemCategoryIds,
    classifyConfidence,
    source: 'rule',
    matchedRuleIds: [...matchedRuleIds],
    pendingReasons,
  }
}
