// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbAdapter, setStorage } from '@/storage'
import type { Settings } from '@/models/types'
import { initStorage, useStorageStatus } from '@/composables/useStorageStatus'
import { updateSettings } from '@/services/settingsService'
import { deferred } from '@/test/fixtures'
import { failPutOn } from '@/test/mountView'
import { clearErrors, useErrorLog } from '@/errors/errorLog'

const EMPTY_ESTIMATE: StorageEstimate = { usage: 0, quota: 0 }

let storage: IndexedDbAdapter

// 不用 useViewTest：它會先 seed，這裡要讓 initStorage 自己 seed 一個空的 DB
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
  setStorage(storage)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await vi.waitFor(() => expect(state()).not.toBe('running'))
  delete (navigator as { storage?: StorageManager }).storage
  const leaked = useErrorLog().errors.value.map((e) => e.message)
  clearErrors()
  expect(leaked).toEqual([])
})

const flush = () => new Promise((r) => setTimeout(r, 0))
const state = () => useStorageStatus().state.value
const saved = async () => (await storage.get<Settings>('settings', 'settings'))!
const reportedWhere = () => useErrorLog().errors.value.map((e) => e.where)

function stubStorageManager(s: Partial<StorageManager>) {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: s })
}

function holdEstimate() {
  const est = deferred<StorageEstimate>()
  const estimate = vi.fn(() => est.promise)
  stubStorageManager({ estimate })
  return { estimate, release: () => est.resolve(EMPTY_ESTIMATE) }
}

function holdPersist() {
  const granted = deferred<boolean>()
  const persist = vi.fn(() => granted.promise)
  stubStorageManager({
    persisted: async () => false,
    persist,
    estimate: async () => EMPTY_ESTIMATE,
  })
  return { persist, grant: () => granted.resolve(true) }
}

describe('initStorage：執行中再呼叫', () => {
  it('要等到排隊那一輪跑完才 resolve', async () => {
    const { estimate, release } = holdEstimate()
    void initStorage()
    try {
      await vi.waitFor(() => expect(estimate).toHaveBeenCalledTimes(1))
      let done = false
      const second = initStorage().then(() => (done = true))
      await flush()
      expect(done).toBe(false)

      release()
      await second
      expect(estimate).toHaveBeenCalledTimes(2)
    } finally {
      release()
    }
  })

  it('上一輪剛結束、排隊那一輪還沒開始時呼叫，也併進排隊那一輪', async () => {
    const { estimate, release } = holdEstimate()
    const first = initStorage()
    let gap: Promise<void> | undefined
    // 同一個 promise 的 reaction 依登記順序執行：這個 then 比 rerun 先跑，正好落在縫隙裡
    const gapCall = first.then(() => {
      gap = initStorage()
    })
    try {
      await vi.waitFor(() => expect(estimate).toHaveBeenCalledTimes(1))
      const queued = initStorage()
      release()
      await gapCall
      await Promise.all([queued, gap])
      expect(estimate).toHaveBeenCalledTimes(2)
    } finally {
      release()
    }
  })

  it('執行中連續呼叫三次，只多跑一輪', async () => {
    const { estimate, release } = holdEstimate()
    void initStorage()
    try {
      await vi.waitFor(() => expect(estimate).toHaveBeenCalledTimes(1))
      const calls = [initStorage(), initStorage(), initStorage()]
      release()
      await Promise.all(calls)
      expect(estimate).toHaveBeenCalledTimes(2)
    } finally {
      release()
    }
  })
})

describe('initStorage：失敗', () => {
  it('failed 之後下一次呼叫會重跑', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    failPutOn('categories')
    await initStorage()
    expect(state()).toBe('failed')

    vi.restoreAllMocks()
    await initStorage()
    clearErrors()
    expect(state()).toBe('ready')
  })

  it('第一輪失敗，排隊那一輪照樣跑', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { persist, grant } = holdPersist()
    const first = initStorage()
    try {
      await vi.waitFor(() => expect(persist).toHaveBeenCalled())
      const queued = initStorage()
      failPutOn('settings')
      grant()
      await Promise.all([first, queued])
      expect(state()).toBe('failed')
      expect(reportedWhere()).toEqual(['useStorageStatus.initStorage', 'useStorageStatus.initStorage'])
      clearErrors()

      vi.restoreAllMocks()
      await initStorage()
      expect(state()).toBe('ready')
    } finally {
      grant()
    }
  })
})

describe('initStorage：寫回 persistGranted', () => {
  it('等 persist 期間改了門檻，寫回不會蓋掉', async () => {
    const { persist, grant } = holdPersist()
    const run = initStorage()
    try {
      await vi.waitFor(() => expect(persist).toHaveBeenCalled())
      await updateSettings(storage, (s) => ({
        ...s,
        thresholds: { ...s.thresholds, suggestion: { topN: 7 } },
      }))
      grant()
      await run

      const s = await saved()
      expect(s.thresholds.suggestion.topN).toBe(7)
      expect(s.platform.persistGranted).toBe(true)
      expect(useStorageStatus().settings.value?.thresholds.suggestion.topN).toBe(7)
    } finally {
      grant()
    }
  })

  it('等 persist 期間 settings 被刪掉：初始化失敗，不把舊的寫回去', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { persist, grant } = holdPersist()
    const run = initStorage()
    try {
      await vi.waitFor(() => expect(persist).toHaveBeenCalled())
      await storage.delete('settings', 'settings')
      grant()
      await run

      expect(state()).toBe('failed')
      expect(reportedWhere()).toEqual(['useStorageStatus.initStorage'])
      clearErrors()
    } finally {
      grant()
    }
  })
})
