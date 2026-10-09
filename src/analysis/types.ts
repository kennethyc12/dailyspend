export type FindingKind = 'smallFrequent' | 'subscription' | 'monthGrowth' | 'repeatPurchase'

export const KIND_LABEL: Record<FindingKind, string> = {
  smallFrequent: '高頻小額',
  subscription: '訂閱與固定支出',
  monthGrowth: '月對月暴增',
  repeatPurchase: '同類重複購買',
}

/** §8 要求每條結論都附得出具體依據，所以 recordIds 不得為空。 */
export interface Evidence {
  recordIds: string[]
  itemNames?: string[]
}

export interface Finding {
  kind: FindingKind
  title: string
  detail: string
  /** 每月等值金額（整數元）。不同性質的支出靠它才能互相比較（§8.3）。 */
  monthlyEquivalent: number
  /** 金額是推算出來的（例如用單據總額平均分攤到品項），UI 要顯示「約」。 */
  estimated: boolean
  evidence: Evidence
}

export interface InsufficientData {
  kind: FindingKind
  message: string
}

export interface AnalysisResult {
  findings: Finding[]
  /** 依 monthlyEquivalent 取前 topN 條。 */
  suggestions: Finding[]
  insufficient: InsufficientData[]
  /** 規則型分析的已知限制，直接攤在 UI 上（§8.2）。 */
  caveats: string[]
  today: string
  generatedAt: number
}
