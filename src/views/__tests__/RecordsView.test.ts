// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBObjectStore } from 'fake-indexeddb'
import type { VueWrapper } from '@vue/test-utils'
import RecordsView from '@/views/RecordsView.vue'
import type { SpendRecord } from '@/models/types'
import { confirmRecord, createFromText, deleteRecord } from '@/services/entryService'
import { categoryName, pendingRecords, refreshRecords } from '@/composables/useRecords'
import { button, mountView, useViewTest, waitForText } from '@/test/mountView'
import { clearErrors } from '@/errors/errorLog'
import { saveFile } from '@/backup/share'

vi.mock('@/backup/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/backup/share')>()),
  saveFile: vi.fn(async () => 'downloaded' as const),
}))

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

describe('紀錄頁：多選刪除', () => {
  async function seedRecords() {
    const a = await textRecord('甲店 咖啡 55')
    const b = await textRecord('乙店 咖啡 60')
    const c = await textRecord('丙店 咖啡 70')
    return { a, b, c }
  }

  async function openWith(merchant: string) {
    await refreshRecords()
    const wrapper = await mountView(RecordsView, '/records')
    await waitForText(wrapper, merchant)
    return wrapper
  }

  const pickOf = (w: VueWrapper, merchant: string) =>
    w
      .findAll('label.entry')
      .find((l) => l.find('.merchant').text().startsWith(merchant))!
      .find<HTMLInputElement>('input[type="checkbox"]')

  async function pick(w: VueWrapper, ...merchants: string[]) {
    for (const m of merchants) await pickOf(w, m).setValue(true)
  }

  async function toConfirm(w: VueWrapper, n: number) {
    await button(w, `刪除 ${n} 筆`).trigger('click')
    await waitForText(w, '① 先存下目前資料的保險備份')
  }

  async function saveSafety(w: VueWrapper) {
    await button(w, '① 先存下目前資料的保險備份').trigger('click')
    await waitForText(w, '已存下保險備份')
  }

  const merchants = async () =>
    (await storage().getAll<SpendRecord>('records')).map((r) => r.merchant).sort()

  it('勾兩筆：底部顯示已選筆數與合計', async () => {
    await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店', '乙店')
    await waitForText(wrapper, '已選 2 筆 · $115')
  })

  it('搜尋後全選只勾到搜尋結果；改關鍵字後勾選清空', async () => {
    await seedRecords()
    const wrapper = await openWith('甲店')
    await wrapper.find('input.search').setValue('甲')
    await button(wrapper, '選取').trigger('click')
    await button(wrapper, '全選目前結果').trigger('click')
    await waitForText(wrapper, '已選 1 筆 · $55')

    await wrapper.find('input.search').setValue('')
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('已選'))
    expect(pickOf(wrapper, '甲店').element.checked).toBe(false)
  })

  it('勾選的紀錄被別處刪掉：已選筆數與合計跟著減少', async () => {
    const { a } = await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店', '乙店')
    await waitForText(wrapper, '已選 2 筆 · $115')

    await deleteRecord(storage(), a)
    await refreshRecords()
    await waitForText(wrapper, '已選 1 筆 · $60')
  })

  it('唯一勾選的紀錄被別處刪掉：底部列消失，不留「已選 0 筆」', async () => {
    const { a } = await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店')
    await waitForText(wrapper, '已選 1 筆 · $55')

    await deleteRecord(storage(), a)
    await refreshRecords()
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('已選'))
  })

  it('選取模式點整列就能勾選，再點一次取消', async () => {
    await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    const row = () => wrapper.findAll('label.entry').find((l) => l.find('.merchant').text().startsWith('甲店'))!
    await row().find('.merchant').trigger('click')
    await waitForText(wrapper, '已選 1 筆 · $55')
    await row().trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('已選'))
  })

  it('沒存保險備份前不能確認；分享取消後仍不能確認', async () => {
    await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店')
    await toConfirm(wrapper, 1)
    expect(button(wrapper, '② 確認刪除 1 筆').attributes('disabled')).toBeDefined()

    vi.mocked(saveFile).mockClear()
    vi.mocked(saveFile).mockResolvedValueOnce('cancelled')
    await button(wrapper, '① 先存下目前資料的保險備份').trigger('click')
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(button(wrapper, '② 確認刪除 1 筆').attributes('disabled')).toBeDefined()
  })

  it('存下保險備份後確認：只刪勾選的，照片一起刪，顯示已刪除筆數', async () => {
    const { a } = await seedRecords()
    await storage().put('photos', {
      id: 'p1',
      blob: new Blob(['x']),
      thumbBlob: new Blob(['t']),
      width: 1,
      height: 1,
      bytes: 1,
      capturedAt: 0,
    })
    await storage().put('records', { ...a, photoId: 'p1' })
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店', '乙店')
    await toConfirm(wrapper, 2)
    await saveSafety(wrapper)
    await button(wrapper, '② 確認刪除 2 筆').trigger('click')

    await waitForText(wrapper, '已刪除 2 筆')
    expect(await merchants()).toEqual(['丙店'])
    expect(await storage().count('photos')).toBe(0)
    // done 在 refresh 之前就設了，等「已刪除」不代表列表已重讀
    await vi.waitFor(() => expect(wrapper.findAll('a.entry')).toHaveLength(1))
  })

  it('確認步驟中勾選的紀錄被別處刪掉：文案維持確認時的數字，結果顯示實刪筆數', async () => {
    const { a } = await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店', '乙店')
    await toConfirm(wrapper, 2)

    await deleteRecord(storage(), a)
    await refreshRecords()
    await vi.waitFor(() => expect(wrapper.findAll('label.entry')).toHaveLength(2))
    expect(wrapper.text()).toContain('刪除 2 筆紀錄，共 $115。')

    await saveSafety(wrapper)
    await button(wrapper, '② 確認刪除 2 筆').trigger('click')
    await waitForText(wrapper, '已刪除 1 筆')
    expect(await merchants()).toEqual(['丙店'])
  })

  it('勾選含照片與發票：確認文案列出照片數與發票數', async () => {
    const { a, b } = await seedRecords()
    await storage().put('records', { ...a, photoId: 'p1' })
    await storage().put('records', { ...b, invoiceKey: '11509-ZZ00000001' })
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店', '乙店')
    await toConfirm(wrapper, 2)
    expect(wrapper.text()).toContain('其中 1 筆附有發票照片，會一起刪除。')
    expect(wrapper.text()).toContain('其中 1 筆是發票，之後重新匯入或重掃會再出現。')
    expect(wrapper.text()).toContain('學到的分類規則不會刪除，可到設定 › 規則刪除。')
  })

  it('勾選沒有照片也沒有發票：不出現照片句與發票句', async () => {
    await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店')
    await toConfirm(wrapper, 1)
    expect(wrapper.text()).toContain('刪除 1 筆紀錄，共 $55。')
    expect(wrapper.text()).not.toContain('附有發票照片')
    expect(wrapper.text()).not.toContain('重新匯入或重掃')
  })

  it('沒有關鍵字時全選後刪除：清單清空', async () => {
    await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await button(wrapper, '全選目前結果').trigger('click')
    await toConfirm(wrapper, 3)
    await saveSafety(wrapper)
    await button(wrapper, '② 確認刪除 3 筆').trigger('click')

    await waitForText(wrapper, '已刪除 3 筆')
    expect(await storage().count('records')).toBe(0)
    await waitForText(wrapper, '還沒有任何紀錄')
  })

  it('勾選含待確認紀錄：刪除後待確認數字減少', async () => {
    await seedRecords()
    await textRecord('某店 100')
    const wrapper = await openWith('某店')
    expect(pendingRecords.value).toHaveLength(1)
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '某店')
    await toConfirm(wrapper, 1)
    await saveSafety(wrapper)
    await button(wrapper, '② 確認刪除 1 筆').trigger('click')

    await waitForText(wrapper, '已刪除 1 筆')
    await vi.waitFor(() => expect(pendingRecords.value).toHaveLength(0))
  })

  it('保險備份組檔失敗：說明情境並記下錯誤，勾選保留可再按', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await seedRecords()
    const wrapper = await openWith('甲店')
    await button(wrapper, '選取').trigger('click')
    await pick(wrapper, '甲店')

    const real = IDBObjectStore.prototype.getAll
    const spy = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['getAll']>
    ) {
      if (this.name === 'photos') throw new DOMException('boom', 'UnknownError')
      return real.apply(this, args)
    })
    await button(wrapper, '刪除 1 筆').trigger('click')
    await waitForText(wrapper, '準備保險備份失敗')
    spy.mockRestore()

    expect(wrapper.text()).not.toContain('① 先存下目前資料的保險備份')
    expect(pickOf(wrapper, '甲店').element.checked).toBe(true)
    expect(button(wrapper, '刪除 1 筆').attributes('disabled')).toBeUndefined()
    expect(await storage().count('records')).toBe(3)
    clearErrors()
    vi.restoreAllMocks()
  })
})

describe('紀錄頁：本月總覽（month-overview）', () => {
  beforeEach(() => {
    // 只假 Date：fake-indexeddb 與 vi.waitFor 靠 timers，全假會卡住
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 15, 12) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openOverview() {
    await refreshRecords()
    const wrapper = await mountView(RecordsView, '/records')
    await vi.waitFor(() => expect(wrapper.find('section.month').exists()).toBe(true))
    return wrapper
  }

  const monthText = (w: VueWrapper) => w.find('section.month').text()

  it('標題帶月份；只算本月，類別列含「未分類」', async () => {
    await textRecord('某店 100')
    const drink = await textRecord('另一店 咖啡 55')
    await textRecord('10/05 上月店 咖啡 999')
    const wrapper = await openOverview()

    const text = monthText(wrapper)
    expect(text).toContain('本月 · 11 月')
    expect(text).toContain('2 筆 · $155')
    const rows = wrapper.findAll('section.month li').map((li) => li.text())
    expect(rows).toEqual([
      expect.stringContaining('未分類'),
      expect.stringContaining(categoryName.value(drink.categoryId)),
    ])
    expect(rows[0]).toContain('$100')
    expect(rows[1]).toContain('$55')
    expect(rows[1]).not.toContain(drink.categoryId!)
  })

  it('個位數月份不補 0：3 月顯示「本月 · 3 月」', async () => {
    vi.setSystemTime(new Date(2026, 2, 10, 12))
    await textRecord('某店 100')
    const wrapper = await openOverview()
    expect(monthText(wrapper)).toContain('本月 · 3 月')
  })

  it('有待確認：顯示「其中 N 筆待確認」；全部確認後沒有這行', async () => {
    const pending = await textRecord('某店 100')
    await confirmRecord(storage(), await textRecord('另一店 咖啡 55'))
    const wrapper = await openOverview()
    expect(monthText(wrapper)).toContain('其中 1 筆待確認')

    await confirmRecord(storage(), pending)
    await refreshRecords()
    await vi.waitFor(() => expect(monthText(wrapper)).not.toContain('待確認'))
  })

  it('搜尋與選取模式不影響數字', async () => {
    await textRecord('某店 100')
    await textRecord('另一店 咖啡 55')
    const wrapper = await openOverview()
    const before = monthText(wrapper)

    await wrapper.find('input.search').setValue('另一店')
    expect(wrapper.find('.toolbar').text()).toContain('1 筆')
    expect(monthText(wrapper)).toBe(before)

    await button(wrapper, '選取').trigger('click')
    expect(monthText(wrapper)).toBe(before)
  })

  it('只有上月紀錄：「本月還沒有紀錄」', async () => {
    await textRecord('10/05 上月店 咖啡 999')
    const wrapper = await openOverview()
    expect(monthText(wrapper)).toContain('本月還沒有紀錄')
    expect(wrapper.find('section.month li').exists()).toBe(false)
  })

  it('完全沒有紀錄：不顯示 panel', async () => {
    await refreshRecords()
    const wrapper = await mountView(RecordsView, '/records')
    await waitForText(wrapper, '還沒有任何紀錄')
    expect(wrapper.find('section.month').exists()).toBe(false)
  })

  it('刪除一筆本月紀錄後 panel 更新', async () => {
    await textRecord('某店 100')
    const other = await textRecord('另一店 咖啡 55')
    const wrapper = await openOverview()
    expect(monthText(wrapper)).toContain('2 筆 · $155')

    await deleteRecord(storage(), other)
    await refreshRecords()
    await vi.waitFor(() => expect(monthText(wrapper)).toContain('1 筆 · $100'))
  })
})
