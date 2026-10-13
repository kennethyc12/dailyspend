// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DOMWrapper } from '@vue/test-utils'
import type { SpendRecord } from '@/models/types'
import QuickInputView from '@/views/QuickInputView.vue'
import { compressPhoto } from '@/photo/compress'
import { detectQrCodes, type DetectResult } from '@/recognize/qrDetect'
import { leftQr, photoFromFile, REAL_B_RIGHT } from '@/test/fixtures'
import { button, field, mountView, pickFile, settled, useViewTest, waitForText } from '@/test/mountView'

vi.mock('@/recognize/qrDetect', () => ({
  detectQrCodes: vi.fn(),
  warmUp: vi.fn(async () => 0),
}))

vi.mock('@/photo/compress', () => ({
  compressPhoto: vi.fn(),
}))

const { storage } = useViewTest()

beforeEach(() => {
  vi.mocked(detectQrCodes).mockReset()
  vi.mocked(compressPhoto).mockReset()
})

function detected(...texts: string[]): DetectResult {
  return { codes: texts.map((text) => ({ text, bytes: new Uint8Array(), rotation: 0 })), ms: 1, error: null }
}

function albumInput(wrapper: Awaited<ReturnType<typeof mountView>>): DOMWrapper<HTMLInputElement> {
  return wrapper.findAll<HTMLInputElement>('input[type="file"]').find((i) => !i.attributes('capture'))!
}

function file(name: string): File {
  return new File([name], name, { type: 'image/jpeg' })
}

describe('記一筆：文字輸入', () => {
  it('輸入「全家 咖啡 55」按存檔 → 存進一筆並顯示結果', async () => {
    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)

    await wrapper.find('input.entry').setValue('全家 咖啡 55')
    await button(wrapper, '存檔').trigger('click')
    await settled(wrapper)

    const records = await storage().getAll<SpendRecord>('records')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ merchant: '全家', amount: 55, sourceType: 'manual' })
    expect(wrapper.text()).toContain('已存：全家')
  })
})

describe('記一筆：發票照片', () => {
  // D1：讀到發票就只剩「用發票資料存檔」一條路，文字框與文字的「存檔」都不在畫面上
  it('#4 文字框有字時讀到發票，只能用發票資料存檔，不會存成丟了發票資料的手打紀錄', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    vi.mocked(detectQrCodes).mockResolvedValue(detected(leftQr({ invoiceNumber: 'AB12345678' })))

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await wrapper.find('input.entry').setValue('全家 咖啡 55')
    await pickFile(albumInput(wrapper), file('a.jpg'))
    await waitForText(wrapper, 'AB12345678')
    await settled(wrapper)

    // 畫面層：互搶的那條路不存在
    expect(wrapper.find('input.entry').exists()).toBe(false)
    expect(wrapper.findAll('button').map((b) => b.text().trim())).not.toContain('存檔')

    await button(wrapper, '用發票資料存檔').trigger('click')
    await settled(wrapper)

    // 資料層：存下的是發票資料
    const records = await storage().getAll<SpendRecord>('records')
    expect(records.map((r) => r.invoiceNumber)).toEqual(['AB12345678'])
    // 畫面層：存檔後文字框回來，被隱藏的那段字已清掉，再按「存檔」不會重複記帳
    expect(wrapper.find<HTMLInputElement>('input.entry').element.value).toBe('')
  })

  // B3 修好後，讀取中的拍照 input 會被 disable，VTU 對 disabled 元素的 trigger 不會有反應，
  // B 根本選不進去，結果變成 A 照片配 A 發票、測試轉綠——這是正確行為，不是測試寫錯。
  it('#12a 讀 A 照片的 QR 時換成 B 照片，存下來的照片和發票資料屬於同一張', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    let resolveA!: (r: DetectResult) => void
    vi.mocked(detectQrCodes)
      .mockImplementationOnce(() => new Promise<DetectResult>((r) => (resolveA = r)))
      .mockResolvedValueOnce(detected(leftQr({ invoiceNumber: 'BB12345678' })))

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)

    await pickFile(albumInput(wrapper), file('a.jpg'))
    await vi.waitFor(() => expect(detectQrCodes).toHaveBeenCalledTimes(1))
    await pickFile(albumInput(wrapper), file('b.jpg'))
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('照片處理中'))
    resolveA(detected(leftQr({ invoiceNumber: 'AA12345678' })))
    await waitForText(wrapper, '用發票資料存檔')
    await settled(wrapper)

    await button(wrapper, '用發票資料存檔').trigger('click')
    await settled(wrapper)

    const [record] = await storage().getAll<SpendRecord>('records')
    const pair = `${record!.photoId}/${record!.invoiceNumber}`
    expect(['a.jpg/AA12345678', 'b.jpg/BB12345678']).toContain(pair)
  })
})

describe('記一筆：發票總計額記成 0', () => {
  it('不顯示 $0、提供金額欄位，存檔用使用者輸入的金額', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    vi.mocked(detectQrCodes).mockResolvedValue(detected(leftQr({ invoiceNumber: 'ZZ00000003', total: 0 })))

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await pickFile(albumInput(wrapper), file('a.jpg'))
    await waitForText(wrapper, 'ZZ00000003')
    await settled(wrapper)

    // 畫面層：沒有「發票總計額 $0」，改成讓使用者輸入
    expect(wrapper.text()).not.toContain('發票總計額')
    await field(wrapper, '金額').setValue('120')
    await button(wrapper, '用發票資料存檔').trigger('click')
    await settled(wrapper)

    // 資料層：存的是使用者輸入的 120，不是 0
    const [record] = await storage().getAll<SpendRecord>('records')
    expect(record!.amount).toBe(120)
  })
})

describe('記一筆：讀到發票之後的狀態（D1、#12b、#5）', () => {
  it('移除照片後文字框回來，原本的字還在', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    vi.mocked(detectQrCodes).mockResolvedValue(detected(leftQr({ invoiceNumber: 'AB12345678' })))

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await wrapper.find('input.entry').setValue('全家 咖啡 55')
    await pickFile(albumInput(wrapper), file('a.jpg'))
    await waitForText(wrapper, 'AB12345678')
    await settled(wrapper)

    await button(wrapper, '移除照片').trigger('click')
    await settled(wrapper)

    expect(wrapper.find<HTMLInputElement>('input.entry').element.value).toBe('全家 咖啡 55')
  })

  it('讀 QR 期間不能移除照片，也不能用文字存檔', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    let resolve!: (r: DetectResult) => void
    vi.mocked(detectQrCodes).mockImplementationOnce(() => new Promise<DetectResult>((r) => (resolve = r)))

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await wrapper.find('input.entry').setValue('全家 咖啡 55')
    await pickFile(albumInput(wrapper), file('a.jpg'))
    await waitForText(wrapper, '讀取發票 QR…')

    expect(button(wrapper, '移除照片').element.disabled).toBe(true)
    expect(button(wrapper, '存檔').element.disabled).toBe(true)
    // 在文字框按 Enter 不經過按鈕，只靠 submit() 開頭的檢查擋下
    await wrapper.find('form').trigger('submit')

    resolve(detected())
    await waitForText(wrapper, '讀不到 QR')
    expect(await storage().count('records')).toBe(0)
  })

  it('#5 沒有表頭的發票要填日期才能存，存下的是填的日期', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    vi.mocked(detectQrCodes).mockResolvedValue(detected(REAL_B_RIGHT))

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await pickFile(albumInput(wrapper), file('a.jpg'))
    await waitForText(wrapper, '發票 QR 裡沒有日期')
    await settled(wrapper)

    await field(wrapper, '金額').setValue('190')
    expect(button(wrapper, '用發票資料存檔').element.disabled).toBe(true)
    await field(wrapper, '日期').setValue('2025-12-30')
    await button(wrapper, '用發票資料存檔').trigger('click')
    await settled(wrapper)

    const [record] = await storage().getAll<SpendRecord>('records')
    expect(record!.date).toBe('2025-12-30')
  })

  it('同一張照片讀到多張發票：不顯示發票面板，文字框照常可用，看得到原因', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    vi.mocked(detectQrCodes).mockResolvedValue(
      detected(leftQr({ invoiceNumber: 'AA12345678' }), leftQr({ invoiceNumber: 'BB12345678' })),
    )

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await pickFile(albumInput(wrapper), file('a.jpg'))
    await waitForText(wrapper, '請一次拍一張')

    expect(wrapper.find('input.entry').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('用發票資料存檔')
  })

  it('讀不到 QR 時說明，文字框照常可用', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    vi.mocked(detectQrCodes).mockResolvedValue(detected())

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await pickFile(albumInput(wrapper), file('a.jpg'))

    await waitForText(wrapper, '讀不到 QR，請手動輸入')
    expect(wrapper.find('input.entry').exists()).toBe(true)
  })

  it('讀取失敗時說明原因', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    vi.mocked(detectQrCodes).mockResolvedValue({ codes: [], ms: 1, error: 'wasm 載入失敗' })

    const wrapper = await mountView(QuickInputView)
    await settled(wrapper)
    await pickFile(albumInput(wrapper), file('a.jpg'))

    await waitForText(wrapper, '讀取發票失敗：wasm 載入失敗')
  })
})

