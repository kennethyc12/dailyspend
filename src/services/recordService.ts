import type { PendingReason, Photo, SpendRecord } from '@/models/types'
import { StorageConflictError, type StoragePort } from '@/storage'
import { buildInvoiceKey } from '@/dedupe/invoiceKey'
import { mergeRecords, type MergeResult } from '@/dedupe/merge'

/**
 * 補齊 derived 欄位。`invoiceKey` 只能由 `buildInvoiceKey()` 產生。
 * 新增、編輯、改分類、合併都經過這裡；例外是「確認」（清空全部原因）
 * 與換照片（只動 `photoId`），理由見 B4.1。
 */
export function prepareRecord(input: SpendRecord): SpendRecord {
  const { invoicePeriod, invoiceKey } = buildInvoiceKey(input.date, input.invoiceNumber)
  const reasons = new Set<PendingReason>(input.pendingReasons)

  // 有號碼卻推不出年期（日期缺或壞）→ 這張發票無法參與去重，請使用者補日期。
  if (input.invoiceNumber && !invoicePeriod) reasons.add('missing_invoice_date')
  if (invoicePeriod) reasons.delete('missing_invoice_date')
  // 狀態型原因補好就解除。只解除、不在這裡加：使用者確認過「沒有店家」後，
  // 之後的編輯不該讓紀錄回到待確認（B4.1 Q1）。加原因留在新增的三個產生點。
  if (input.merchant.trim() !== '') reasons.delete('missing_merchant')

  const pendingReasons = [...reasons]
  return {
    ...input,
    invoicePeriod,
    invoiceKey,
    pendingReasons,
    status: pendingReasons.length > 0 ? 'pending' : 'confirmed',
  }
}

export interface SaveOptions {
  photo?: Photo
  now?: number
}

export interface SaveOutcome {
  action: 'insert' | 'merge'
  record: SpendRecord
  discardedPhotoId: string | null
  needsReclassify: boolean
  conflicts: string[]
}

async function write(
  storage: StoragePort,
  record: SpendRecord,
  photo: Photo | undefined,
): Promise<void> {
  // 照片與紀錄同一個 transaction，避免孤兒照片（§9）。
  // 這裡只做讀寫，所有前處理都在呼叫之前完成（§2.2）。
  if (!photo) {
    await storage.put('records', record)
    return
  }
  await storage.transaction(['records', 'photos'], async (tx) => {
    await tx.put('photos', photo)
    await tx.put('records', record)
  })
}

/**
 * 合併的唯一入口。`mergeRecords` 是 `...existing` 展開，不會重算 invoiceKey——
 * 手輸紀錄（key null）併進帶號碼的發票時，不重算的話下次匯入又會再比對一次。
 */
export function mergeForWrite(
  existing: SpendRecord,
  incoming: SpendRecord,
  now: number,
): MergeResult {
  const merged = mergeRecords(existing, incoming, now)
  return { ...merged, record: prepareRecord(merged.record) }
}

async function mergeInto(
  storage: StoragePort,
  existing: SpendRecord,
  incoming: SpendRecord,
  opts: SaveOptions,
): Promise<SaveOutcome> {
  const merged = mergeForWrite(existing, incoming, opts.now ?? Date.now())
  const photo = merged.discardedPhotoId ? undefined : opts.photo
  await write(storage, merged.record, photo)

  return {
    action: 'merge',
    record: merged.record,
    discardedPhotoId: merged.discardedPhotoId,
    needsReclassify: merged.needsReclassify,
    conflicts: merged.conflicts,
  }
}

/**
 * §7.2 的寫入判斷（手輸與 QR）。載具匯入為了單一 transaction 另有寫入路徑
 * （`carrierImportService.ts`），只共用 `mergeForWrite` 的合併規則；
 * 「匯入去重筆數為 0」由匯入自己的測試保證。
 */
export async function saveRecord(
  storage: StoragePort,
  input: SpendRecord,
  opts: SaveOptions = {},
): Promise<SaveOutcome> {
  const incoming = prepareRecord(input)

  const insert = async (): Promise<SaveOutcome> => {
    await write(storage, incoming, opts.photo)
    return {
      action: 'insert',
      record: incoming,
      discardedPhotoId: null,
      needsReclassify: false,
      conflicts: [],
    }
  }

  if (incoming.invoiceKey === null) return insert()

  const existing = await storage.getByIndex<SpendRecord>(
    'records',
    'by_invoiceKey',
    incoming.invoiceKey,
  )
  if (existing && existing.id !== incoming.id) {
    return mergeInto(storage, existing, incoming, opts)
  }

  try {
    return await insert()
  } catch (e) {
    if (!(e instanceof StorageConflictError)) throw e

    // 查詢與寫入分屬不同 transaction，中間有 race 的空間。unique index
    // 是最後防線：撞上就重讀一次再 merge（§7.2）。
    const latest = await storage.getByIndex<SpendRecord>(
      'records',
      'by_invoiceKey',
      incoming.invoiceKey,
    )
    if (!latest) throw e
    return mergeInto(storage, latest, incoming, opts)
  }
}
