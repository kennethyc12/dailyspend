import type { Category, SpendRecord } from '@/models/types'
import { UNCATEGORIZED } from '@/models/labels'

export const CSV_COLUMNS = [
  'date',
  'merchant',
  'items',
  'amount',
  'category',
  'categorySource',
  'classifyConfidence',
  'status',
  'invoiceKey',
  'note',
] as const

const ITEM_SEPARATOR = ';'

function escapeCell(value: string, delimiter: string): string {
  const needsQuotes =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

// 店家、品名、備註來自外部（載具 CSV），enum 欄位可能來自手改的備份（還原不驗 enum 成員）；
// 開頭是這些字元時 Excel 會當公式執行（CSV injection）
const FORMULA_START = /^[=+\-@\t\r]/

function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

export interface CsvOptions {
  delimiter?: string
  categoryNames?: Map<string, string>
}

export function toCsv(records: SpendRecord[], opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ','
  const names = opts.categoryNames ?? new Map<string, string>()

  const rows = [CSV_COLUMNS.join(delimiter)]

  for (const r of records) {
    const category =
      r.categoryId === null ? UNCATEGORIZED : (names.get(r.categoryId) ?? r.categoryId)

    const cells = [
      r.date,
      neutralizeFormula(r.merchant),
      neutralizeFormula(r.items.map((i) => i.name).join(ITEM_SEPARATOR)),
      String(r.amount),
      neutralizeFormula(category),
      neutralizeFormula(r.categorySource),
      r.classifyConfidence.toFixed(2),
      neutralizeFormula(r.status),
      r.invoiceKey ?? '',
      neutralizeFormula(r.note),
    ]
    rows.push(cells.map((c) => escapeCell(c, delimiter)).join(delimiter))
  }

  return rows.join('\r\n')
}

export function categoryNameMap(categories: Category[]): Map<string, string> {
  return new Map(categories.map((c) => [c.id, c.name]))
}

/**
 * Excel 只有看到 BOM 才會用 UTF-8 開 CSV，否則中文全部變亂碼。
 * 這是匯出給人看的檔案，不是給程式讀的，所以 BOM 要加。
 */
export function csvBlob(csv: string): Blob {
  return new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], {
    type: 'text/csv;charset=utf-8',
  })
}
