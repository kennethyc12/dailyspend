/**
 * 判別一段 QR payload 是不是合規的電子發票二維條碼，並拆出左方 QR 的固定表頭。
 *
 * 規格（財政部《電子發票證明聯一維及二維條碼規格說明》）：
 * 左方 QR 前 77 碼是定長欄位、**不含分隔符**，77 碼之後才用 `:` 分隔；
 * 右方 QR 固定以 `**` 起始，放左方放不下的品項。
 *
 * 這裡只做**結構判別**，不驗證號碼格式是否存在、也不計算 invoiceKey——
 * design.md §7.1 已經決定號碼不做嚴格驗證（拿假設去阻斷去重的代價更高）。
 */
export const LEFT_HEADER_LENGTH = 77

export const RIGHT_PREFIX = '**'

export type PayloadKind = 'left' | 'right' | 'unknown'

export interface LeftHeader {
  invoiceNumber: string
  /** 西元 `YYYY-MM-DD`。規格給的是民國年三碼。 */
  date: string
  randomCode: string
  salesAmount: number
  totalAmount: number
  buyerBan: string
  sellerBan: string
  encrypted: string
}

export interface ClassifiedPayload {
  kind: PayloadKind
  /** 判成這樣的理由，直接顯示在 /qr-lab，讓拍到怪東西時一眼看得出問題在哪。 */
  reason: string
  header: LeftHeader | null
  /** 表頭（或 `**`）之後、以 `:` 分隔的欄位。 */
  segments: string[]
}

const INVOICE_NUMBER = /^[A-Z]{2}\d{8}$/
const ROC_DATE = /^\d{7}$/

function splitSegments(rest: string): string[] {
  if (rest === '') return []
  // 開頭那個 `:` 是分隔符不是空欄位，去掉才不會多出一個空字串。
  return (rest.startsWith(':') ? rest.slice(1) : rest).split(':')
}

function rocToIso(roc: string): string | null {
  const year = Number(roc.slice(0, 3))
  const month = roc.slice(3, 5)
  const day = roc.slice(5, 7)
  if (!Number.isInteger(year) || year <= 0) return null
  if (Number(month) < 1 || Number(month) > 12) return null
  if (Number(day) < 1 || Number(day) > 31) return null
  return `${year + 1911}-${month}-${day}`
}

function parseHeader(text: string): { header: LeftHeader; reason: string } | { reason: string } {
  const invoiceNumber = text.slice(0, 10)
  const roc = text.slice(10, 17)

  if (!INVOICE_NUMBER.test(invoiceNumber)) {
    return { reason: `前 10 碼「${invoiceNumber}」不是「兩個大寫英文 + 8 位數字」的發票字軌` }
  }
  if (!ROC_DATE.test(roc)) {
    return { reason: `第 11–17 碼「${roc}」不是 7 位數字的民國年月日` }
  }

  const date = rocToIso(roc)
  if (date === null) return { reason: `民國日期「${roc}」的月或日超出範圍` }

  return {
    reason: '前 77 碼符合左方 QR 的定長表頭',
    header: {
      invoiceNumber,
      date,
      randomCode: text.slice(17, 21),
      salesAmount: parseInt(text.slice(21, 29), 16),
      totalAmount: parseInt(text.slice(29, 37), 16),
      buyerBan: text.slice(37, 45),
      sellerBan: text.slice(45, 53),
      encrypted: text.slice(53, 77),
    },
  }
}

export function classifyPayload(text: string): ClassifiedPayload {
  if (text.startsWith(RIGHT_PREFIX)) {
    const rest = text.slice(RIGHT_PREFIX.length)
    const segments = splitSegments(rest)
    // 右 QR 只有 `**` 加一堆填充時，品項其實沒上傳到條碼裡，要讓人看得出來。
    const padded = rest.length > 0 && /^\*+$/.test(rest)
    return {
      kind: 'right',
      reason: padded
        ? `以 ** 起始，但後面 ${rest.length} 個字元全是填充星號，沒有品項內容`
        : '以 ** 起始，是右方 QR',
      header: null,
      segments: padded ? [] : segments,
    }
  }

  if (text.length < LEFT_HEADER_LENGTH) {
    return {
      kind: 'unknown',
      reason: `只有 ${text.length} 字，左方 QR 光表頭就要 ${LEFT_HEADER_LENGTH} 字，右方 QR 要以 ** 起始`,
      header: null,
      segments: splitSegments(text),
    }
  }

  const parsed = parseHeader(text.slice(0, LEFT_HEADER_LENGTH))
  if (!('header' in parsed)) {
    return { kind: 'unknown', reason: parsed.reason, header: null, segments: [] }
  }

  return {
    kind: 'left',
    reason: parsed.reason,
    header: parsed.header,
    segments: splitSegments(text.slice(LEFT_HEADER_LENGTH)),
  }
}
