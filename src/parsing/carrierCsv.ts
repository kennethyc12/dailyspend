import { isValidYmd } from '@/analysis/dates'

export const CARRIER_CSV_HEADER = [
  '消費時間',
  '發票號碼',
  '店家名稱',
  '賣方統編',
  '消費品項',
  '單價',
  '個數',
  '小計',
  '總計',
  '備註',
] as const

export interface CarrierItem {
  name: string
  qty: number
  /** CSV 的「小計」。可以是負數（折扣）或 0（套餐附餐）。 */
  amount: number
}

export interface CarrierInvoice {
  /** CSV 原值（只去頭尾空白）。正規化與 invoiceKey 由寫入路徑負責。 */
  invoiceNumber: string
  date: string
  merchant: string
  sellerTaxId: string
  /** 以「總計」為準；不等於品項加總是正常的（未稅、折扣沒列成品項）。 */
  total: number
  items: CarrierItem[]
  note: string
  /** 單價只存在這裡：它沒有讀取點，語意也不一致（單價 0、小計 -14）。 */
  rawRows: string[][]
}

export type CarrierRejectReason =
  | 'number_missing'
  | 'date_invalid'
  | 'rows_inconsistent'
  | 'total_missing'
  | 'total_zero'
  | 'total_invalid'
  | 'total_ambiguous'
  | 'subtotal_invalid'
  | 'qty_invalid'
  | 'item_name_missing'

export interface RejectedInvoice {
  invoiceNumber: string | null
  /** 檔案中的列號（表頭是第 1 列），讓使用者能回 App 對照。 */
  lines: number[]
  reason: CarrierRejectReason
}

export type CarrierCsvResult =
  | { ok: true; invoices: CarrierInvoice[]; rejected: RejectedInvoice[] }
  | { ok: false; reason: 'header_mismatch' | 'malformed'; line?: number }

export interface CsvRow {
  cells: string[]
  /** 這一列在檔案中的起始列號（1 起算）。引號內換行時，一列會跨多個實體列。 */
  line: number
}

/** 對外的契約是 parser 的 `malformed` 回傳值；這個 class 只在模組內傳遞列號。 */
export class CsvSyntaxError extends Error {
  constructor(readonly line: number) {
    super()
  }
}

/** RFC 4180：引號內可以有逗號、換行與 `""`。BOM 與 `\r` 在這裡去掉。 */
export function readCsv(text: string): CsvRow[] {
  const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text
  // 先統一換行，引號內的 `\r\n` 才不會把 `\r` 留在值裡。
  const src = withoutBom.replace(/\r\n?/g, '\n')
  const rows: CsvRow[] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let rowStartLine = 1

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }

    if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push({ cells: row, line: rowStartLine })
      row = []
      cell = ''
      line++
      rowStartLine = line
    } else {
      cell += ch
    }
  }

  if (quoted) throw new CsvSyntaxError(rowStartLine)
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push({ cells: row, line: rowStartLine })
  }

  return rows.filter((r) => !(r.cells.length === 1 && r.cells[0] === ''))
}

const INT = /^-?\d+$/
const NON_NEG_INT = /^\d+$/
const DECIMAL = /^\d+(\.\d+)?$/
// 樣本 220 列全部是這個格式；不接受沒出現過的變體，遇到再放寬。
const DATE_TIME = /^(\d{4})\/(\d{2})\/(\d{2}) \d{2}:\d{2}:\d{2}$/

const COL = {
  time: 0,
  number: 1,
  merchant: 2,
  seller: 3,
  item: 4,
  qty: 6,
  subtotal: 7,
  total: 8,
  note: 9,
} as const

interface InvoiceGroup {
  number: string
  rows: CsvRow[]
}

function cell(row: CsvRow, col: number): string {
  return (row.cells[col] ?? '').trim()
}

function sameHeader(cells: string[]): boolean {
  return (
    cells.length === CARRIER_CSV_HEADER.length &&
    CARRIER_CSV_HEADER.every((name, i) => cells[i]?.trim() === name)
  )
}

function groupByNumber(body: CsvRow[]): { groups: InvoiceGroup[]; numberMissing: CsvRow[] } {
  const map = new Map<string, CsvRow[]>()
  const numberMissing: CsvRow[] = []
  for (const row of body) {
    const number = cell(row, COL.number)
    if (!number) {
      numberMissing.push(row)
      continue
    }
    const rows = map.get(number)
    if (rows) rows.push(row)
    else map.set(number, [row])
  }
  return { groups: [...map].map(([number, rows]) => ({ number, rows })), numberMissing }
}

function toIsoDate(raw: string): string | null {
  const m = DATE_TIME.exec(raw)
  if (!m) return null
  const [, y = '', mo = '', d = ''] = m
  return isValidYmd(Number(y), Number(mo), Number(d)) ? `${y}-${mo}-${d}` : null
}

function toInvoice({ number, rows }: InvoiceGroup): CarrierInvoice | RejectedInvoice {
  const lines = rows.map((r) => r.line)
  const reject = (reason: CarrierRejectReason): RejectedInvoice => ({
    invoiceNumber: number,
    lines,
    reason,
  })

  const first = rows[0]!
  // 同一張發票的表頭欄位每列重複；對不上代表不是同一張（或跨年度同號碼），不替資料選邊。
  const consistent = rows.every((r) =>
    [COL.time, COL.merchant, COL.seller].every((col) => cell(r, col) === cell(first, col)),
  )
  if (!consistent) return reject('rows_inconsistent')

  const date = toIsoDate(cell(first, COL.time))
  if (!date) return reject('date_invalid')

  const totals = rows.map((r) => cell(r, COL.total)).filter((v) => v !== '')
  if (totals.length === 0) return reject('total_missing')
  if (totals.length > 1) return reject('total_ambiguous')
  if (!NON_NEG_INT.test(totals[0]!)) return reject('total_invalid')
  const total = Number(totals[0])
  // 記成 0 與沒有記載同等對待（B0.1），也不拿小計加總頂替。
  if (total === 0) return reject('total_zero')

  const items: CarrierItem[] = []
  for (const r of rows) {
    const name = cell(r, COL.item)
    const qty = cell(r, COL.qty)
    const subtotal = cell(r, COL.subtotal)
    if (!name) return reject('item_name_missing')
    if (!DECIMAL.test(qty)) return reject('qty_invalid')
    if (!INT.test(subtotal)) return reject('subtotal_invalid')
    items.push({ name, qty: Number(qty), amount: Number(subtotal) })
  }

  const notes = [...new Set(rows.map((r) => cell(r, COL.note)).filter(Boolean))]

  return {
    invoiceNumber: number,
    date,
    merchant: cell(first, COL.merchant),
    sellerTaxId: cell(first, COL.seller),
    total,
    items,
    note: notes.join('\n'),
    rawRows: rows.map((r) => r.cells),
  }
}

export function parseCarrierCsv(text: string): CarrierCsvResult {
  let rows: CsvRow[]
  try {
    rows = readCsv(text)
  } catch (e) {
    if (e instanceof CsvSyntaxError) return { ok: false, reason: 'malformed', line: e.line }
    throw e
  }

  const [header, ...body] = rows
  if (!header || !sameHeader(header.cells)) return { ok: false, reason: 'header_mismatch' }

  // 欄數不對時欄位可能錯位，連「這列屬於哪張發票」都不可信，整份擋下。
  const broken = body.find((r) => r.cells.length !== CARRIER_CSV_HEADER.length)
  if (broken) return { ok: false, reason: 'malformed', line: broken.line }

  const invoices: CarrierInvoice[] = []
  const rejected: RejectedInvoice[] = []
  const { groups, numberMissing } = groupByNumber(body)

  // 沒有號碼就無法判斷屬於哪一張，只能逐列拒收。
  for (const r of numberMissing) {
    rejected.push({ invoiceNumber: null, lines: [r.line], reason: 'number_missing' })
  }
  for (const group of groups) {
    const result = toInvoice(group)
    if ('reason' in result) rejected.push(result)
    else invoices.push(result)
  }

  return { ok: true, invoices, rejected }
}
