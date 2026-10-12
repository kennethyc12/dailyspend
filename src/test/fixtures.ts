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
