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

/**
 * 左方 QR 的 77 碼表頭之後，依規格依序是：營業人自行使用區、本條碼記載完整
 * 品目筆數、該張發票交易品目總筆數、中文編碼參數，四個欄位之後才是品項。
 */
const LEFT_META_SEGMENTS = 4

/** 中文編碼參數：0 = UTF-8，1 = Big5。 */
const ENCODING_LABEL: Record<string, string> = { '0': 'UTF-8', '1': 'Big5' }

export interface RecognizedItem {
  name: string
  qty: number
  /**
   * 規格把這欄叫「單價」，但第一張實拍樣本無法分辨它是單價還是小計
   * （`白蘭氏雞精組:2:1479`，2×1479 與 1479 都說得通）。語意未定之前
   * 不寫進 `RecordItem.unitPrice` 或 `.amount`，只原樣帶著給人看。
   */
  value: number
}

export interface RecognizedInvoice {
  invoiceNumber: string | null
  /** 西元 `YYYY-MM-DD`。 */
  date: string | null
  randomCode: string | null
  /** 只有合規左方 QR 才有。沒有就是 null，不從品項推算（會猜錯）。 */
  totalAmount: number | null
  salesAmount: number | null
  items: RecognizedItem[]
  kinds: PayloadKind[]
  /** 判讀過程中跳過或存疑的東西。不默默吞掉，直接顯示給使用者。 */
  notes: string[]
  /** 0–1。表頭與品項都拿到才是 1。 */
  confidence: number
}

function parseTriplets(
  segments: string[],
  notes: string[],
  source: string,
): RecognizedItem[] {
  const items: RecognizedItem[] = []

  for (let i = 0; i < segments.length; i += 3) {
    const [name, qty, value] = [segments[i], segments[i + 1], segments[i + 2]]
    if (name === undefined || qty === undefined || value === undefined) {
      notes.push(`${source}最後 ${segments.length - i} 個欄位湊不成「品名:數量:單價」，略過`)
      break
    }
    // 規格沒說金額一定為正——回饋金就是負的，所以只要求是整數。
    if (!/^-?\d+$/.test(qty) || !/^-?\d+$/.test(value)) {
      notes.push(`${source}「${name}」的數量或單價不是整數（${qty} / ${value}），略過這筆`)
      continue
    }
    items.push({ name, qty: Number(qty), value: Number(value) })
  }

  return items
}

/**
 * 把一張發票上解到的所有 payload 合成一組欄位。
 *
 * **金額只採信左方 QR 的總計額**，不從品項加總推算：品項那欄的語意（單價
 * 或小計）還沒被任何樣本確認，猜錯會默默存進錯的數字。
 */
export function parseEInvoicePayload(texts: string[]): RecognizedInvoice {
  const notes: string[] = []
  const items: RecognizedItem[] = []
  const kinds: PayloadKind[] = []
  let header: LeftHeader | null = null

  for (const text of texts) {
    const classified = classifyPayload(text)
    kinds.push(classified.kind)

    if (classified.kind === 'left' && classified.header) {
      if (header) notes.push('解到一個以上的左方 QR，只採用第一個')
      else header = classified.header

      const encoding = classified.segments[3]
      if (encoding !== undefined && ENCODING_LABEL[encoding] === 'Big5') {
        notes.push('發票標示品項為 Big5 編碼，若出現亂碼請回報')
      }
      items.push(
        ...parseTriplets(classified.segments.slice(LEFT_META_SEGMENTS), notes, '左方 QR '),
      )
      continue
    }

    if (classified.kind === 'right') {
      items.push(...parseTriplets(classified.segments, notes, '右方 QR '))
      continue
    }

    // 不符規格：第一張實拍樣本就是這樣（只有品項尾段）。整段當三元組試試，
    // 但要讓使用者知道這張發票沒照規格印。
    if (classified.segments.length > 0) {
      notes.push(`有一段 QR ${classified.reason}，已當成純品項解讀`)
      items.push(...parseTriplets(classified.segments, notes, '不符規格的 QR '))
    } else {
      notes.push(`有一段 QR ${classified.reason}`)
    }
  }

  const confidence = header ? (items.length > 0 ? 1 : 0.8) : items.length > 0 ? 0.5 : 0

  return {
    invoiceNumber: header?.invoiceNumber ?? null,
    date: header?.date ?? null,
    randomCode: header?.randomCode ?? null,
    totalAmount: header?.totalAmount ?? null,
    salesAmount: header?.salesAmount ?? null,
    items,
    kinds,
    notes,
    confidence,
  }
}
