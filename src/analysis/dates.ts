/** 全部以 `YYYY-MM-DD` 字串運算，避免時區把日期偏掉一天。 */

export function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return { y, m, d }
}

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addDays(iso: string, delta: number): string {
  const { y, m, d } = parseIso(iso)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return dt.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  const a = parseIso(from)
  const b = parseIso(to)
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000,
  )
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** `YYYY-MM-DD` → `YYYY-MM` */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function monthsBetweenKeys(from: string, to: string): number {
  const [ay, am] = from.split('-').map(Number) as [number, number]
  const [by, bm] = to.split('-').map(Number) as [number, number]
  return (by - ay) * 12 + (bm - am)
}

export interface Window {
  from: string
  to: string
  days: number
}

/** 近 N 天（含今天）。 */
export function recentWindow(today: string, days: number): Window {
  return { from: addDays(today, -(days - 1)), to: today, days }
}

export function inWindow(iso: string, w: Window): boolean {
  return iso >= w.from && iso <= w.to
}
