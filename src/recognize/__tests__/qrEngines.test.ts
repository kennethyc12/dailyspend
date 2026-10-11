import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { writeBarcode } from 'zxing-wasm/writer'
import {
  cropHalf,
  detectWithJsQrOnImage,
  detectWithZxing,
  setZxingOverrides,
  type RawImage,
} from '../qrEngines'

/**
 * §5.2 的判準是「能不能一次拿到一張圖裡的左右兩個 QR」。用合成圖驗證的是
 * **能力**，不是成功率——角度、光線、壓縮的成功率只有真實照片測得出來。
 */
const LEFT = 'AB123456781120912345678900000123**00000190000000000000000012'
const RIGHT = '**:1:1:蘋果:1:50:香蕉:2:30'

interface Symbol1Bit {
  data: Uint8ClampedArray
  width: number
  height: number
}

async function symbolFor(text: string): Promise<Symbol1Bit> {
  const written = await writeBarcode(text, { format: 'QRCode' })
  if (!written.symbol) throw new Error(written.error || '產生 QR 失敗')
  return written.symbol
}

/** 左右並排、中間留白、四周 quiet zone——模擬一張發票上的兩個 QR。 */
function compose(a: Symbol1Bit, b: Symbol1Bit, scale = 6, quiet = 8, gap = 16): RawImage {
  const width = (a.width + gap + b.width + quiet * 2) * scale
  const height = (Math.max(a.height, b.height) + quiet * 2) * scale
  const data = new Uint8ClampedArray(width * height * 4).fill(255)

  const put = (sym: Symbol1Bit, offsetX: number) => {
    for (let y = 0; y < sym.height; y++) {
      for (let x = 0; x < sym.width; x++) {
        const value = sym.data[y * sym.width + x]!
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = ((y + quiet) * scale + dy) * width + (x + offsetX) * scale + dx
            data[px * 4] = value
            data[px * 4 + 1] = value
            data[px * 4 + 2] = value
          }
        }
      }
    }
  }

  put(a, quiet)
  put(b, quiet + a.width + gap)
  return { data, width, height }
}

let twoCodes: RawImage
let oneCode: RawImage

const WASM_PATH = new URL(
  '../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',
  import.meta.url,
)

beforeAll(async () => {
  setZxingOverrides({ wasmBinary: (await readFile(WASM_PATH)).buffer as ArrayBuffer })
  const [left, right] = [await symbolFor(LEFT), await symbolFor(RIGHT)]
  twoCodes = compose(left, right)
  oneCode = cropHalf(twoCodes, 'left')
}, 30_000)

describe('zxing-wasm', () => {
  it('一次呼叫解到並排的兩個 QR', async () => {
    const run = await detectWithZxing(twoCodes)

    expect(run.error).toBeNull()
    expect(run.codes).toHaveLength(2)
    expect(run.codes.map((c) => c.text).sort()).toEqual([LEFT, RIGHT].sort())
  })

  it('保留原始位元組，中文品項不靠 text 欄位也還原得出來', async () => {
    const run = await detectWithZxing(twoCodes)
    const right = run.codes.find((c) => c.text.startsWith('**:'))

    expect(right).toBeDefined()
    expect(right!.byteLength).toBeGreaterThan(0)
    expect(right!.bytesHex).toMatch(/^[0-9a-f]{2}( [0-9a-f]{2})*$/)
  })
})

describe('jsQR', () => {
  it('單碼的圖解得到', () => {
    const run = detectWithJsQrOnImage(oneCode, 'whole')

    expect(run.error).toBeNull()
    expect(run.codes.map((c) => c.text)).toEqual([LEFT])
  })

  // 比「只回一個」更糟：兩個碼並排時它連一個都回不出來，因為 locator 會被
  // 另一半的定位點干擾。所以 jsQR 不是「拿第一個就好」，是非切圖不可。
  it('同一張有兩個碼時連一個都回不出來', () => {
    const run = detectWithJsQrOnImage(twoCodes, 'whole')

    expect(run.error).toBeNull()
    expect(run.codes).toHaveLength(0)
  })

  it('切成左右半張後兩個碼各自解得到', () => {
    const left = detectWithJsQrOnImage(twoCodes, 'left')
    const right = detectWithJsQrOnImage(twoCodes, 'right')

    expect(left.codes.map((c) => c.text)).toEqual([LEFT])
    expect(right.codes.map((c) => c.text)).toEqual([RIGHT])
  })
})

describe('cropHalf', () => {
  it('左右各取 55%，重疊 10% 以容忍切分點偏移', () => {
    const image: RawImage = {
      data: new Uint8ClampedArray(100 * 10 * 4),
      width: 100,
      height: 10,
    }

    expect(cropHalf(image, 'left').width).toBe(55)
    expect(cropHalf(image, 'right').width).toBe(55)
    expect(cropHalf(image, 'left').height).toBe(10)
  })

  it('切出來的像素真的來自對應的半邊', () => {
    const width = 10
    const height = 2
    const data = new Uint8ClampedArray(width * height * 4)
    // 每個像素的 R 設成它的 x 座標，切完就看得出來取到哪一段。
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data[(y * width + x) * 4] = x
    }

    const right = cropHalf({ data, width, height }, 'right')

    expect(right.width).toBe(5)
    expect(right.data[0]).toBe(5)
    expect(right.data[right.width * 4]).toBe(5)
  })
})
