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
