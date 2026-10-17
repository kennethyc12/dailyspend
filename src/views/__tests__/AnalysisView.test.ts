// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnalysisView from '@/views/AnalysisView.vue'
import type { Settings, SpendRecord } from '@/models/types'
import { button, failPutOn, field, mountView, useViewTest, waitForText } from '@/test/mountView'
import { clearErrors, useErrorLog } from '@/errors/errorLog'
import { router } from '@/router'
import { createFromText } from '@/services/entryService'
import { updateSettings } from '@/services/settingsService'
import { todayIso } from '@/parsing/quickInput'
import { addDays, shiftMonthKey } from '@/analysis/dates'

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

describe('分析頁：佐證紀錄（B6b）', () => {
  /** 10 筆今天往前 0–9 天的「全家 咖啡 55」，最舊那筆沒有店家：產生高頻小額與重複購買兩條結論。 */
  async function seedSmallFrequent(): Promise<SpendRecord[]> {
    for (let i = 0; i < 10; i++) await createFromText(storage(), '全家 咖啡 55')
    const created = await storage().getAll<SpendRecord>('records')
    const placed = created.map((r, i) => ({
      ...r,
      date: addDays(todayIso(), -i),
      merchant: i === 9 ? '' : r.merchant,
    }))
    for (const r of placed) await storage().put('records', r)
    return placed
  }

  async function openAnalysis() {
    const wrapper = await mountView(AnalysisView, '/analysis')
    await waitForText(wrapper, '可以考慮減少的支出')
    return wrapper
  }

  const evidenceButton = (wrapper: Awaited<ReturnType<typeof openAnalysis>>, text: string) => {
    const found = wrapper.findAll('button').find((b) => b.text().startsWith(text))
    if (!found) throw new Error(`找不到佐證按鈕「${text}」`)
    return found
  }

  it('預設收合：依據是一顆可以展開的按鈕', async () => {
    await seedSmallFrequent()
    const wrapper = await openAnalysis()

    const texts = wrapper.findAll('button').map((b) => b.text())
    expect(texts).toContain('高頻小額 · 依據：10 筆紀錄 ▸')
    const b = evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄')
    expect(b.attributes('aria-expanded')).toBe('false')
    expect(b.attributes('aria-controls')).toBeUndefined()
  })

  const listOf = (wrapper: Awaited<ReturnType<typeof openAnalysis>>, text: string) => {
    const id = evidenceButton(wrapper, text).attributes('aria-controls')!
    return wrapper.find(`[id="${id}"]`).findAll('li').map((li) => li.text())
  }

  it('展開後依日期新到舊列出每一筆', async () => {
    await seedSmallFrequent()
    const wrapper = await openAnalysis()
    await evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').trigger('click')

    expect(evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').attributes('aria-expanded')).toBe('true')
    const rows = listOf(wrapper, '高頻小額 · 依據：10 筆紀錄')
    expect(rows).toHaveLength(10)
    expect(rows[0]).toBe(`${todayIso()} · 全家 · $55`)
    expect(rows.map((t) => t.slice(0, 10))).toEqual([...rows.map((t) => t.slice(0, 10))].sort().reverse())
  })

  it('沒有店家的紀錄顯示「（無店家）」', async () => {
    await seedSmallFrequent()
    const wrapper = await openAnalysis()
    await evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').trigger('click')

    expect(listOf(wrapper, '高頻小額 · 依據：10 筆紀錄').at(-1)).toBe(`${addDays(todayIso(), -9)} · （無店家） · $55`)
  })

  it('再按一次收合', async () => {
    await seedSmallFrequent()
    const wrapper = await openAnalysis()
    await evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').trigger('click')
    await evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').trigger('click')

    const b = evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄')
    expect(b.attributes('aria-expanded')).toBe('false')
    expect(b.attributes('aria-controls')).toBeUndefined()
    expect(wrapper.text()).not.toContain(`${todayIso()} · 全家 · $55`)
  })

  it('點清單的一筆，進到那筆紀錄的編輯頁', async () => {
    const placed = await seedSmallFrequent()
    const wrapper = await openAnalysis()
    await evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').trigger('click')
    const id = evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').attributes('aria-controls')!
    await wrapper.find(`[id="${id}"] a`).trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(`/records/${placed[0]!.id}`))
  })

  /** 「網飛」在本月與前兩個月的 1 號各一筆，回傳三個日期（舊到新）。 */
  async function seedSubscription(amount: number): Promise<string[]> {
    const thisMonth = todayIso().slice(0, 7)
    const dates = [2, 1, 0].map((back) => `${shiftMonthKey(thisMonth, -back)}-01`)
    for (let i = 0; i < 4; i++) await createFromText(storage(), '網飛 390')
    const created = await storage().getAll<SpendRecord>('records')
    // 最舊那筆讓資料跨度超過 minMonths × 30 天，月初月底都一樣
    const placed = [
      ...dates.map((date, i) => ({ ...created[i]!, merchant: '網飛', amount, date })),
      { ...created[3]!, merchant: '舊店', amount: 50, date: addDays(todayIso(), -100) },
    ]
    for (const r of placed) await storage().put('records', r)
    return dates
  }

  it('訂閱的依據也是日期新到舊（evidence 本身是月份舊到新）', async () => {
    const dates = await seedSubscription(390)

    const wrapper = await openAnalysis()
    await evidenceButton(wrapper, '訂閱與固定支出 · 依據：3 筆紀錄').trigger('click')

    expect(listOf(wrapper, '訂閱與固定支出 · 依據：3 筆紀錄').map((t) => t.slice(0, 10))).toEqual([...dates].reverse())
  })

  it('清單金額有千分位', async () => {
    const dates = await seedSubscription(1300)

    const wrapper = await openAnalysis()
    await evidenceButton(wrapper, '訂閱與固定支出 · 依據：3 筆紀錄').trigger('click')

    expect(listOf(wrapper, '訂閱與固定支出 · 依據：3 筆紀錄')[0]).toBe(`${dates[2]} · 網飛 · $1,300`)
  })

  it('改門檻、結論換了順序，展開的仍是同一條', async () => {
    await seedSmallFrequent()
    const wrapper = await openAnalysis()
    await evidenceButton(wrapper, '同類重複購買 · 依據：咖啡，共 10 筆紀錄').trigger('click')
    await button(wrapper, '調整判斷門檻 ▸').trigger('click')
    await field(wrapper, '高頻小額 · 觀察天數').setValue('10')

    await vi.waitFor(() =>
      expect(wrapper.findAll('button.evidence')[0]!.text()).toContain('高頻小額'),
    )
    expect(evidenceButton(wrapper, '同類重複購買 · 依據：咖啡，共 10 筆紀錄').attributes('aria-expanded')).toBe('true')
    expect(evidenceButton(wrapper, '高頻小額 · 依據：10 筆紀錄').attributes('aria-expanded')).toBe('false')
  })
})
