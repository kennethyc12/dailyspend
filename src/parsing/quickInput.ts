import type { PendingReason } from '@/models/types'

export interface ParsedItem {
  name: string
}

export type BlockingError = 'empty_input' | 'amount_missing'

export interface QuickInputParse {
  merchant: string | null
  merchantMatched: boolean
  items: ParsedItem[]
  amount: number | null
  date: string
  dateExplicit: boolean
  pendingReasons: PendingReason[]
  blockingError: BlockingError | null
  /** 原始輸入原樣保留：§4.3 的待確認畫面要顯示它，讓使用者自己拆。 */
  raw: string
}

export interface ParseOptions {
  /** 預設今天。格式 YYYY-MM-DD。 */
  today?: string
  /** 歷史紀錄 + 內建常見店家，用來設定 merchantMatched。 */
  merchantDict?: Iterable<string>
}

const FULLWIDTH_OFFSET = 0xfee0

// 允許 55、1,200、55元、$55、NT$55，以及小數。
const NUMBER_TOKEN = /^(?:NT\$|\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?元?$/

export function normalizeInput(raw: string): string {
  return raw
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/　/g, ' ')
    .trim()
}

export function parseNumberToken(token: string): number | null {
  const m = NUMBER_TOKEN.exec(token)
  if (!m) return null
  const value = Number(`${m[1]!.replace(/,/g, '')}${m[2] ?? ''}`)
  if (!Number.isFinite(value)) return null
  // amount 在 schema 上是整數元（§3.1）。小數在這裡就收斂掉，否則
  // 它會逃過 §4.3 的純數字檢查，變成一個叫「55.5」的品項。
  return Math.round(value)
}

export function todayIso(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return dt.toISOString().slice(0, 10)
}

// 照 §4.1 的字面規格：斜線形式允許單位數（10/3），破折號形式要求補零兩位（09-28）。
// 這個不對稱是刻意的——「7-11」是店家，不是 7 月 11 日，而它是台灣最常見的店家之一。
const MONTH_DAY = /^(?:(\d{1,2})\/(\d{1,2})|(\d{2})-(\d{2}))$/

/** 首 token 若是日期前綴就回傳解析結果，否則回傳 null。 */
export function parseDatePrefix(token: string, today: string): string | null {
  if (token === '今天') return today
  if (token === '昨天') return shiftDays(today, -1)

  const raw = MONTH_DAY.exec(token)
  if (!raw) return null
  const m = [raw[0], raw[1] ?? raw[3], raw[2] ?? raw[4]]

  const month = Number(m[1])
  const day = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const year = Number(today.slice(0, 4))
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  // 錢不會花在未來。10/08 輸入 12/25 指的是去年的消費。
  return candidate > today
    ? `${year - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : candidate
}

export function parseQuickInput(raw: string, opts: ParseOptions = {}): QuickInputParse {
  const today = opts.today ?? todayIso()
  const dict = new Set(Array.from(opts.merchantDict ?? [], (s) => normalizeInput(s).toLowerCase()))

  const base: QuickInputParse = {
    merchant: null,
    merchantMatched: false,
    items: [],
    amount: null,
    date: today,
    dateExplicit: false,
    pendingReasons: [],
    blockingError: null,
    raw,
  }

  const normalized = normalizeInput(raw)
  if (!normalized) return { ...base, blockingError: 'empty_input' }

  const tokens = normalized.split(/\s+/)
  let cursor = 0

  const prefixDate = parseDatePrefix(tokens[0]!, today)
  // 只有一個 token 時它是金額，不是日期：「1200」不該被讀成 12 月 00 日。
  if (prefixDate && tokens.length > 1) {
    base.date = prefixDate
    base.dateExplicit = true
    cursor = 1
  }

  let amountIndex = -1
  for (let i = tokens.length - 1; i >= cursor; i--) {
    if (parseNumberToken(tokens[i]!) !== null) {
      amountIndex = i
      break
    }
  }
  if (amountIndex === -1) return { ...base, blockingError: 'amount_missing' }

  base.amount = parseNumberToken(tokens[amountIndex]!)

  const pendingReasons: PendingReason[] = []

  if (amountIndex > cursor) {
    base.merchant = tokens[cursor]!
    base.merchantMatched = dict.has(base.merchant.toLowerCase())
  } else {
    pendingReasons.push('missing_merchant')
  }

  const middle = base.merchant === null ? [] : tokens.slice(cursor + 1, amountIndex)

  // §4.3：中間的純數字 token 不得變成品項，移除並轉待確認。
  const kept = middle.filter((t) => parseNumberToken(t) === null)
  if (kept.length !== middle.length) pendingReasons.push('ambiguous_item_tokens')

  base.items = kept.map((name) => ({ name }))
  base.pendingReasons = pendingReasons
  return base
}
