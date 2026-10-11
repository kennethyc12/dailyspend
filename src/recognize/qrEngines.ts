import jsQR from 'jsqr'
import { prepareZXingModule, readBarcodes, type ZXingModuleOverrides } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

/**
 * §5.2 library 選型用的量測工具，**不是**最終的 RecognizerPort 實作。
 * 選型定案後只留勝出的那條，另一個連 dependency 一起移除（§13.3：單一 library）。
 */
export type EngineName = 'zxing-wasm' | 'jsQR'

export interface DetectedCode {
  text: string
  /** 台灣發票右 QR 的品項可能是 Big5 或 Base64，所以原始位元組要留著自己判斷。 */
  bytesHex: string
  big5: string | null
  byteLength: number
  rotation: number | null
}

export interface DetectRun {
  engine: EngineName
  /** jsQR 一張只解一個碼，所以必須自己切半；這裡記的是切法。 */
  variant: Variant
  codes: DetectedCode[]
  ms: number
  error: string | null
}

export type Variant = 'whole' | 'left' | 'right'

/**
 * `ImageData` 的結構子集。測試在 node 下跑，沒有 `ImageData` 這個 global，
 * 用結構型別才能把合成的圖直接餵進來。
 */
export interface RawImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

// wasm 從 bundle 取，不走 CDN（zxing-wasm 的預設）：PWA 離線時 CDN 拿不到。
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

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

function decodeBig5(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('big5').decode(bytes)
  } catch {
    // Safari 的 TextDecoder 不保證有 big5；拿不到就讓畫面只顯示 hex。
    return null
  }
}

export async function toImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const { width, height } = bitmap

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('無法取得繪圖內容')
      ctx.drawImage(bitmap, 0, 0)
      return ctx.getImageData(0, 0, width, height)
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('無法取得繪圖內容')
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, width, height)
  } finally {
    bitmap.close()
  }
}

/** 第一次呼叫會載入並編譯 wasm，耗時與之後的差一個量級，所以量測前先暖機。 */
export async function warmUpZxing(): Promise<number> {
  prepareZxing()
  const t0 = performance.now()
  const blank = new ImageData(new Uint8ClampedArray(4 * 8 * 8).fill(255), 8, 8)
  await readBarcodes(blank, { formats: ['QRCode'] })
  return performance.now() - t0
}

export async function detectWithZxing(input: Blob | RawImage): Promise<DetectRun> {
  prepareZxing()
  const t0 = performance.now()
  try {
    const results = await readBarcodes(input as Blob | ImageData, {
      formats: ['QRCode'],
      // 一張發票是左右兩個 QR，上限放寬才看得出「一次解到幾個」。
      maxNumberOfSymbols: 8,
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    })
    return {
      engine: 'zxing-wasm',
      variant: 'whole',
      ms: performance.now() - t0,
      error: null,
      codes: results
        .filter((r) => r.isValid)
        .map((r) => ({
          text: r.text,
          bytesHex: toHex(r.bytes),
          big5: decodeBig5(r.bytes),
          byteLength: r.bytes.length,
          rotation: r.rotation,
        })),
    }
  } catch (e) {
    return {
      engine: 'zxing-wasm',
      variant: 'whole',
      codes: [],
      ms: performance.now() - t0,
      error: (e as Error).message,
    }
  }
}

/** 左右各取 55%：切分點落在中間時兩邊都能完整包到一個 QR。 */
const HALVES = {
  left: { x: 0, width: 0.55 },
  right: { x: 0.45, width: 0.55 },
} as const

/** 切出左／右半張。jsQR 一張只回一個碼，發票的兩個 QR 只能靠切圖分開解。 */
export function cropHalf(image: RawImage, side: 'left' | 'right'): RawImage {
  const { x, width } = HALVES[side]
  const startX = Math.round(x * image.width)
  const cropWidth = Math.min(Math.round(width * image.width), image.width - startX)
  const out = new Uint8ClampedArray(cropWidth * image.height * 4)

  for (let y = 0; y < image.height; y++) {
    const from = (y * image.width + startX) * 4
    out.set(image.data.subarray(from, from + cropWidth * 4), y * cropWidth * 4)
  }
  return { data: out, width: cropWidth, height: image.height }
}

export function detectWithJsQrOnImage(image: RawImage, variant: Variant): DetectRun {
  const t0 = performance.now()
  try {
    const target = variant === 'whole' ? image : cropHalf(image, variant)
    const found = jsQR(target.data, target.width, target.height, {
      inversionAttempts: 'attemptBoth',
    })
    const bytes = found ? new Uint8Array(found.binaryData) : null
    return {
      engine: 'jsQR',
      variant,
      ms: performance.now() - t0,
      error: null,
      codes:
        found && bytes
          ? [
              {
                text: found.data,
                bytesHex: toHex(bytes),
                big5: decodeBig5(bytes),
                byteLength: bytes.length,
                rotation: null,
              },
            ]
          : [],
    }
  } catch (e) {
    return {
      engine: 'jsQR',
      variant,
      codes: [],
      ms: performance.now() - t0,
      error: (e as Error).message,
    }
  }
}

export interface VariantResult {
  /** 壓縮設定的標籤，例如「原檔」或「1600px / q0.8」。 */
  label: string
  bytes: number
  zxing: DetectRun
  jsQr: DetectRun[]
  /** jsQR 切半後兩邊合起來解到幾個不重複的碼。 */
  jsQrUnique: number
  /**
   * JPEG → 點陣圖的時間。zxing 吃 Blob、自己在 wasm 內解碼，所以它的耗時含這段；
   * jsQR 吃點陣圖，不含。比較總耗時時要把這個數字加到 jsQR 那側。
   */
  decodeMs: number
}

export async function runBothEngines(blob: Blob, label: string): Promise<VariantResult> {
  const zxing = await detectWithZxing(blob)

  // 三個 variant 共用同一份解碼後的點陣圖，不要為了切半重新解一次 JPEG。
  const t0 = performance.now()
  const image = await toImageData(blob)
  const decodeMs = performance.now() - t0

  const jsQr: DetectRun[] = [
    detectWithJsQrOnImage(image, 'whole'),
    detectWithJsQrOnImage(image, 'left'),
    detectWithJsQrOnImage(image, 'right'),
  ]
  const texts = new Set(jsQr.flatMap((run) => run.codes.map((c) => c.text)))
  return { label, bytes: blob.size, zxing, jsQr, jsQrUnique: texts.size, decodeMs }
}
