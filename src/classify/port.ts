import type { CategorySource, PendingReason } from '@/models/types'

export interface ClassifyInput {
  merchant: string | null
  items: { name: string }[]
}

export interface ClassifyOutput {
  categoryId: string | null
  /** 與 input.items 等長，未命中為 null。 */
  itemCategoryIds: (string | null)[]
  classifyConfidence: number
  source: Exclude<CategorySource, 'user'>
  matchedRuleIds: string[]
  /** §6.1 步驟 3–4 產生；§2.3 原本沒列，但上層需要它決定 status。 */
  pendingReasons: PendingReason[]
}

export interface ClassifierPort {
  readonly source: Exclude<CategorySource, 'user'>
  classify(input: ClassifyInput): Promise<ClassifyOutput>
}
