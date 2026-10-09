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
    defaults: { date: 'today', categoryFallback: null, qty: 1 },
    parsing: { amountPosition: 'last', merchantDictEnabled: true },
    thresholds: {
      smallFrequent: { windowDays: 30, smallAmount: 150, minCount: 8 },
      subscription: { minMonths: 3, amountVariancePct: 10, maxMonthlyOccurrences: 2 },
      monthGrowth: { growthPct: 50, minDelta: 1000, minDaysThisMonth: 7 },
      repeatPurchase: { windowDays: 14, minRepeat: 3, similarity: 'exact' },
      suggestion: { topN: 3 },
    },
    confidence: { pendingBelow: 0.6 },
    export: { delimiter: ',', encoding: 'utf-8-bom' },
    backup: { remindAfterDays: 7, lastBackupAt: null },
    platform: { persistGranted: null },
    photo: { maxEdge: 1600, thumbEdge: 320, quality: 0.8 },
    updatedAt: now,
  }
}

type Group = keyof Omit<Settings, 'key' | 'updatedAt'>

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

  // thresholds 多一層，單層展開蓋不到。
  merged.thresholds = { ...base.thresholds }
  for (const key of Object.keys(base.thresholds) as Array<keyof Settings['thresholds']>) {
    merged.thresholds[key] = {
      ...base.thresholds[key],
      ...(stored.thresholds?.[key] ?? {}),
    } as never
  }

  return merged
}
