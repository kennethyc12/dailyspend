import { describe, expect, it } from 'vitest'
import { isValidIsoDate, isValidYmd } from '../dates'

describe('isValidYmd', () => {
  it('依真實的月份天數判斷', () => {
    expect(isValidYmd(2026, 10, 31)).toBe(true)
    expect(isValidYmd(2026, 11, 31)).toBe(false)
    expect(isValidYmd(2026, 2, 28)).toBe(true)
    expect(isValidYmd(2026, 2, 30)).toBe(false)
  })

  it('閏年才有 2/29', () => {
    expect(isValidYmd(2028, 2, 29)).toBe(true)
    expect(isValidYmd(2026, 2, 29)).toBe(false)
    expect(isValidYmd(2100, 2, 29)).toBe(false)
  })

  it('月份與日期的邊界', () => {
    expect(isValidYmd(2026, 0, 1)).toBe(false)
    expect(isValidYmd(2026, 13, 1)).toBe(false)
    expect(isValidYmd(2026, 1, 0)).toBe(false)
    expect(isValidYmd(2026, 1.5, 1)).toBe(false)
  })
})

describe('isValidIsoDate', () => {
  it('格式是 YYYY-MM-DD 而且日子存在', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true)
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2026/02/28')).toBe(false)
    expect(isValidIsoDate('2026-1-5')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
  })
})

