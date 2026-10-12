import type { PendingReason } from '@/models/types'
import { isValidYmd, toIso } from '@/analysis/dates'

export interface ParsedItem {
  name: string
}

export type BlockingError = 'empty_input' | 'amount_missing' | 'invalid_date'

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

// 緊接在金額後的單位屬於金額：「全家 咖啡 55 元」很常見，不該變成叫「元」的品項。
const AMOUNT_UNIT = /^(?:元|塊)$/

export function normalizeInput(raw: string): string {
  return raw
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/\u3000/g, ' ') // 全形空白
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

export type DatePrefix = { kind: 'date'; iso: string } | { kind: 'invalid' } | null

/** 首 token 若是日期前綴就回傳解析結果；長得像日期但不存在（2/30）回傳 invalid；否則 null。 */
export function parseDatePrefix(token: string, today: string): DatePrefix {
  if (token === '今天') return { kind: 'date', iso: today }
  if (token === '昨天') return { kind: 'date', iso: shiftDays(today, -1) }

  const raw = MONTH_DAY.exec(token)
  if (!raw) return null

  const month = Number(raw[1] ?? raw[3])
  const day = Number(raw[2] ?? raw[4])
  if (month < 1 || month > 12) return { kind: 'invalid' }

  const year = Number(today.slice(0, 4))
  // 錢不會花在未來。10/08 輸入 12/25 指的是去年的消費。
  // 閏年要看回推之後的年份：2/29 合不合法取決於落在哪一年。
  const resolvedYear = toIso(year, month, day) > today ? year - 1 : year
  return isValidYmd(resolvedYear, month, day)
    ? { kind: 'date', iso: toIso(resolvedYear, month, day) }
    : { kind: 'invalid' }
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

  // 只有一個 token 時它是金額，不是日期：「1200」不該被讀成 12 月 00 日。
  const prefix = tokens.length > 1 ? parseDatePrefix(tokens[0]!, today) : null
  if (prefix?.kind === 'invalid') return { ...base, blockingError: 'invalid_date' }
  if (prefix?.kind === 'date') {
    base.date = prefix.iso
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
  let trailing = tokens.slice(amountIndex + 1)
  if (AMOUNT_UNIT.test(trailing[0] ?? '')) trailing = trailing.slice(1)

  // §4.3：中間的純數字 token 不得變成品項，移除並轉待確認。
  const kept = middle.filter((t) => parseNumberToken(t) === null)
  if (kept.length !== middle.length) pendingReasons.push('ambiguous_item_tokens')

  // amount 取的是最後一個數字 token，所以金額後面剩下的一定不是數字，不能默默丟掉。
  if (trailing.length > 0) pendingReasons.push('tokens_after_amount')

  base.items = [...kept, ...trailing].map((name) => ({ name }))
  base.pendingReasons = pendingReasons
  return base
}
