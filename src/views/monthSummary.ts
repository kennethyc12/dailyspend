import type { Category, SpendRecord } from '@/models/types'
import { monthKey } from '@/analysis/dates'

export interface MonthSummary {
  count: number
  total: number
  pendingCount: number
  /** 金額大到小；0 元的類別不列。categoryId null 是未分類。 */
  byCategory: { categoryId: string | null; total: number }[]
}

/** 本月 = today 所在的自然月，以紀錄的消費日期判斷（不是匯入時間）；同月的未來日期也算。 */
export function summarizeMonth(records: SpendRecord[], categories: Category[], today: string): MonthSummary {
  const month = monthKey(today)
  const inMonth = records.filter((r) => monthKey(r.date) === month)

  const sums = new Map<string | null, number>()
  for (const r of inMonth) sums.set(r.categoryId, (sums.get(r.categoryId) ?? 0) + r.amount)

  const order = new Map(categories.map((c) => [c.id, c.sortOrder]))
  // 同額時的順序要固定：有 sortOrder 的依它，未分類其次，找不到類別的 id（舊備份）最後、依 id
  const rank = (id: string | null) => (id === null ? 1 : order.has(id) ? 0 : 2)
  const byCategory = [...sums]
    .filter(([, total]) => total > 0)
    .map(([categoryId, total]) => ({ categoryId, total }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        rank(a.categoryId) - rank(b.categoryId) ||
        (order.get(a.categoryId ?? '') ?? 0) - (order.get(b.categoryId ?? '') ?? 0) ||
        (a.categoryId ?? '').localeCompare(b.categoryId ?? ''),
    )

  return {
    count: inMonth.length,
    total: inMonth.reduce((s, r) => s + r.amount, 0),
    pendingCount: inMonth.filter((r) => r.status === 'pending').length,
    byCategory,
  }
}
