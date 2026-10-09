import { describe, expect, it } from 'vitest'
import type { Category, Settings, SpendRecord } from '@/models/types'
import { defaultCategories, defaultSettings } from '@/storage/defaults'
import { analyze } from '../analyze'
import { addDays, daysInMonth, monthsBetweenKeys, shiftMonthKey } from '../dates'

const TODAY = '2026-10-20'
const CATEGORIES: Category[] = defaultCategories(0)
const T: Settings['thresholds'] = defaultSettings(0).thresholds

let seq = 0
function rec(over: Partial<SpendRecord> = {}): SpendRecord {
  seq += 1
  return {
    id: `r${seq}`,
    date: TODAY,
    merchant: '全家',
    amount: 55,
    items: [],
    categoryId: 'drink',
    categorySource: 'rule',
    classifyConfidence: 0.95,
    recognizeConfidence: null,
    status: 'confirmed',
    pendingReasons: [],
    invoiceNumber: null,
    invoicePeriod: null,
    invoiceKey: null,
    invoiceRandomCode: null,
    sourceType: 'manual',
    photoId: null,
    rawRecognition: null,
    note: '',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function item(name: string) {
  return { name, qty: 1, unitPrice: null, amount: null, categoryId: null }
}

/** 填滿冷啟動門檻用的背景雜訊，金額大到不會被小額規則撿走。 */
function filler(n: number, from = TODAY): SpendRecord[] {
  return Array.from({ length: n }, (_, i) =>
    rec({ date: addDays(from, -i), amount: 5000, categoryId: 'home', merchant: `雜${i}` }),
  )
}

function run(records: SpendRecord[], today = TODAY, thresholds = T) {
  return analyze(records, CATEGORIES, thresholds, today, 0)
}

describe('日期工具', () => {
  it('月份位移與距離', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
    expect(monthsBetweenKeys('2026-08', '2026-10')).toBe(2)
  })

  it('閏年二月', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
  })
})

describe('高頻小額', () => {
  it('達到次數門檻就命中，並換算成每月等值金額', () => {
    const drinks = Array.from({ length: 8 }, (_, i) =>
      rec({ date: addDays(TODAY, -i), amount: 60, categoryId: 'drink' }),
    )
    const r = run([...drinks, ...filler(5)])
    const f = r.findings.find((x) => x.kind === 'smallFrequent')!

    expect(f.title).toContain('飲料')
    expect(f.title).toContain('8 筆')
    // 480 元 / 30 天 * 30 = 480
    expect(f.monthlyEquivalent).toBe(480)
    expect(f.evidence.recordIds).toHaveLength(8)
  })

  it('單筆超過金額上限的不算', () => {
    const big = Array.from({ length: 8 }, (_, i) =>
      rec({ date: addDays(TODAY, -i), amount: 500, categoryId: 'drink' }),
    )
    expect(run([...big, ...filler(5)]).findings.some((f) => f.kind === 'smallFrequent')).toBe(false)
  })

  it('視窗外的不算', () => {
    const old = Array.from({ length: 8 }, (_, i) =>
      rec({ date: addDays(TODAY, -40 - i), amount: 60, categoryId: 'drink' }),
    )
    expect(run([...old, ...filler(12)]).findings.some((f) => f.kind === 'smallFrequent')).toBe(false)
  })
})

describe('訂閱偵測（§8.2）', () => {
  function monthly(merchant: string, amounts: number[], countPerMonth = 1): SpendRecord[] {
    // amounts[0] 是最近的月份，往前推。
    return amounts.flatMap((amount, i) =>
      Array.from({ length: countPerMonth }, (_, k) =>
        rec({
          merchant,
          amount: Math.round(amount / countPerMonth),
          date: `2026-${String(10 - i).padStart(2, '0')}-${String(5 + k).padStart(2, '0')}`,
          categoryId: 'subscription',
        }),
      ),
    )
  }

  it('連續三個月、每月一次、金額穩定 → 命中', () => {
    const r = run([...monthly('Netflix', [390, 390, 390]), ...filler(2, '2026-07-01')])
    const f = r.findings.find((x) => x.kind === 'subscription')!

    expect(f.title).toContain('Netflix')
    expect(f.monthlyEquivalent).toBe(390)
    expect(f.evidence.recordIds.length).toBeGreaterThan(0)
  })

  it('每天都去的早餐店被次數上限擋掉，不會誤判成訂閱', () => {
    const r = run([...monthly('早餐店', [1950, 1950, 1950], 15), ...filler(2, '2026-07-01')])
    expect(r.findings.some((f) => f.kind === 'subscription')).toBe(false)
  })

  it('金額變異太大 → 不算固定支出', () => {
    const r = run([...monthly('水電', [900, 400, 1500]), ...filler(2, '2026-07-01')])
    expect(r.findings.some((f) => f.kind === 'subscription')).toBe(false)
  })

  it('中斷過的月份不算連續', () => {
    const broken = [
      rec({ merchant: 'Gym', amount: 800, date: '2026-10-05' }),
      rec({ merchant: 'Gym', amount: 800, date: '2026-09-05' }),
      rec({ merchant: 'Gym', amount: 800, date: '2026-07-05' }),
    ]
    expect(run([...broken, ...filler(2, '2026-06-01')]).findings.some((f) => f.kind === 'subscription')).toBe(
      false,
    )
  })

  it('本月還沒扣款時仍抓得到（區段延伸到上月即可）', () => {
    const upTo9 = [
      rec({ merchant: 'Spotify', amount: 149, date: '2026-09-03' }),
      rec({ merchant: 'Spotify', amount: 149, date: '2026-08-03' }),
      rec({ merchant: 'Spotify', amount: 149, date: '2026-07-03' }),
    ]
    const r = run([...upTo9, ...filler(2, '2026-06-01')])
    expect(r.findings.some((f) => f.kind === 'subscription')).toBe(true)
  })

  it('早就停掉的訂閱不再出現', () => {
    const stopped = [
      rec({ merchant: 'OldSub', amount: 200, date: '2026-05-03' }),
      rec({ merchant: 'OldSub', amount: 200, date: '2026-04-03' }),
      rec({ merchant: 'OldSub', amount: 200, date: '2026-03-03' }),
    ]
    expect(run([...stopped, ...filler(2, '2026-02-01')]).findings.some((f) => f.kind === 'subscription')).toBe(
      false,
    )
  })

  it('大小寫不同視為同一家店', () => {
    const mixed = [
      rec({ merchant: 'netflix', amount: 390, date: '2026-10-05' }),
      rec({ merchant: 'Netflix', amount: 390, date: '2026-09-05' }),
      rec({ merchant: 'NETFLIX', amount: 390, date: '2026-08-05' }),
    ]
    expect(run([...mixed, ...filler(2, '2026-07-01')]).findings.some((f) => f.kind === 'subscription')).toBe(
      true,
    )
  })
})

describe('月對月暴增（§8.1）', () => {
  it('本月至今 vs 上月同期，結論寫出比較區間', () => {
    const records = [
      rec({ date: '2026-10-10', amount: 3000, categoryId: 'fun' }),
      rec({ date: '2026-09-10', amount: 1000, categoryId: 'fun' }),
    ]
    const f = run(records).findings.find((x) => x.kind === 'monthGrowth')!

    expect(f.title).toContain('娛樂')
    expect(f.detail).toContain('10-01–10-20 vs 09-01–09-20')
    expect(f.detail).toContain('$1000 → $3000')
    expect(f.monthlyEquivalent).toBe(3000) // 2000 / 20 天 * 30
  })

  it('只有本月整段、上月同期沒有 → 不會拿整月比半月', () => {
    const records = [
      rec({ date: '2026-10-10', amount: 3000, categoryId: 'fun' }),
      // 上月同期之外（9/25 > 9/20），不該被算進上期
      rec({ date: '2026-09-25', amount: 9000, categoryId: 'fun' }),
    ]
    const f = run(records).findings.find((x) => x.kind === 'monthGrowth')!
    expect(f.title).toContain('新增')
  })

  it('增額不足門檻不報', () => {
    const records = [
      rec({ date: '2026-10-10', amount: 1400, categoryId: 'fun' }),
      rec({ date: '2026-09-10', amount: 1000, categoryId: 'fun' }),
    ]
    expect(run(records).findings.some((f) => f.kind === 'monthGrowth')).toBe(false)
  })

  it('上月天數不足時對齊到月底並標註', () => {
    const records = [
      rec({ date: '2026-03-30', amount: 5000, categoryId: 'fun' }),
      rec({ date: '2026-02-10', amount: 1000, categoryId: 'fun' }),
    ]
    const f = run(records, '2026-03-31').findings.find((x) => x.kind === 'monthGrowth')!
    expect(f.detail).toContain('已對齊至 02-28')
  })

  it('跨年比較（1 月 vs 去年 12 月）', () => {
    const records = [
      rec({ date: '2027-01-05', amount: 4000, categoryId: 'fun' }),
      rec({ date: '2026-12-05', amount: 1000, categoryId: 'fun' }),
    ]
    const f = run(records, '2027-01-10').findings.find((x) => x.kind === 'monthGrowth')!
    expect(f.detail).toContain('12-01–12-10')
  })
})

describe('同類重複購買', () => {
  it('相同品項達次數門檻就命中，金額標記為估算', () => {
    const records = [
      rec({ date: '2026-10-20', amount: 60, items: [item('手搖飲')] }),
      rec({ date: '2026-10-18', amount: 60, items: [item('手搖飲')] }),
      rec({ date: '2026-10-16', amount: 60, items: [item('手搖飲')] }),
      ...filler(3, '2026-10-15'),
    ]
    const f = run(records).findings.find((x) => x.kind === 'repeatPurchase')!

    expect(f.title).toContain('手搖飲')
    expect(f.title).toContain('3 次')
    expect(f.estimated).toBe(true)
    expect(f.detail).toContain('約')
    expect(f.evidence.itemNames).toEqual(['手搖飲'])
  })

  it('有單品金額時不標記為估算', () => {
    const withAmount = (name: string) => ({ ...item(name), amount: 40 })
    const records = [
      rec({ date: '2026-10-20', amount: 40, items: [withAmount('御飯糰')] }),
      rec({ date: '2026-10-19', amount: 40, items: [withAmount('御飯糰')] }),
      rec({ date: '2026-10-18', amount: 40, items: [withAmount('御飯糰')] }),
      ...filler(3, '2026-10-17'),
    ]
    const f = run(records).findings.find((x) => x.kind === 'repeatPurchase')!
    expect(f.estimated).toBe(false)
    expect(f.detail).toContain('$120')
  })
})

describe('§8.4 冷啟動', () => {
  it('完全沒資料時四條規則都給出「還差多少」，不是空白', () => {
    const r = run([])
    expect(r.findings).toEqual([])
    expect(r.insufficient.map((i) => i.kind).sort()).toEqual([
      'monthGrowth',
      'repeatPurchase',
      'smallFrequent',
      'subscription',
    ])
    expect(r.insufficient.every((i) => i.message.length > 0)).toBe(true)
  })

  it('訂閱提示會說還差幾天', () => {
    const r = run([rec({ date: '2026-10-01' })])
    const msg = r.insufficient.find((i) => i.kind === 'subscription')!.message
    expect(msg).toMatch(/還需 \d+ 天/)
  })

  it('月初資料太少時不比較', () => {
    const r = run([rec({ date: '2026-10-02' })], '2026-10-03')
    expect(r.insufficient.find((i) => i.kind === 'monthGrowth')!.message).toContain('本月還需')
  })

  it('上月完全沒紀錄時說下個月開始可比較', () => {
    const r = run([rec({ date: '2026-10-10' })], '2026-10-20')
    expect(r.insufficient.find((i) => i.kind === 'monthGrowth')!.message).toContain('下個月')
  })
})

describe('建議排序（§8.3）', () => {
  it('依每月等值金額排序並取 topN', () => {
    const drinks = Array.from({ length: 8 }, (_, i) =>
      rec({ date: addDays(TODAY, -i), amount: 60, categoryId: 'drink' }),
    )
    const growth = [
      rec({ date: '2026-10-10', amount: 9000, categoryId: 'fun' }),
      rec({ date: '2026-09-10', amount: 1000, categoryId: 'fun' }),
    ]
    const r = run([...drinks, ...growth, ...filler(5)])

    expect(r.suggestions.length).toBeLessThanOrEqual(T.suggestion.topN)
    const values = r.suggestions.map((s) => s.monthlyEquivalent)
    expect([...values].sort((a, b) => b - a)).toEqual(values)
    // 高頻小額（480/月）與月對月暴增（12000/月）必須能互相比較
    expect(r.suggestions[0]!.kind).toBe('monthGrowth')
  })

  it('每條結論都附得出具體紀錄（objectives 的硬性要求）', () => {
    const drinks = Array.from({ length: 8 }, (_, i) =>
      rec({ date: addDays(TODAY, -i), amount: 60, categoryId: 'drink' }),
    )
    const r = run([...drinks, ...filler(5)])
    expect(r.findings.length).toBeGreaterThan(0)
    for (const f of r.findings) {
      expect(f.evidence.recordIds.length).toBeGreaterThan(0)
    }
  })

  it('門檻可調：放寬次數後會多出結論', () => {
    const drinks = Array.from({ length: 4 }, (_, i) =>
      rec({ date: addDays(TODAY, -i), amount: 60, categoryId: 'drink' }),
    )
    const records = [...drinks, ...filler(6)]
    expect(run(records).findings.some((f) => f.kind === 'smallFrequent')).toBe(false)

    const loose = { ...T, smallFrequent: { ...T.smallFrequent, minCount: 4 } }
    expect(run(records, TODAY, loose).findings.some((f) => f.kind === 'smallFrequent')).toBe(true)
  })

  it('有資料時附上店家名稱不一致的提醒', () => {
    expect(run([rec()]).caveats[0]).toContain('店家名稱不一致')
  })
})
