export type CategorySource = 'rule' | 'user' | 'ai'
export type RecordStatus = 'confirmed' | 'pending'
export type SourceType = 'manual' | 'photo' | 'carrier'

export type PendingReason =
  | 'no_category_match'
  | 'ambiguous_merchant'
  | 'low_confidence'
  | 'recognition_failed'
  | 'amount_mismatch'
  | 'duplicate_conflict'
  | 'ambiguous_item_tokens'
  | 'multi_item_correction'
  | 'missing_merchant'

export interface RecordItem {
  name: string
  qty: number
  unitPrice: number | null
  amount: number | null
  categoryId: string | null
}

export interface SpendRecord {
  id: string
  date: string
  merchant: string
  amount: number
  items: RecordItem[]
  categoryId: string | null
  categorySource: CategorySource
  classifyConfidence: number
  recognizeConfidence: number | null
  status: RecordStatus
  pendingReasons: PendingReason[]
  invoiceNumber: string | null
  invoicePeriod: string | null
  invoiceKey: string | null
  invoiceRandomCode: string | null
  sourceType: SourceType
  photoId: string | null
  rawRecognition: unknown | null
  note: string
  createdAt: number
  updatedAt: number
}

export interface Category {
  id: string
  name: string
  parentId: string | null
  icon: string
  color: string
  isBuiltin: boolean
  isActive: boolean
  sortOrder: number
  updatedAt: number
}

export type RuleType = 'itemKeyword' | 'merchant'
export type MatchMode = 'contains' | 'exact' | 'regex'
export type RuleOrigin = 'builtin' | 'userCorrection'

export interface Rule {
  id: string
  type: RuleType
  pattern: string
  matchMode: MatchMode
  categoryId: string
  priority: number
  origin: RuleOrigin
  /** builtin 規則不可刪除，只能停用（§6.3）。 */
  isActive: boolean
  hitCount: number
  lastHitAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Photo {
  id: string
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
  bytes: number
  capturedAt: number
}

export interface Settings {
  key: 'settings'
  defaults: { date: 'today'; categoryFallback: string | null; qty: number }
  parsing: { amountPosition: 'last'; merchantDictEnabled: boolean }
  thresholds: {
    smallFrequent: { windowDays: number; smallAmount: number; minCount: number }
    subscription: { minMonths: number; amountVariancePct: number; maxMonthlyOccurrences: number }
    monthGrowth: { growthPct: number; minDelta: number; minDaysThisMonth: number }
    repeatPurchase: { windowDays: number; minRepeat: number; similarity: 'exact' }
    suggestion: { topN: number }
  }
  confidence: { pendingBelow: number }
  export: { delimiter: string; encoding: string }
  backup: { remindAfterDays: number; lastBackupAt: number | null }
  platform: { persistGranted: boolean | null }
  updatedAt: number
}
