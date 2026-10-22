// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import RecordsView from '@/views/RecordsView.vue'
import type { SpendRecord } from '@/models/types'
import { confirmRecord, createFromText } from '@/services/entryService'
import { refreshRecords } from '@/composables/useRecords'
import { mountView, useViewTest, waitForText } from '@/test/mountView'

const { storage } = useViewTest()

async function textRecord(input: string): Promise<SpendRecord> {
  const result = await createFromText(storage(), input)
  if (!result.ok) throw new Error(`建立失敗：${result.blocked}`)
  return result.save.record
}

// records 是模組層級 shallowRef：不先 refresh，waitForText 會被上一個測試留下的資料滿足
async function openRecords() {
  await refreshRecords()
  const wrapper = await mountView(RecordsView, '/records')
  await waitForText(wrapper, '某店')
  return wrapper
}

const entryOf = (w: VueWrapper, merchant: string) =>
  w.findAll('a.entry').find((a) => a.find('.merchant').text().startsWith(merchant))!

describe('紀錄頁：未分類', () => {
  it('待確認又沒有類別：顯示「未分類 · 待確認」', async () => {
    const r = await textRecord('某店 100')
    expect(r).toMatchObject({ categoryId: null, status: 'pending' })
    const wrapper = await openRecords()
    // template 跨行，text() 在「未分類」後有兩個空白；瀏覽器渲染會合併，真機只看得到一個
    expect(entryOf(wrapper, '某店').find('.sub span:last-child').text()).toMatch(/^未分類\s+·\s+待確認$/)
  })

  it('確認過但沒有類別：顯示「未分類」，不出現「待確認」', async () => {
    await confirmRecord(storage(), await textRecord('某店 100'))
    const wrapper = await openRecords()
    const label = entryOf(wrapper, '某店').find('.sub span:last-child').text()
    expect(label).toBe('未分類')
  })

  it('搜「未分類」找得到沒有類別的紀錄，找不到有類別的', async () => {
    await textRecord('某店 100')
    const other = await textRecord('另一店 咖啡 55')
    expect(other.categoryId).not.toBeNull()
    const wrapper = await openRecords()
    await wrapper.find('input.search').setValue('未分類')
    const merchants = wrapper.findAll('.merchant').map((m) => m.text())
    expect(merchants).toEqual(['某店'])
  })
})
