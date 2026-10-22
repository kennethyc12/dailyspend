import type { Category, Settings } from '@/models/types'

const BUILTIN_CATEGORIES: Array<Pick<Category, 'id' | 'name' | 'icon' | 'color'>> = [
  { id: 'food', name: '飲食', icon: '🍜', color: '#c9622f' },
  { id: 'drink', name: '飲料', icon: '🥤', color: '#2f8fc9' },
  { id: 'transport', name: '交通', icon: '🚌', color: '#4a6fa5' },
  { id: 'home', name: '居家', icon: '🏠', color: '#7a6a52' },
  { id: 'daily', name: '日用品', icon: '🧻', color: '#6b8f5e' },
  { id: 'fun', name: '娛樂', icon: '🎬', color: '#8e5ea2' },
  { id: 'subscription', name: '訂閱', icon: '🔁', color: '#2f8f7a' },
  { id: 'medical', name: '醫療', icon: '💊', color: '#b5495b' },
  { id: 'education', name: '教育', icon: '📚', color: '#3f7d8c' },
  { id: 'clothing', name: '服飾', icon: '👕', color: '#a4713f' },
  { id: 'social', name: '人情往來', icon: '🎁', color: '#c2548a' },
  { id: 'other', name: '其他', icon: '📦', color: '#6b655d' },
]

export function defaultCategories(now = Date.now()): Category[] {
  return BUILTIN_CATEGORIES.map((c, i) => ({
    ...c,
    parentId: null,
    isBuiltin: true,
    isActive: true,
    sortOrder: i * 10,
    updatedAt: now,
  }))
}

export function defaultSettings(now = Date.now()): Settings {
  return {
    key: 'settings',
    defaults: { qty: 1 },
    thresholds: {
      smallFrequent: { windowDays: 30, smallAmount: 150, minCount: 8 },
      subscription: { minMonths: 3, amountVariancePct: 10, maxMonthlyOccurrences: 2 },
      monthGrowth: { growthPct: 50, minDelta: 1000, minDaysThisMonth: 7 },
      repeatPurchase: { windowDays: 14, minRepeat: 3 },
      suggestion: { topN: 3 },
    },
    confidence: { pendingBelow: 0.6 },
    export: { delimiter: ',' },
    backup: { remindAfterDays: 7, lastBackupAt: null },
    platform: { persistGranted: null },
    photo: { maxEdge: 1600, thumbEdge: 320, quality: 0.8 },
    updatedAt: now,
  }
}

type Group = keyof Omit<Settings, 'key' | 'updatedAt'>

type Thresholds = Settings['thresholds']

/** 門檻全部是整數；max 只在會讓分析當掉或語意不成立時才設。 */
export interface ThresholdRange {
  min: number
  max?: number
}

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T]

export const THRESHOLD_RANGES: {
  [G in keyof Thresholds]: { [K in NumericKeys<Thresholds[G]>]: ThresholdRange }
} = {
  // 觀察天數太大會讓日期換算超出 Date 的範圍（RangeError）
  smallFrequent: { windowDays: { min: 1, max: 365 }, smallAmount: { min: 1 }, minCount: { min: 2 } },
  // minMonths 0 會讓沒有進行中區段的店家走到空陣列而當掉
  subscription: { minMonths: { min: 2 }, amountVariancePct: { min: 0 }, maxMonthlyOccurrences: { min: 1 } },
  // 紀錄金額恆 ≥ 0，minDelta ≥ 1 保證本期有紀錄、evidence 不會是空的
  monthGrowth: { growthPct: { min: 0 }, minDelta: { min: 1 }, minDaysThisMonth: { min: 1, max: 28 } },
  repeatPurchase: { windowDays: { min: 1, max: 365 }, minRepeat: { min: 2 } },
  suggestion: { topN: { min: 1 } },
}

export function isInThresholdRange(value: number, r: ThresholdRange): boolean {
  return Number.isInteger(value) && value >= r.min && (r.max === undefined || value <= r.max)
}

/** 冪等：clampThreshold(clampThreshold(x)) === clampThreshold(x)，seed 才不會每次都寫回。 */
export function clampThreshold(value: unknown, fallback: number, r: ThresholdRange): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), r.min), r.max ?? Infinity)
}

/**
 * 舊版 settings 補上新欄位。
 *
 * settings 是單一文件、不走 schema version，所以新增欄位時手機上的舊資料
 * 會缺鍵，讀回來直接是 undefined。每次開啟都跑一次合併，比寫 migration 便宜，
 * 也不怕漏跑。
 */
export function migrateSettings(stored: Partial<Settings> | undefined, now = Date.now()): Settings {
  const base = defaultSettings(now)
  if (!stored) return base

  const merged = { ...base, ...stored, key: 'settings' as const }

  for (const group of Object.keys(base) as Array<keyof Settings>) {
    if (group === 'key' || group === 'updatedAt') continue
    const defaults = base[group as Group]
    const value = stored[group as Group]
    if (typeof defaults === 'object' && defaults !== null) {
      merged[group as Group] = { ...defaults, ...(value ?? {}) } as never
    }
  }

  // thresholds 多一層，單層展開蓋不到；同時把範圍外的值夾回來，壞值會讓分析頁打不開。
  merged.thresholds = { ...base.thresholds }
  for (const key of Object.keys(base.thresholds) as Array<keyof Settings['thresholds']>) {
    // 還原的備份可能帶 null、字串或物件，讀進來的欄位不保證是 number
    const group: Record<string, unknown> = {
      ...base.thresholds[key],
      ...(stored.thresholds?.[key] ?? {}),
    }
    const defaults = base.thresholds[key] as Record<string, number>
    for (const [field, r] of Object.entries(THRESHOLD_RANGES[key]) as Array<[string, ThresholdRange]>) {
      group[field] = clampThreshold(group[field], defaults[field]!, r)
    }
    merged.thresholds[key] = group as never
  }

  return merged
}
