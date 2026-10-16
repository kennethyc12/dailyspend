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
  // 不斷言輸入框的值：寫入失敗不回滾是另一張 ticket，不把錯誤行為釘進測試
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
