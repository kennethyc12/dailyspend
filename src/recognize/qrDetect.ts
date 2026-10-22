import { prepareZXingModule, readBarcodes, type ZXingModuleOverrides } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

/**
 * QR 偵測。選型結果見 design.md §5.2：zxing-wasm 能一次解到一張圖上並排的
 * 兩個碼，jsQR 在同樣的圖上整張失敗，所以 v1 只留這一套（§13.3）。
 *
 * 這裡只負責「把圖變成 payload」，欄位切法在 parseEInvoicePayload。
 */
export interface DetectedCode {
  text: string
  /** 品項目前只遇過 UTF-8，但 Big5、Base64 都可能出現，所以原始位元組要留著自己判斷。 */
  bytes: Uint8Array
  rotation: number
}

export interface DetectResult {
  codes: DetectedCode[]
  ms: number
  error: string | null
}

/**
 * `ImageData` 的結構子集。測試在 node 下跑，沒有 `ImageData` 這個 global，
 * 用結構型別才能把合成的圖直接餵進來。
 */
export interface RawImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

// wasm 從 bundle 取，不走 zxing-wasm 預設的 CDN：PWA 離線時 CDN 拿不到。
let modulePrepared = false
let overrides: ZXingModuleOverrides | null = null

/** 測試在 node 下跑，fetch 不到 `?url` 的路徑，要自己把 wasm 餵進來。 */
export function setZxingOverrides(next: ZXingModuleOverrides) {
  overrides = next
  modulePrepared = false
}

function prepareZxing() {
  if (modulePrepared) return
  prepareZXingModule({
    overrides: overrides ?? {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`,
    },
  })
  modulePrepared = true
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

export function decodeBig5(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('big5').decode(bytes)
  } catch {
    // Safari 的 TextDecoder 不保證有 big5；拿不到就只能看 hex。
    return null
  }
}

/** 第一次呼叫會載入並編譯 wasm，耗時與之後差一個量級，所以量測前先暖機。 */
export async function warmUp(): Promise<number> {
  prepareZxing()
  const t0 = performance.now()
  const blank = new ImageData(new Uint8ClampedArray(4 * 8 * 8).fill(255), 8, 8)
  await readBarcodes(blank, { formats: ['QRCode'] })
  return performance.now() - t0
}

export async function detectQrCodes(input: Blob | RawImage): Promise<DetectResult> {
  prepareZxing()
  const t0 = performance.now()
  try {
    const results = await readBarcodes(input as Blob | ImageData, {
      formats: ['QRCode'],
      // 一張發票是左右兩個 QR；上限放寬一點，髒照片上多偵到的再由欄位解析擋掉。
      maxNumberOfSymbols: 8,
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    })
    return {
      ms: performance.now() - t0,
      error: null,
      codes: results
        .filter((r) => r.isValid)
        .map((r) => ({ text: r.text, bytes: r.bytes, rotation: r.rotation })),
    }
  } catch (e) {
    return { codes: [], ms: performance.now() - t0, error: (e as Error).message }
  }
}
