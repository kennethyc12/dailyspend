const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 台灣發票字軌按期（兩個月）配發：1–2月期=01、3–4月期=03…11–12月期=11。 */
export function periodStartMonth(month: number): number {
  return month % 2 === 0 ? month - 1 : month
}

export function rocYear(gregorianYear: number): number {
  return gregorianYear - 1911
}

/** `YYYY-MM-DD` → 民國年 + 期別起始月，例如 2026-10-05 → '11509'。 */
export function buildInvoicePeriod(date: string | null): string | null {
  if (!date) return null
  const m = ISO_DATE.exec(date)
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const roc = rocYear(year)
  if (roc < 1) return null

  return `${roc}${String(periodStartMonth(month)).padStart(2, '0')}`
}

export function normalizeInvoiceNumber(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[\s-]/g, '').toUpperCase()
  return cleaned || null
}

/**
 * 台灣電子發票號碼的標準格式是 2 個英文字母 + 8 位數字。
 *
 * 這只用於 UI 提示，**不用於擋下寫入**：QR 樣本還沒到手，現在就把非標準格式
 * 的號碼判定為無效，等於拿假設去阻斷去重。寧可收下再提示。
 */
export function isStandardInvoiceNumber(n: string | null): boolean {
  return n !== null && /^[A-Z]{2}\d{8}$/.test(n)
}

/**
 * 去重鍵。**這是唯一的產生點**——`invoiceKey` 是 unique index 的 key，
 * 必須與索引內容完全一致，不能有第二處算法。
 */
export function buildInvoiceKey(
  date: string | null,
  invoiceNumber: string | null,
): { invoicePeriod: string | null; invoiceKey: string | null } {
  const number = normalizeInvoiceNumber(invoiceNumber)
  const invoicePeriod = buildInvoicePeriod(date)

  return {
    invoicePeriod,
    invoiceKey: invoicePeriod && number ? `${invoicePeriod}-${number}` : null,
  }
}
