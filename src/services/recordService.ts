import type { PendingReason, Photo, SpendRecord } from '@/models/types'
import { StorageConflictError, type StoragePort } from '@/storage'
import { buildInvoiceKey } from '@/dedupe/invoiceKey'
import { mergeRecords } from '@/dedupe/merge'

/**
 * 補齊 derived 欄位。`invoiceKey` 只能由 `buildInvoiceKey()` 產生，
 * 所有寫入路徑都必須先經過這裡。
 */
export function prepareRecord(input: SpendRecord): SpendRecord {
  const { invoicePeriod, invoiceKey } = buildInvoiceKey(input.date, input.invoiceNumber)
  const reasons = new Set<PendingReason>(input.pendingReasons)

  // 有號碼卻推不出年期（日期缺或壞）→ 這張發票無法參與去重，請使用者補日期。
  if (input.invoiceNumber && !invoicePeriod) reasons.add('missing_invoice_date')

  const pendingReasons = [...reasons]
  return {
    ...input,
    invoicePeriod,
    invoiceKey,
    pendingReasons,
    status: pendingReasons.length > 0 ? 'pending' : input.status,
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

async function mergeInto(
  storage: StoragePort,
  existing: SpendRecord,
  incoming: SpendRecord,
  opts: SaveOptions,
): Promise<SaveOutcome> {
  const merged = mergeRecords(existing, incoming, opts.now ?? Date.now())
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
 * §7.2 的寫入判斷。載具匯入日後走同一條路徑，「匯入去重筆數為 0」
 * 由這段程式保證。
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
