import type { Photo } from '@/models/types'

export interface LeftQrOptions {
  invoiceNumber?: string
  /** 民國年月日 7 碼。 */
  roc?: string
  total?: number
  items?: [name: string, qty: number, value: number][]
}

/** 依財政部規格組出合規左方 QR：77 碼表頭 + 4 個中繼欄位 + 品項三元組。 */
export function leftQr({
  invoiceNumber = 'AB12345678',
  roc = '1151005',
  total = 55,
  items = [['咖啡', 1, 55]],
}: LeftQrOptions = {}): string {
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  const header = `${invoiceNumber}${roc}3456${hex(total)}${hex(total)}${'0'.repeat(8)}12345678${'0'.repeat(24)}`
  const meta = `自訂資料:${items.length}:${items.length}:0`
  const triplets = items.map(([name, qty, value]) => `${name}:${qty}:${value}`).join(':')
  return `${header}:${meta}${triplets ? `:${triplets}` : ''}`
}

/**
 * 依 2026-10-12 /qr-lab 實拍的兩張合規發票組成：保留欄位結構與怪寫法，
 * 發票號碼、隨機碼、賣方統編、加密驗證換成假值（號碼加隨機碼可查到消費明細）。
 */
const FAKE_ENC = 'AAAAAAAAAAAAAAAAAAAAAA=='
/** 實拍 A：只有一個品項、編碼參數 1、右方 QR 只有 `**`。 */
export const REAL_A_LEFT = `ZZ000000011140903000000000258000002580000000012345678${FAKE_ENC}:**********:1:1:1:<——>電影預售套票:1:600`
export const REAL_A_RIGHT = '**'
/** 實拍 B：單價帶小數、左方結尾多一個 `:`、右方 `**` 後面沒接 `:`。 */
export const REAL_B_LEFT = `ZZ000000021141230000000000320000003480000000012345678${FAKE_ENC}:**********:3:3:0:炙燒明太子:1:370.0:蒜味美乃滋:1:280.0:`
export const REAL_B_RIGHT = '**炸雞翅:1:190.0'

/** `compressPhoto` 的替身：用檔名當 photo id，測試才分得出是哪一張照片。 */
export function photoFromFile(file: Blob): Photo {
  const name = file instanceof File ? file.name : 'photo'
  return {
    id: name,
    blob: new Blob([name], { type: 'image/jpeg' }),
    thumbBlob: new Blob([name], { type: 'image/jpeg' }),
    width: 10,
    height: 10,
    bytes: name.length,
    capturedAt: 0,
  }
}

export const CARRIER_HEADER_LINE = '消費時間,發票號碼,店家名稱,賣方統編,消費品項,單價,個數,小計,總計,備註'

export interface CarrierRowOptions {
  time?: string
  number?: string
  merchant?: string
  seller?: string
  item?: string
  price?: string
  qty?: string
  subtotal?: string
  total?: string
  note?: string
}

function quoteCarrierCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** 組發票存摺格式的 CSV。總計放在哪一列由呼叫端逐列指定，helper 不替它決定。 */
export function carrierCsv(rows: CarrierRowOptions[], { bom = true } = {}): string {
  const lines = rows.map((r) =>
    [
      r.time ?? '2026/09/01 12:00:00',
      r.number ?? 'ZZ00000001',
      r.merchant ?? '測試商店股份有限公司',
      r.seller ?? '12345678',
      r.item ?? '咖啡',
      r.price ?? '55',
      r.qty ?? '1',
      r.subtotal ?? '55',
      r.total ?? '',
      r.note ?? '',
    ]
      .map(quoteCarrierCell)
      .join(','),
  )
  return `${bom ? '\uFEFF' : ''}${[CARRIER_HEADER_LINE, ...lines].join('\n')}\n`
}

/**
 * 依 2026-10-13 發票存摺匯出的樣本組成，保留結構與怪寫法。repo 是公開的：
 * 號碼、統編、店名（含地名）、消費日期與時間都換成假值，店名保留「公司全名 +
 * 分公司／全形數字門市部」的結構；品名部分沿用樣本（一般商品名稱）。
 */
export const REAL_PASSBOOK_CSV = `\uFEFF${CARRIER_HEADER_LINE}
2026/08/03 11:20:05,ZZ00000001,測試量販股份有限公司測試路分公司,11111111,鮭魚握壽司22入,479,1,479,479,
2026/08/03 16:42:10,ZZ00000002,測試量販股份有限公司測試路分公司,11111111,洗衣精,369,1,369,648,
2026/08/03 16:42:10,ZZ00000002,測試量販股份有限公司測試路分公司,11111111,會員回饋金,-90,1,-90,,
2026/08/03 16:42:10,ZZ00000002,測試量販股份有限公司測試路分公司,11111111,洗衣精,369,1,369,,
2026/08/06 09:15:30,ZZ00000003,測試飲料股份有限公司範例分公司,22222222,"綠茶-正常冰,無糖",29,1,29,57,
2026/08/06 09:15:30,ZZ00000003,測試飲料股份有限公司範例分公司,22222222,"綠茶-正常冰,無糖",28,1,28,,
2026/08/10 07:05:44,ZZ00000004,測試石油股份有限公司油品行銷事業部,33333333,【000000000000】 油品等(加值),1428.57,1,1429,1500,
2026/08/12 13:31:02,ZZ00000005,測試加油站股份有限公司,44444444,九五無鉛汽油,32,36.27000000000000512,1161,1124,
2026/08/12 13:31:02,ZZ00000005,測試加油站股份有限公司,44444444,95無鉛汽油折抵額,-1,37,-37,,
2026/08/15 21:48:19,ZZ00000006,測試超商股份有限公司台北市第一二三門市部,55555555,ＦＭＣ氣泡水,29,1,29,44,
2026/08/15 21:48:19,ZZ00000006,測試超商股份有限公司台北市第一二三門市部,55555555,ＦＭＣ氣泡水,29,1,29,,
2026/08/15 21:48:19,ZZ00000006,測試超商股份有限公司台北市第一二三門市部,55555555,飲料促,0,2,-14,,
2026/08/20 12:10:00,ZZ00000007,測試速食股份有限公司範例分公司,66666666,套餐主餐,99,1,99,174,
2026/08/20 12:10:00,ZZ00000007,測試速食股份有限公司範例分公司,66666666,綠茶-中,43,1,43,,
2026/08/20 12:10:00,ZZ00000007,測試速食股份有限公司範例分公司,66666666,薯條-中,32,1,32,,
2026/08/20 12:10:00,ZZ00000007,測試速食股份有限公司範例分公司,66666666,可樂-中,38,0,0,,
2026/08/24 19:02:37,ZZ00000008,測試餐廳股份有限公司,77777777,升級湯品,50,2,100,346,
2026/08/24 19:02:37,ZZ00000008,測試餐廳股份有限公司,77777777,雞腿堡,279,1,279,,
2026/08/24 19:02:37,ZZ00000008,測試餐廳股份有限公司,77777777,服務費,17,1,17,,
`

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
