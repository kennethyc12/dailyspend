// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnalysisView from '@/views/AnalysisView.vue'
import type { Settings } from '@/models/types'
import { button, failPutOn, field, mountView, useViewTest, waitForText } from '@/test/mountView'
import { clearErrors, useErrorLog } from '@/errors/errorLog'

const { storage } = useViewTest()

afterEach(() => vi.restoreAllMocks())

/** 分析頁用自己的 shallowRef 讀 settings，讀回來才畫出「調整判斷門檻」。 */
async function openThresholds() {
  const wrapper = await mountView(AnalysisView, '/analysis')
  await waitForText(wrapper, '調整判斷門檻')
  await button(wrapper, '調整判斷門檻 ▸').trigger('click')
  return wrapper
}

describe('分析頁：既有行為', () => {
  it('沒有紀錄時列出還不能分析的項目', async () => {
    const wrapper = await mountView(AnalysisView, '/analysis')

    await waitForText(wrapper, '還不能分析的項目')
  })

  it('改建議條數，重新進頁仍是新值', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '建議條數').setValue('7')
    await vi.waitFor(async () =>
      expect((await storage().get<Settings>('settings', 'settings'))!.thresholds.suggestion.topN).toBe(7),
    )
    wrapper.unmount()

    const again = await openThresholds()
    expect((field(again, '建議條數').element as HTMLInputElement).value).toBe('7')
  })
})

describe('分析頁：非預期錯誤（B5b）', () => {
  // 輸入框的值與重新進頁的結果見〈寫入成功才更新畫面〉
  it('門檻寫入失敗：說明情境並記下錯誤', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await openThresholds()
    failPutOn('settings')
    await field(wrapper, '建議條數').setValue('7')

    await waitForText(wrapper, '門檻儲存失敗。已記錄錯誤')
    expect(useErrorLog().errors.value.map((e) => e.where)).toEqual(['AnalysisView.updateThreshold'])
    clearErrors()
  })
})

describe('分析頁：寫入成功才更新畫面', () => {
  const savedThresholds = async () => (await storage().get<Settings>('settings', 'settings'))!.thresholds
  const inputValue = (wrapper: Awaited<ReturnType<typeof openThresholds>>, label: string) =>
    (field(wrapper, label).element as HTMLInputElement).value

  it('寫入失敗：輸入框回到舊值，重新進頁仍是舊值', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await openThresholds()
    failPutOn('settings')
    await field(wrapper, '建議條數').setValue('7')

    await waitForText(wrapper, '門檻儲存失敗')
    await vi.waitFor(() => expect(inputValue(wrapper, '建議條數')).toBe('3'))
    vi.restoreAllMocks()
    wrapper.unmount()
    clearErrors()

    const again = await openThresholds()
    expect(inputValue(again, '建議條數')).toBe('3')
  })

  it('失敗後改另一欄成功，失敗的值不會一起存進去', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await openThresholds()
    failPutOn('settings')
    await field(wrapper, '建議條數').setValue('7')
    await waitForText(wrapper, '門檻儲存失敗')
    vi.restoreAllMocks()

    await field(wrapper, '重複購買 · 觀察天數').setValue('20')
    await vi.waitFor(async () => expect((await savedThresholds()).repeatPurchase.windowDays).toBe(20))
    expect((await savedThresholds()).suggestion.topN).toBe(3)
    clearErrors()
  })

  it('同步連改兩欄，兩個都存進去', async () => {
    const wrapper = await openThresholds()
    const topN = field(wrapper, '建議條數').element as HTMLInputElement
    const windowDays = field(wrapper, '重複購買 · 觀察天數').element as HTMLInputElement
    topN.value = '7'
    topN.dispatchEvent(new Event('change'))
    windowDays.value = '20'
    windowDays.dispatchEvent(new Event('change'))

    await vi.waitFor(async () => {
      const t = await savedThresholds()
      expect([t.suggestion.topN, t.repeatPurchase.windowDays]).toEqual([7, 20])
    })
  })

  it('失敗後下一次成功，錯誤訊息消失', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await openThresholds()
    failPutOn('settings')
    await field(wrapper, '建議條數').setValue('7')
    await waitForText(wrapper, '門檻儲存失敗')
    vi.restoreAllMocks()

    await field(wrapper, '建議條數').setValue('8')
    await vi.waitFor(async () => expect((await savedThresholds()).suggestion.topN).toBe(8))
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('門檻儲存失敗'))
    clearErrors()
  })

  it('連續兩次失敗，輸入框仍回到舊值', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await openThresholds()
    failPutOn('settings')
    await field(wrapper, '建議條數').setValue('7')
    await vi.waitFor(() => expect(useErrorLog().errors.value).toHaveLength(1))
    await field(wrapper, '建議條數').setValue('8')
    await vi.waitFor(() => expect(useErrorLog().errors.value).toHaveLength(2))

    await vi.waitFor(() => expect(inputValue(wrapper, '建議條數')).toBe('3'))
    clearErrors()
  })

  it('寫入成功後收合再展開，輸入框是新值', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '建議條數').setValue('7')
    await vi.waitFor(async () => expect((await savedThresholds()).suggestion.topN).toBe(7))

    await button(wrapper, '調整判斷門檻 ▾').trigger('click')
    await button(wrapper, '調整判斷門檻 ▸').trigger('click')
    expect(inputValue(wrapper, '建議條數')).toBe('7')
  })
})
