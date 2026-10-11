import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { writeBarcode } from 'zxing-wasm/writer'
import { decodeBig5, detectQrCodes, setZxingOverrides, toHex, type RawImage } from '../qrDetect'

/**
 * §5.2 的判準是「能不能一次拿到一張圖裡的左右兩個 QR」。合成圖驗的是**能力**，
 * 成功率由真實照片回答（2026-10-11 實測：四種壓縮設定都是兩個碼，見 §5.2）。
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

const WASM_PATH = new URL(
  '../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',
  import.meta.url,
)

let twoCodes: RawImage

beforeAll(async () => {
  setZxingOverrides({ wasmBinary: (await readFile(WASM_PATH)).buffer as ArrayBuffer })
  twoCodes = compose(await symbolFor(LEFT), await symbolFor(RIGHT))
}, 30_000)

describe('detectQrCodes', () => {
  it('一次呼叫解到並排的兩個 QR', async () => {
    const result = await detectQrCodes(twoCodes)

    expect(result.error).toBeNull()
    expect(result.codes).toHaveLength(2)
    expect(result.codes.map((c) => c.text).sort()).toEqual([LEFT, RIGHT].sort())
  })

  it('保留原始位元組，中文品項不靠 text 欄位也還原得出來', async () => {
    const result = await detectQrCodes(twoCodes)
    const right = result.codes.find((c) => c.text.startsWith('**:'))

    expect(right).toBeDefined()
    expect(right!.bytes.length).toBeGreaterThan(0)
  })

  it('沒有 QR 的圖回空陣列而不是丟錯', async () => {
    const blank: RawImage = {
      data: new Uint8ClampedArray(64 * 64 * 4).fill(255),
      width: 64,
      height: 64,
    }

    const result = await detectQrCodes(blank)

    expect(result.error).toBeNull()
    expect(result.codes).toEqual([])
  })
})

describe('位元組工具', () => {
  it('toHex 每個位元組兩碼、空白分隔', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('00 0f ff')
  })

  it('decodeBig5 解得出 Big5 的中文', () => {
    //「蘋果」的 Big5：c4ab aa47
    expect(decodeBig5(new Uint8Array([0xc4, 0xab, 0xaa, 0x47]))).toBe('蘋果')
  })
})
