import type { PendingReason, Photo, RecordItem, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'
import type { RecognizedInvoice } from '@/recognize/einvoicePayload'
import { isValidIsoDate } from '@/analysis/dates'
import { classify } from './entryService'
import { recordHits } from './ruleService'
import { saveRecord, type SaveOutcome } from './recordService'

export interface InvoiceEntryInput {
  recognized: RecognizedInvoice
  /** 發票沒有店家欄位（只有賣方統編），所以店家一律由使用者填。 */
  merchant: string
  /** QR 沒有總計額時由使用者輸入；有總計額時忽略，以總計額為準（§5.4、D2c）。 */
  amount: number | null
  /** QR 沒有表頭時由使用者填；有表頭時忽略，以 QR 的日期為準（它決定 invoiceKey）。 */
  date?: string | null
  photo?: Photo
}

export type InvoiceBlocked = 'amount_missing' | 'amount_invalid' | 'date_missing' | 'date_invalid'

export type InvoiceEntryResult =
  | { ok: false; blocked: InvoiceBlocked }
  | { ok: true; save: SaveOutcome; usedInvoiceAmount: boolean }

/**
 * §5.3 的照片路徑：QR 解析完才進到這裡，寫入前的所有前處理都已結束（§2.2）。
 *
 * 與文字路徑的差別只在欄位來源，去重、分類、合併全部共用同一條路。
 */
export async function createFromInvoice(
  storage: StoragePort,
  input: InvoiceEntryInput,
  now = Date.now(),
): Promise<InvoiceEntryResult> {
  const { recognized, photo } = input

  // 有總計額就以它為準，不收手輸金額（§5.4、D2c）
  const amount = recognized.totalAmount ?? input.amount
  if (amount === null) return { ok: false, blocked: 'amount_missing' }
  if (!Number.isInteger(amount) || amount < 0) return { ok: false, blocked: 'amount_invalid' }

  // 沒有表頭時不再預設今天：日期是使用者要照發票填的資料
  const date = recognized.date ?? input.date ?? null
  if (date === null || date === '') return { ok: false, blocked: 'date_missing' }
  if (!isValidIsoDate(date)) return { ok: false, blocked: 'date_invalid' }

  const merchant = input.merchant.trim()
  const classified = await classify(storage, {
    merchant: merchant || null,
    items: recognized.items,
  })

  const items: RecordItem[] = recognized.items.map((item, i) => ({
    name: item.name,
    qty: item.qty,
    // 品項那欄不寫進 unitPrice/amount（design.md §5.3）：沒有總計額時核對不了品項是否齊全。
    // 原始數字留在 rawRecognition，政策改變時可以回填。
    unitPrice: null,
    amount: null,
    categoryId: classified.itemCategoryIds[i] ?? null,
  }))

  const reasons = new Set<PendingReason>(classified.pendingReasons)
  if (!merchant) reasons.add('missing_merchant')
  // 只有沒有表頭也沒有品項才算辨識失敗；有表頭沒品項時用表頭的欄位（§5.4、D2b）
  if (recognized.confidence === 0) reasons.add('recognition_failed')

  const pendingReasons = [...reasons]

  const record: SpendRecord = {
    id: crypto.randomUUID(),
    date,
    merchant,
    amount,
    items,
    categoryId: classified.categoryId,
    categorySource: 'rule',
    classifyConfidence: classified.classifyConfidence,
    recognizeConfidence: recognized.confidence,
    status: pendingReasons.length > 0 ? 'pending' : 'confirmed',
    pendingReasons,
    invoiceNumber: recognized.invoiceNumber,
    invoicePeriod: null,
    invoiceKey: null,
    invoiceRandomCode: recognized.randomCode,
    // §5.2.1：QR 真的解出欄位了才改成 'photo'，這會提升 §7.3 的 merge 優先序。
    sourceType: recognized.confidence > 0 ? 'photo' : 'manual',
    photoId: photo?.id ?? null,
    // 品項的原始數字原樣留著，政策改變時可以回填（design.md §5.3）。
    rawRecognition: recognized,
    note: '',
    createdAt: now,
    updatedAt: now,
  }

  const save = await saveRecord(storage, record, { now, photo })
  await recordHits(storage, classified.matchedRuleIds, now)

  return { ok: true, save, usedInvoiceAmount: recognized.totalAmount !== null }
}
