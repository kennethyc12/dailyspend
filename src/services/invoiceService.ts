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
  /** QR 沒有總計額時由使用者輸入；有總計額時這裡傳 null 代表採信發票。 */
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

  // §5.4：手輸金額與 QR 金額不一致時預設採信 QR，但兩個都要留下來。
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
    // 規格的「單價」欄語意未定（單價或小計），寫進任一欄都是猜。
    // 原始數字留在 rawRecognition，確認語意之後再回填。
    unitPrice: null,
    amount: null,
    categoryId: classified.itemCategoryIds[i] ?? null,
  }))

  const reasons = new Set<PendingReason>(classified.pendingReasons)
  if (!merchant) reasons.add('missing_merchant')
  if (recognized.items.length === 0) reasons.add('recognition_failed')

  const mismatched =
    recognized.totalAmount !== null &&
    input.amount !== null &&
    input.amount !== recognized.totalAmount
  if (mismatched) reasons.add('amount_mismatch')

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
    // 語意未定的欄位（品項的單價/小計）原樣留著，日後確認後可回填。
    rawRecognition: recognized,
    note: '',
    createdAt: now,
    updatedAt: now,
  }

  const save = await saveRecord(storage, record, { now, photo })
  await recordHits(storage, classified.matchedRuleIds, now)

  return { ok: true, save, usedInvoiceAmount: recognized.totalAmount !== null }
}
