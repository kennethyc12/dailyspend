import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import type { Settings } from '@/models/types'
import {
  IndexedDbAdapter,
  THRESHOLD_RANGES,
  defaultSettings,
  isInThresholdRange,
  migrateSettings,
  seed,
  type ThresholdRange,
} from '@/storage'

const NOW = 1_760_000_000_000

type Thresholds = Settings['thresholds']

function withThresholds(patch: (t: Record<string, Record<string, number | string | null>>) => void): Settings {
  const s = defaultSettings(NOW)
  patch(s.thresholds as never as Record<string, Record<string, number | string | null>>)
  return s
}

afterEach(() => vi.restoreAllMocks())

describe('THRESHOLD_RANGES', () => {
  it('預設門檻都在範圍內', () => {
    const t = defaultSettings(NOW).thresholds as never as Record<string, Record<string, number>>
    for (const [group, fields] of Object.entries(THRESHOLD_RANGES)) {
      for (const [key, r] of Object.entries(fields as Record<string, ThresholdRange>)) {
        expect(isInThresholdRange(t[group]![key]!, r), `${group}.${key}`).toBe(true)
      }
    }
  })

  it.each([
    [1, true],
    [365, true],
    [0, false],
    [366, false],
    [2.5, false],
    [Number.NaN, false],
  ])('isInThresholdRange(%s, 1–365) → %s', (value, expected) => {
    expect(isInThresholdRange(value, { min: 1, max: 365 })).toBe(expected)
  })
})

describe('migrateSettings：門檻夾回範圍', () => {
  it.each([
    ['subscription', 'minMonths', 0, 2],
    ['smallFrequent', 'windowDays', 1e9, 365],
    ['suggestion', 'topN', -1, 1],
  ] as const)('%s.%s %s → %s', (group, key, stored, expected) => {
    const migrated = migrateSettings(withThresholds((t) => (t[group]![key] = stored)), NOW)

    expect((migrated.thresholds[group] as Record<string, number>)[key]).toBe(expected)
  })

  it('小數四捨五入', () => {
    const migrated = migrateSettings(withThresholds((t) => (t.smallFrequent!.minCount = 7.6)), NOW)

    expect(migrated.thresholds.smallFrequent.minCount).toBe(8)
  })

  it('null 與非數字退回預設', () => {
    const migrated = migrateSettings(
      withThresholds((t) => {
        t.subscription!.minMonths = null
        t.monthGrowth!.growthPct = 'x'
      }),
      NOW,
    )

    expect(migrated.thresholds.subscription.minMonths).toBe(3)
    expect(migrated.thresholds.monthGrowth.growthPct).toBe(50)
  })
})

describe('seed：修正已存的壞門檻', () => {
  let storage: IndexedDbAdapter

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory()
    storage = new IndexedDbAdapter()
    await seed(storage)
  })

  async function storeThresholds(patch: (t: Thresholds) => void) {
    const s = (await storage.get<Settings>('settings', 'settings'))!
    patch(s.thresholds)
    await storage.put('settings', s)
  }

  /** 裝上 spy，回傳「目前為止對 settings store 的 put 次數」。 */
  const spyOnSettingsPuts = () => {
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put')
    return () => spy.mock.contexts.filter((c) => (c as IDBObjectStore).name === 'settings').length
  }

  const storedMinMonths = async () =>
    (await storage.get<Settings>('settings', 'settings'))!.thresholds.subscription.minMonths

  it('壞值修好並寫回', async () => {
    await storeThresholds((t) => (t.subscription.minMonths = 0))

    await seed(storage)
    expect(await storedMinMonths()).toBe(2)
  })

  // 下面兩個 it 斷言 put 0 次；這裡先證明計次抓得到寫回，寫入方式改變時才不會靜默變綠
  it('壞值第一次修正時計次為 1', async () => {
    await storeThresholds((t) => (t.subscription.minMonths = 0))

    const puts = spyOnSettingsPuts()
    await seed(storage)
    expect(puts()).toBe(1)
  })

  it('修好之後再開一次，不再寫回', async () => {
    await storeThresholds((t) => (t.subscription.minMonths = 0))
    await seed(storage)
    expect(await storedMinMonths()).toBe(2)

    const puts = spyOnSettingsPuts()
    await seed(storage)
    expect(puts()).toBe(0)
  })

  it('合法的自訂值不會寫回', async () => {
    await storeThresholds((t) => (t.suggestion.topN = 9))

    const puts = spyOnSettingsPuts()
    await seed(storage)
    expect(puts()).toBe(0)
  })
})
