import { describe, expect, it } from 'vitest'
import type { Category, SpendRecord } from '@/models/types'
import { summarizeMonth } from '@/views/monthSummary'

function rec(over: Partial<SpendRecord> & Pick<SpendRecord, 'id' | 'date' | 'amount'>): SpendRecord {
  return {
    merchant: '店',
    items: [],
    categoryId: 'food',
    categorySource: 'rule',
    classifyConfidence: 1,
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

function cat(id: string, sortOrder: number): Category {
  return {
    id,
    name: id,
    parentId: null,
    icon: '',
    color: '',
    isBuiltin: true,
    isActive: true,
    sortOrder,
    updatedAt: 0,
  }
}

const cats = [cat('food', 1), cat('drink', 2), cat('transport', 3)]
const TODAY = '2026-11-15'

describe('summarizeMonth', () => {
  it('只算 today 所在的月份，上月與去年同月不算', () => {
    const s = summarizeMonth(
      [
        rec({ id: 'a', date: '2026-11-03', amount: 100 }),
        rec({ id: 'b', date: '2026-10-31', amount: 200 }),
        rec({ id: 'c', date: '2025-11-15', amount: 400 }),
      ],
      cats,
      TODAY,
    )
    expect(s).toMatchObject({ count: 1, total: 100 })
  })

  it('同月的未來日期也算', () => {
    const s = summarizeMonth([rec({ id: 'a', date: '2026-11-20', amount: 50 })], cats, TODAY)
    expect(s).toMatchObject({ count: 1, total: 50 })
  })

  it('月底與月初各自只算當月', () => {
    const records = [
      rec({ id: 'a', date: '2026-11-30', amount: 10 }),
      rec({ id: 'b', date: '2026-12-01', amount: 20 }),
    ]
    expect(summarizeMonth(records, cats, '2026-11-30')).toMatchObject({ count: 1, total: 10 })
    expect(summarizeMonth(records, cats, '2026-12-01')).toMatchObject({ count: 1, total: 20 })
  })

  it('待確認與未分類都算進筆數與總額；pendingCount 只算待確認', () => {
    const s = summarizeMonth(
      [
        rec({ id: 'a', date: '2026-11-01', amount: 100, status: 'pending' }),
        rec({ id: 'b', date: '2026-11-02', amount: 200, categoryId: null }),
        rec({ id: 'c', date: '2026-11-03', amount: 300 }),
      ],
      cats,
      TODAY,
    )
    expect(s).toMatchObject({ count: 3, total: 600, pendingCount: 1 })
    expect(s.byCategory).toEqual([
      { categoryId: 'food', total: 400 },
      { categoryId: null, total: 200 },
    ])
  })

  it('0 元紀錄算進筆數，小計 0 元的類別不列', () => {
    const s = summarizeMonth(
      [
        rec({ id: 'a', date: '2026-11-01', amount: 0, categoryId: 'drink' }),
        rec({ id: 'b', date: '2026-11-02', amount: 80 }),
      ],
      cats,
      TODAY,
    )
    expect(s).toMatchObject({ count: 2, total: 80 })
    expect(s.byCategory).toEqual([{ categoryId: 'food', total: 80 }])
  })

  it('全部 0 元：byCategory 空、total 0', () => {
    const s = summarizeMonth([rec({ id: 'a', date: '2026-11-01', amount: 0 })], cats, TODAY)
    expect(s).toEqual({ count: 1, total: 0, pendingCount: 0, byCategory: [] })
  })

  it('排序：金額大到小；同額依 sortOrder，其次未分類，孤兒 id 最後且依 id', () => {
    // 插入順序刻意和期望順序相反
    const records = [
      rec({ id: 'a', date: '2026-11-01', amount: 100, categoryId: 'zzz-orphan' }),
      rec({ id: 'b', date: '2026-11-01', amount: 100, categoryId: 'aaa-orphan' }),
      rec({ id: 'c', date: '2026-11-01', amount: 100, categoryId: null }),
      rec({ id: 'd', date: '2026-11-01', amount: 100, categoryId: 'transport' }),
      rec({ id: 'e', date: '2026-11-01', amount: 100, categoryId: 'food' }),
      rec({ id: 'f', date: '2026-11-01', amount: 500, categoryId: 'drink' }),
      rec({ id: 'g', date: '2026-11-01', amount: 30, categoryId: 'food' }),
    ]
    const s = summarizeMonth(records, cats, TODAY)
    expect(s.byCategory.map((c) => c.categoryId)).toEqual([
      'drink',
      'food',
      'transport',
      null,
      'aaa-orphan',
      'zzz-orphan',
    ])
    expect(s.byCategory[1]).toEqual({ categoryId: 'food', total: 130 })
  })

  it('同額時依 sortOrder，不是依 id：sortOrder 和字母順序相反時照 sortOrder', () => {
    const reversed = [cat('transport', 1), cat('food', 3)]
    const records = [
      rec({ id: 'a', date: '2026-11-01', amount: 100, categoryId: 'food' }),
      rec({ id: 'b', date: '2026-11-01', amount: 100, categoryId: 'transport' }),
    ]
    expect(summarizeMonth(records, reversed, TODAY).byCategory.map((c) => c.categoryId)).toEqual(['transport', 'food'])
  })
})
