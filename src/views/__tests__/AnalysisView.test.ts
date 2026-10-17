// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnalysisView from '@/views/AnalysisView.vue'
import type { Settings, SpendRecord } from '@/models/types'
import { button, failPutOn, field, mountView, useViewTest, waitForText } from '@/test/mountView'
import { clearErrors, useErrorLog } from '@/errors/errorLog'
import { createFromText } from '@/services/entryService'
import { updateSettings } from '@/services/settingsService'
import { todayIso } from '@/parsing/quickInput'
import { addDays } from '@/analysis/dates'

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

describe('分析頁：門檻範圍（B6a）', () => {
  const savedThresholds = async () => (await storage().get<Settings>('settings', 'settings'))!.thresholds
  const inputValue = (wrapper: Awaited<ReturnType<typeof openThresholds>>, label: string) =>
    (field(wrapper, label).element as HTMLInputElement).value
  const warning = (wrapper: Awaited<ReturnType<typeof openThresholds>>) =>
    wrapper.find('.result.warn').exists() ? wrapper.find('.result.warn').text() : null

  it('清空最少連續月數：說明範圍，值不變、不回報', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '訂閱 · 最少連續月數').setValue('')

    await waitForText(wrapper, '門檻儲存失敗：訂閱 · 最少連續月數要填 2 以上的整數')
    await vi.waitFor(() => expect(inputValue(wrapper, '訂閱 · 最少連續月數')).toBe('3'))
    expect((await savedThresholds()).subscription.minMonths).toBe(3)
    expect(useErrorLog().errors.value).toEqual([])
  })

  it('最少連續月數填 1：擋下', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '訂閱 · 最少連續月數').setValue('1')

    await waitForText(wrapper, '門檻儲存失敗：訂閱 · 最少連續月數要填 2 以上的整數')
    expect((await savedThresholds()).subscription.minMonths).toBe(3)
  })

  it('增幅門檻填 0：存得進去', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '月對月 · 增幅門檻（%）').setValue('0')

    await vi.waitFor(async () => expect((await savedThresholds()).monthGrowth.growthPct).toBe(0))
    expect(warning(wrapper)).toBeNull()
  })

  it('清空增幅門檻：擋下，不會存成 0', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '月對月 · 增幅門檻（%）').setValue('')

    await waitForText(wrapper, '門檻儲存失敗：月對月 · 增幅門檻（%）要填 0 以上的整數')
    expect((await savedThresholds()).monthGrowth.growthPct).toBe(50)
  })

  it('建議條數填小數：擋下', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '建議條數').setValue('2.5')

    await waitForText(wrapper, '門檻儲存失敗：建議條數要填 1 以上的整數')
    expect((await savedThresholds()).suggestion.topN).toBe(3)
  })

  it('觀察天數填 366：擋下', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '高頻小額 · 觀察天數').setValue('366')

    await waitForText(wrapper, '門檻儲存失敗：高頻小額 · 觀察天數要填 1–365 的整數')
    expect((await savedThresholds()).smallFrequent.windowDays).toBe(30)
  })

  it('觀察天數填 365：存得進去', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '高頻小額 · 觀察天數').setValue('365')

    await vi.waitFor(async () => expect((await savedThresholds()).smallFrequent.windowDays).toBe(365))
    expect(warning(wrapper)).toBeNull()
  })

  it('寫入失敗後輸入無效值：驗證訊息取代舊訊息', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await openThresholds()
    failPutOn('settings')
    await field(wrapper, '建議條數').setValue('7')
    await waitForText(wrapper, '門檻儲存失敗。已記錄錯誤')
    vi.restoreAllMocks()

    await field(wrapper, '建議條數').setValue('0')
    await waitForText(wrapper, '門檻儲存失敗：建議條數要填 1 以上的整數')
    expect(wrapper.text()).not.toContain('門檻儲存失敗。已記錄錯誤')
    clearErrors()
  })

  it('連續兩次同一個無效值，輸入框都回到舊值', async () => {
    const wrapper = await openThresholds()
    await field(wrapper, '建議條數').setValue('0')
    await waitForText(wrapper, '門檻儲存失敗：建議條數要填 1 以上的整數')
    await vi.waitFor(() => expect(inputValue(wrapper, '建議條數')).toBe('3'))

    await field(wrapper, '建議條數').setValue('0')
    await vi.waitFor(() => expect(inputValue(wrapper, '建議條數')).toBe('3'))
  })

  it('已存的最少連續月數 0：進頁後修回 2，分析頁照常打開', async () => {
    await updateSettings(storage(), (s) => ({
      ...s,
      thresholds: { ...s.thresholds, subscription: { ...s.thresholds.subscription, minMonths: 0 } },
    }))
    await createFromText(storage(), '全家 咖啡 55')
    const [r] = await storage().getAll<SpendRecord>('records')
    await storage().put('records', { ...r!, date: addDays(todayIso(), -90) })

    const wrapper = await openThresholds()

    expect(inputValue(wrapper, '訂閱 · 最少連續月數')).toBe('2')
    expect((await savedThresholds()).subscription.minMonths).toBe(2)
  })
})
