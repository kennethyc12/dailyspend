import type { PendingReason, SpendRecord } from '@/models/types'

export type MergeSource = 'user' | 'carrier' | 'qr' | 'manual'

const RANK: Record<MergeSource, number> = { user: 4, carrier: 3, qr: 2, manual: 1 }

/**
 * §7.3 的來源優先序。`user` 只適用於 `categoryId`——我們沒有逐欄位的編輯
 * 紀錄，`categorySource === 'user'` 只證明類別被改過，不證明日期或金額被改過。
 * 其餘欄位一律用 sourceType 比較。
 */
export function sourceOf(record: SpendRecord): Exclude<MergeSource, 'user'> {
  if (record.sourceType === 'carrier') return 'carrier'
  if (record.sourceType === 'photo') return 'qr'
  return 'manual'
}

export interface MergeResult {
  record: SpendRecord
  /** 兩筆都有照片時，新的那張不寫入；UI 要提示使用者。 */
  discardedPhotoId: string | null
  /** 既有分類不是使用者設的，合併後的內容變了 → 上層要重跑分類。 */
  needsReclassify: boolean
  /** 欄位名清單，供 UI 標出哪幾格有衝突。 */
  conflicts: string[]
}

function pickScalar<K extends 'date' | 'amount' | 'invoiceNumber'>(
  key: K,
  existing: SpendRecord,
  incoming: SpendRecord,
  existingRank: number,
  incomingRank: number,
  conflicts: string[],
): SpendRecord[K] {
  const a = existing[key]
  const b = incoming[key]

  if (b === null || b === undefined) return a
  if (a === null || a === undefined) return b
  if (a === b) return a

  // §7.3 第一列自相矛盾（「取高優先來源」vs「保留既有」）。定案：取高優先
  // 來源，但一律記下衝突——載具資料比手輸可信，可是數字對不上這件事
  // 不該被無聲吞掉。同優先層時保留既有，避免後來者隨意覆蓋。
  conflicts.push(key)
  return incomingRank > existingRank ? b : a
}

function mergeNotes(a: string, b: string): string {
  const parts = [a.trim(), b.trim()].filter(Boolean)
  return [...new Set(parts)].join('\n')
}

export function mergeRecords(
  existing: SpendRecord,
  incoming: SpendRecord,
  now = Date.now(),
): MergeResult {
  const existingRank = RANK[sourceOf(existing)]
  const incomingRank = RANK[sourceOf(incoming)]
  const conflicts: string[] = []

  const date = pickScalar('date', existing, incoming, existingRank, incomingRank, conflicts)
  const amount = pickScalar('amount', existing, incoming, existingRank, incomingRank, conflicts)
  const invoiceNumber = pickScalar(
    'invoiceNumber',
    existing,
    incoming,
    existingRank,
    incomingRank,
    conflicts,
  )

  // 項數較多的那份勝；相同取高優先來源。
  const items =
    incoming.items.length > existing.items.length
      ? incoming.items
      : incoming.items.length === existing.items.length && incomingRank > existingRank
        ? incoming.items
        : existing.items

  const keepUserCategory = existing.categorySource === 'user'
  const itemsChanged = items !== existing.items
  const needsReclassify = !keepUserCategory && itemsChanged

  let discardedPhotoId: string | null = null
  let photoId = existing.photoId
  if (existing.photoId === null) {
    photoId = incoming.photoId
  } else if (incoming.photoId !== null && incoming.photoId !== existing.photoId) {
    discardedPhotoId = incoming.photoId
  }

  const pendingReasons = new Set<PendingReason>([
    ...existing.pendingReasons,
    ...incoming.pendingReasons,
  ])
  if (conflicts.length > 0) pendingReasons.add('duplicate_conflict')

  const reasons = [...pendingReasons]

  const record: SpendRecord = {
    ...existing,
    date,
    amount,
    invoiceNumber,
    items,
    merchant: existing.merchant || incoming.merchant,
    invoicePeriod: existing.invoicePeriod ?? incoming.invoicePeriod,
    invoiceRandomCode: existing.invoiceRandomCode ?? incoming.invoiceRandomCode,
    categoryId: keepUserCategory ? existing.categoryId : (existing.categoryId ?? incoming.categoryId),
    categorySource: keepUserCategory ? 'user' : existing.categorySource,
    recognizeConfidence: Math.max(
      existing.recognizeConfidence ?? -1,
      incoming.recognizeConfidence ?? -1,
    ) < 0
      ? null
      : Math.max(existing.recognizeConfidence ?? 0, incoming.recognizeConfidence ?? 0),
    // 載具來源比照片可信，升級 sourceType 讓之後的合併有正確的優先序。
    sourceType: incomingRank > existingRank ? incoming.sourceType : existing.sourceType,
    photoId,
    rawRecognition: existing.rawRecognition ?? incoming.rawRecognition,
    note: mergeNotes(existing.note, incoming.note),
    pendingReasons: reasons,
    status: reasons.length > 0 ? 'pending' : existing.status,
    updatedAt: now,
  }

  return { record, discardedPhotoId, needsReclassify, conflicts }
}
