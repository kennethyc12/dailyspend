import type { Category, Settings, SpendRecord } from '@/models/types'
import { normalizeInput } from '@/parsing/quickInput'
import {
  addDays,
  daysBetween,
  daysInMonth,
  inWindow,
  monthKey,
  monthsBetweenKeys,
  parseIso,
  recentWindow,
  shiftMonthKey,
  toIso,
  type Window,
} from './dates'
import type { AnalysisResult, Finding, InsufficientData } from './types'

type Thresholds = Settings['thresholds']

const MERCHANT_CAVEAT =
  '店家名稱不一致會影響訂閱偵測（Netflix / 網飛 / netflix 會被當成三個店家），建議輸入時固定寫法。'

function norm(s: string): string {
  return normalizeInput(s).toLowerCase()
}

function perMonth(total: number, days: number): number {
  return Math.round((total / days) * 30)
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** 變異係數（%）。平均為 0 時視為無變異。 */
function variationPct(xs: number[]): number {
  const m = mean(xs)
  if (m === 0) return 0
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
  return (sd / m) * 100
}

function nameOf(categories: Category[], id: string | null): string {
  if (id === null) return '待確認'
  return categories.find((c) => c.id === id)?.name ?? id
}

// ─── 高頻小額 ────────────────────────────────────────────────────────────────

function smallFrequent(
  records: SpendRecord[],
  categories: Category[],
  t: Thresholds['smallFrequent'],
  today: string,
): { findings: Finding[]; insufficient: InsufficientData[] } {
  const w = recentWindow(today, t.windowDays)
  const inRange = records.filter((r) => inWindow(r.date, w))

  if (inRange.length < 10) {
    return {
      findings: [],
      insufficient: [
        {
          kind: 'smallFrequent',
          message: `再記 ${10 - inRange.length} 筆就能分析高頻小額`,
        },
      ],
    }
  }

  const groups = new Map<string, SpendRecord[]>()
  for (const r of inRange) {
    if (r.categoryId === null || r.amount > t.smallAmount) continue
    const list = groups.get(r.categoryId)
    if (list) list.push(r)
    else groups.set(r.categoryId, [r])
  }

  const findings: Finding[] = []
  for (const [categoryId, rs] of groups) {
    if (rs.length < t.minCount) continue
    const total = rs.reduce((s, r) => s + r.amount, 0)
    findings.push({
      kind: 'smallFrequent',
      title: `${nameOf(categories, categoryId)}：${t.windowDays} 天內 ${rs.length} 筆小額消費`,
      detail: `每筆不超過 $${t.smallAmount}，合計 $${total}（${w.from} ～ ${w.to}）`,
      monthlyEquivalent: perMonth(total, w.days),
      estimated: false,
      evidence: { recordIds: rs.map((r) => r.id) },
    })
  }
  return { findings, insufficient: [] }
}

// ─── 訂閱與固定支出 ──────────────────────────────────────────────────────────

interface MonthBucket {
  key: string
  records: SpendRecord[]
  total: number
}

/**
 * 取最長的連續月份區段，且必須延伸到本月或上月。
 *
 * 「連續 N 個月」若寫死成「含本月的最近 N 個月」，每個月初都會漏抓——訂閱
 * 那天還沒扣款。改成找最長連續區段、再要求它仍在進行，月初月底結果一致。
 */
function activeRun(buckets: MonthBucket[], thisMonth: string): MonthBucket[] {
  const sorted = [...buckets].sort((a, b) => a.key.localeCompare(b.key))
  const runs: MonthBucket[][] = []
  for (const b of sorted) {
    const current = runs[runs.length - 1]
    if (current && monthsBetweenKeys(current[current.length - 1]!.key, b.key) === 1) current.push(b)
    else runs.push([b])
  }

  const lastMonth = shiftMonthKey(thisMonth, -1)
  const active = runs.filter((run) => {
    const end = run[run.length - 1]!.key
    return end === thisMonth || end === lastMonth
  })
  if (active.length === 0) return []
  return active.reduce((a, b) => (b.length > a.length ? b : a))
}

function subscription(
  records: SpendRecord[],
  t: Thresholds['subscription'],
  today: string,
): { findings: Finding[]; insufficient: InsufficientData[] } {
  if (records.length === 0) {
    return {
      findings: [],
      insufficient: [
        { kind: 'subscription', message: `還需 ${t.minMonths * 30} 天資料才能偵測訂閱` },
      ],
    }
  }

  const earliest = records.reduce((a, r) => (r.date < a ? r.date : a), records[0]!.date)
  const spanDays = daysBetween(earliest, today)
  const needDays = t.minMonths * 30
  if (spanDays < needDays) {
    return {
      findings: [],
      insufficient: [
        { kind: 'subscription', message: `還需 ${needDays - spanDays} 天資料才能偵測訂閱` },
      ],
    }
  }

  const byMerchant = new Map<string, Map<string, SpendRecord[]>>()
  for (const r of records) {
    if (!r.merchant) continue
    const key = norm(r.merchant)
    const months = byMerchant.get(key) ?? new Map<string, SpendRecord[]>()
    const mk = monthKey(r.date)
    months.set(mk, [...(months.get(mk) ?? []), r])
    byMerchant.set(key, months)
  }

  const thisMonth = monthKey(today)
  const findings: Finding[] = []

  for (const [, months] of byMerchant) {
    const buckets: MonthBucket[] = [...months.entries()].map(([key, rs]) => ({
      key,
      records: rs,
      total: rs.reduce((s, r) => s + r.amount, 0),
    }))

    const run = activeRun(buckets, thisMonth)
    if (run.length < t.minMonths) continue

    // 條件 2：訂閱的特徵是每月固定少數幾次，不是金額穩定。
    // 這條擋掉「每天去、金額一樣」的早餐店，讓它歸到高頻小額。
    if (run.some((b) => b.records.length < 1 || b.records.length > t.maxMonthlyOccurrences)) {
      continue
    }

    const recent = run.slice(-t.minMonths)
    if (variationPct(recent.map((b) => b.total)) > t.amountVariancePct) continue

    const evidenceRecords = recent.flatMap((b) => b.records)
    const label = evidenceRecords[evidenceRecords.length - 1]!.merchant
    findings.push({
      kind: 'subscription',
      title: `${label}：連續 ${run.length} 個月固定支出`,
      detail: `${recent[0]!.key} ～ ${recent[recent.length - 1]!.key}，每月 ${recent.map((b) => `$${b.total}`).join('、')}`,
      monthlyEquivalent: Math.round(mean(recent.map((b) => b.total))),
      estimated: false,
      evidence: { recordIds: evidenceRecords.map((r) => r.id) },
    })
  }

  return { findings, insufficient: [] }
}

// ─── 月對月暴增 ──────────────────────────────────────────────────────────────

function monthGrowth(
  records: SpendRecord[],
  categories: Category[],
  t: Thresholds['monthGrowth'],
  today: string,
): { findings: Finding[]; insufficient: InsufficientData[] } {
  const { y, m, d } = parseIso(today)
  if (d < t.minDaysThisMonth) {
    return {
      findings: [],
      insufficient: [
        { kind: 'monthGrowth', message: `本月還需 ${t.minDaysThisMonth - d} 天資料才能比較` },
      ],
    }
  }

  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  // 上月天數不足時對齊到月底（3/31 比 2 月只能比到 2/28）。
  const prevD = Math.min(d, daysInMonth(prevY, prevM))
  const aligned = prevD !== d

  const cur: Window = { from: toIso(y, m, 1), to: toIso(y, m, d), days: d }
  const prev: Window = { from: toIso(prevY, prevM, 1), to: toIso(prevY, prevM, prevD), days: prevD }

  // 門檻看的是「上月整月有沒有紀錄」（§8.4 的字面），比較用的才是對齊區間。
  // 若門檻也用對齊區間，9/25 才花錢的情況會顯示「上個月沒有紀錄」——那是錯的。
  const prevMonthKey = `${prevY}-${String(prevM).padStart(2, '0')}`
  if (!records.some((r) => monthKey(r.date) === prevMonthKey)) {
    return {
      findings: [],
      insufficient: [{ kind: 'monthGrowth', message: '上個月沒有紀錄，下個月開始可比較' }],
    }
  }

  const prevRecords = records.filter((r) => inWindow(r.date, prev))

  const sum = (rs: SpendRecord[]) => rs.reduce((s, r) => s + r.amount, 0)
  const curRecords = records.filter((r) => inWindow(r.date, cur))
  const ids = new Set<string | null>([
    ...curRecords.map((r) => r.categoryId),
    ...prevRecords.map((r) => r.categoryId),
  ])

  const range = `${cur.from.slice(5)}–${cur.to.slice(5)} vs ${prev.from.slice(5)}–${prev.to.slice(5)}`
  const alignNote = aligned ? `（比較區間已對齊至 ${prev.to.slice(5)}）` : ''

  const findings: Finding[] = []
  for (const categoryId of ids) {
    if (categoryId === null) continue
    const inCur = curRecords.filter((r) => r.categoryId === categoryId)
    const inPrev = prevRecords.filter((r) => r.categoryId === categoryId)
    const curSum = sum(inCur)
    const prevSum = sum(inPrev)
    const delta = curSum - prevSum
    if (delta < t.minDelta) continue

    // 上期為 0 時成長率無定義，視為新增支出，只看絕對增額。
    const isNew = prevSum === 0
    if (!isNew && (delta / prevSum) * 100 < t.growthPct) continue

    const pct = isNew ? '新增' : `+${Math.round((delta / prevSum) * 100)}%`
    findings.push({
      kind: 'monthGrowth',
      title: `${nameOf(categories, categoryId)}：${pct}`,
      detail: `${range}，$${prevSum} → $${curSum}（增加 $${delta}）${alignNote}`,
      monthlyEquivalent: perMonth(delta, cur.days),
      estimated: false,
      evidence: { recordIds: inCur.map((r) => r.id) },
    })
  }

  return { findings, insufficient: [] }
}

// ─── 同類重複購買 ────────────────────────────────────────────────────────────

function repeatPurchase(
  records: SpendRecord[],
  t: Thresholds['repeatPurchase'],
  today: string,
): { findings: Finding[]; insufficient: InsufficientData[] } {
  const w = recentWindow(today, t.windowDays)
  const inRange = records.filter((r) => inWindow(r.date, w))

  if (inRange.length < 5) {
    return {
      findings: [],
      insufficient: [
        { kind: 'repeatPurchase', message: `再記 ${5 - inRange.length} 筆就能分析重複購買` },
      ],
    }
  }

  interface Hit {
    label: string
    recordIds: string[]
    total: number
    estimated: boolean
  }
  const hits = new Map<string, Hit>()

  for (const r of inRange) {
    for (const item of r.items) {
      const key = norm(item.name)
      if (!key) continue
      // v1 手輸沒有單品金額，用單據總額平均分攤。這是估算，僅供排序，
      // 所以標記 estimated，UI 顯示「約」。
      const share = item.amount ?? Math.round(r.amount / r.items.length)
      const hit = hits.get(key) ?? { label: item.name, recordIds: [], total: 0, estimated: false }
      hit.recordIds.push(r.id)
      hit.total += share
      hit.estimated ||= item.amount === null
      hits.set(key, hit)
    }
  }

  const findings: Finding[] = []
  for (const hit of hits.values()) {
    if (hit.recordIds.length < t.minRepeat) continue
    findings.push({
      kind: 'repeatPurchase',
      title: `${hit.label}：${t.windowDays} 天內買了 ${hit.recordIds.length} 次`,
      detail: `合計${hit.estimated ? '約' : ''} $${hit.total}（${w.from} ～ ${w.to}）`,
      monthlyEquivalent: perMonth(hit.total, w.days),
      estimated: hit.estimated,
      evidence: { recordIds: [...new Set(hit.recordIds)], itemNames: [hit.label] },
    })
  }

  return { findings, insufficient: [] }
}

// ─── 入口 ────────────────────────────────────────────────────────────────────

export function analyze(
  records: SpendRecord[],
  categories: Category[],
  thresholds: Thresholds,
  today: string,
  now = Date.now(),
): AnalysisResult {
  const parts = [
    smallFrequent(records, categories, thresholds.smallFrequent, today),
    subscription(records, thresholds.subscription, today),
    monthGrowth(records, categories, thresholds.monthGrowth, today),
    repeatPurchase(records, thresholds.repeatPurchase, today),
  ]

  const findings = parts
    .flatMap((p) => p.findings)
    .sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent)

  return {
    findings,
    suggestions: findings.slice(0, thresholds.suggestion.topN),
    insufficient: parts.flatMap((p) => p.insufficient),
    caveats: records.length > 0 ? [MERCHANT_CAVEAT] : [],
    today,
    generatedAt: now,
  }
}

export { addDays }
