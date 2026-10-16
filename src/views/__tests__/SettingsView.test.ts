// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import SettingsView from '@/views/SettingsView.vue'
import type { Rule, Settings } from '@/models/types'
import { IndexedDbAdapter, setStorage } from '@/storage'
import { learnItemRule } from '@/services/entryService'
import { saveSample } from '@/services/sampleService'
import { photoFromFile } from '@/test/fixtures'
import { button, failPutOn, field, mountView, useViewTest, waitForText } from '@/test/mountView'
import { clearErrors, useErrorLog } from '@/errors/errorLog'
import { useStorageStatus } from '@/composables/useStorageStatus'

// jsdom 沒有 matchMedia；useDisplayMode 在 import 時就會用到
vi.hoisted(() => {
  const stub: Partial<MediaQueryList> = {
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }
  window.matchMedia = () => stub as MediaQueryList
})

const { storage } = useViewTest()

afterEach(() => vi.restoreAllMocks())

/**
 * 進頁並等初始化完成。useStorageStatus 的 settings 跨測試不重設，
 * 不能拿「照片壓縮」區塊出現當作載入完成。
 */
async function open() {
  const wrapper = await mountView(SettingsView, '/settings')
  await button(wrapper, '環境檢查 ▸').trigger('click')
  await waitForText(wrapper, 'dailyspend v1')
  return wrapper
}

function ruleRow(wrapper: VueWrapper, pattern: string) {
  return wrapper.findAll('li').find((l) => l.find('strong').exists() && l.find('strong').text() === pattern)
}

async function showBuiltin(wrapper: VueWrapper) {
  await button(wrapper, '內建').trigger('click')
  await vi.waitFor(() => button(wrapper, '停用'))
}

const savedQuality = async () =>
  (await storage().get<Settings>('settings', 'settings'))!.photo.quality

const saved = async () => (await storage().get<Settings>('settings', 'settings'))!

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('設定頁：既有行為', () => {
  it('停用內建規則，重新進頁仍是停用', async () => {
    const wrapper = await open()
    await showBuiltin(wrapper)
    const row = wrapper.findAll('li').find((l) => l.text().includes('停用'))!
    const pattern = row.find('strong').text()
    await row.findAll('button').find((b) => b.text() === '停用')!.trigger('click')
    await vi.waitFor(() => expect(ruleRow(wrapper, pattern)!.text()).toContain('啟用'))
    wrapper.unmount()

    const again = await open()
    await button(again, '內建').trigger('click')
    await vi.waitFor(() => expect(ruleRow(again, pattern)!.text()).toContain('啟用'))
  })

  it('刪除我修正的規則', async () => {
    await learnItemRule(storage(), [{ name: '甲甲' }], 0, 'food')
    const wrapper = await open()
    await waitForText(wrapper, '甲甲')
    await button(wrapper, '刪除').trigger('click')

    await waitForText(wrapper, '還沒有任何修正學來的規則。')
    const learned = (await storage().getAll<Rule>('rules')).filter((r) => r.origin === 'userCorrection')
    expect(learned).toEqual([])
  })

  it('刪除樣本', async () => {
    await saveSample(storage(), photoFromFile(new File(['x'], 's1')))
    const wrapper = await open()
    await waitForText(wrapper, '發票樣本 · 1 張')
    await button(wrapper, '刪除').trigger('click')
    await button(wrapper, '確定刪除').trigger('click')

    await waitForText(wrapper, '發票樣本 · 0 張')
    expect(wrapper.text()).toContain('還沒有樣本。')
  })

  it('改 JPEG 品質，重新進頁後是新值', async () => {
    const wrapper = await open()
    await field(wrapper, 'JPEG 品質（0–1）').setValue('0.5')
    await vi.waitFor(async () => expect(await savedQuality()).toBe(0.5), { timeout: 500 })
    wrapper.unmount()

    const again = await open()
    expect((field(again, 'JPEG 品質（0–1）').element as HTMLInputElement).value).toBe('0.5')
  })

  // 存完要把寫入的 settings 指派回頁面；少了這步，畫面與下一次比對用的都是舊值
  it('連改兩個照片壓縮欄位，重新進頁兩個都是新值', async () => {
    const wrapper = await open()
    await field(wrapper, 'JPEG 品質（0–1）').setValue('0.5')
    // 等頁面拿到寫入後的 settings；不等也不會互搶，見〈連改照片壓縮欄位〉
    await vi.waitFor(() => expect(useStorageStatus().settings.value?.photo.quality).toBe(0.5))
    await field(wrapper, '原圖長邊上限（px）').setValue('1200')
    await vi.waitFor(async () =>
      expect((await storage().get<Settings>('settings', 'settings'))!.photo.maxEdge).toBe(1200),
    )
    wrapper.unmount()

    const again = await open()
    expect((field(again, 'JPEG 品質（0–1）').element as HTMLInputElement).value).toBe('0.5')
    expect((field(again, '原圖長邊上限（px）').element as HTMLInputElement).value).toBe('1200')
  })

  it('環境檢查顯示資料庫正常', async () => {
    const wrapper = await open()

    expect(wrapper.text()).toContain('dailyspend v1')
  })
})

describe('設定頁：非預期錯誤（B5b）', () => {
  // jsdom 的 DOMException 不是 Error 子類，錯誤紀錄的 message 會是 '{}'，所以只斷言 where 與筆數
  const reportedWhere = () => useErrorLog().errors.value.map((e) => e.where)

  it('停用規則時寫入失敗：說明情境並記下錯誤', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await open()
    await showBuiltin(wrapper)
    failPutOn('rules')
    await button(wrapper, '停用').trigger('click')

    await waitForText(wrapper, '操作失敗。已記錄錯誤，可到設定頁的「非預期的錯誤」查看')
    expect(wrapper.find('.result.warn').text()).not.toContain('quota')
    expect(reportedWhere()).toEqual(['SettingsView.act'])
    clearErrors()
  })

  it('照片壓縮設定寫入失敗：說明情境並記下錯誤', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await open()
    failPutOn('settings')
    await field(wrapper, 'JPEG 品質（0–1）').setValue('0.5')

    await waitForText(wrapper, '照片壓縮設定儲存失敗。已記錄錯誤')
    expect(reportedWhere()).toEqual(['SettingsView.updatePhotoSetting'])
    clearErrors()
  })

  it('第一次開啟就空間不足：初始化失敗會記下錯誤', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.indexedDB = new IDBFactory()
    setStorage(new IndexedDbAdapter())
    failPutOn('categories')
    const wrapper = await mountView(SettingsView, '/settings')
    await vi.waitFor(() => expect(useStorageStatus().state.value).toBe('failed'))
    // 讓 onMounted 後面的讀取跑完，再數錯誤紀錄
    await new Promise((r) => setTimeout(r, 50))

    expect(reportedWhere()).toEqual(['useStorageStatus.initStorage'])
    await button(wrapper, '環境檢查 ▸').trigger('click')
    expect(wrapper.text()).not.toContain('dailyspend v1')
    clearErrors()
  })
})

describe('設定頁：連改照片壓縮欄位', () => {
  it('同步連改兩欄，兩個都存進去', async () => {
    const wrapper = await open()
    const quality = field(wrapper, 'JPEG 品質（0–1）').element as HTMLInputElement
    const maxEdge = field(wrapper, '原圖長邊上限（px）').element as HTMLInputElement
    quality.value = '0.5'
    quality.dispatchEvent(new Event('change'))
    maxEdge.value = '1200'
    maxEdge.dispatchEvent(new Event('change'))

    await vi.waitFor(async () => {
      const { photo } = await saved()
      expect([photo.quality, photo.maxEdge]).toEqual([0.5, 1200])
    })
  })

  it('重讀還沒完成時連改三欄，三個都存進去', async () => {
    const wrapper = await open()
    const estimate = deferred<StorageEstimate>()
    // jsdom 沒有 navigator.storage；讓舊程式的 initStorage 停在 estimateUsage（已過重讀 settings 那一步）
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: () => estimate.promise },
    })
    try {
      await field(wrapper, 'JPEG 品質（0–1）').setValue('0.5')
      await vi.waitFor(() => expect(useStorageStatus().settings.value?.photo.quality).toBe(0.5))
      await field(wrapper, '原圖長邊上限（px）').setValue('1200')
      await vi.waitFor(async () => expect((await saved()).photo.maxEdge).toBe(1200))
      await field(wrapper, '縮圖長邊（px）').setValue('400')
      await vi.waitFor(async () => expect((await saved()).photo.thumbEdge).toBe(400))

      expect((await saved()).photo).toEqual({ quality: 0.5, maxEdge: 1200, thumbEdge: 400 })
    } finally {
      estimate.resolve({ usage: 0, quota: 0 })
      await vi.waitFor(() => expect(useStorageStatus().state.value).not.toBe('running'))
      delete (navigator as { storage?: StorageManager }).storage
    }
  })

  it('失敗後下一次成功，錯誤訊息消失', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await open()
    failPutOn('settings')
    await field(wrapper, 'JPEG 品質（0–1）').setValue('0.5')
    await waitForText(wrapper, '照片壓縮設定儲存失敗')
    vi.restoreAllMocks()

    await field(wrapper, 'JPEG 品質（0–1）').setValue('0.6')
    await vi.waitFor(async () => expect(await savedQuality()).toBe(0.6))
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('照片壓縮設定儲存失敗'))
    clearErrors()
  })
})
