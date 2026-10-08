import { describe, expect, it } from 'vitest'
import {
  normalizeInput,
  parseDatePrefix,
  parseNumberToken,
  parseQuickInput,
  todayIso,
  type QuickInputParse,
} from '../quickInput'

const TODAY = '2026-10-08'
const DICT = ['全家', '全聯', '7-11', '星巴克', '麥當勞', 'Netflix']

function parse(input: string) {
  return parseQuickInput(input, { today: TODAY, merchantDict: DICT })
}

function shape(r: QuickInputParse) {
  return {
    merchant: r.merchant,
    items: r.items.map((i) => i.name),
    amount: r.amount,
  }
}

describe('§4.2 回測表', () => {
  it('全家 咖啡 55', () => {
    const r = parse('全家 咖啡 55')
    expect(shape(r)).toEqual({ merchant: '全家', items: ['咖啡'], amount: 55 })
    expect(r.pendingReasons).toEqual([])
    expect(r.date).toBe(TODAY)
  })

  it('蝦皮 320 — 無品項，剖析本身不報 pending（由分類器決定）', () => {
    const r = parse('蝦皮 320')
    expect(shape(r)).toEqual({ merchant: '蝦皮', items: [], amount: 320 })
    expect(r.pendingReasons).toEqual([])
    expect(r.merchantMatched).toBe(false)
  })

  it('昨天 全聯 蛋 雞胸 268', () => {
    const r = parse('昨天 全聯 蛋 雞胸 268')
    expect(shape(r)).toEqual({ merchant: '全聯', items: ['蛋', '雞胸'], amount: 268 })
    expect(r.date).toBe('2026-10-07')
    expect(r.dateExplicit).toBe(true)
  })

  it('星巴克 大杯拿鐵 150元', () => {
    const r = parse('星巴克 大杯拿鐵 150元')
    expect(shape(r)).toEqual({ merchant: '星巴克', items: ['大杯拿鐵'], amount: 150 })
  })

  it('55 — 缺店家轉 pending', () => {
    const r = parse('55')
    expect(shape(r)).toEqual({ merchant: null, items: [], amount: 55 })
    expect(r.pendingReasons).toContain('missing_merchant')
  })

  it('全聯 咖啡 55 麵包 30 — 純數字 token 不得變成品項', () => {
    const r = parse('全聯 咖啡 55 麵包 30')
    expect(shape(r)).toEqual({ merchant: '全聯', items: ['咖啡', '麵包'], amount: 30 })
    expect(r.pendingReasons).toContain('ambiguous_item_tokens')
    expect(r.raw).toBe('全聯 咖啡 55 麵包 30')
  })
})

describe('金額剖析', () => {
  it.each([
    ['55', 55],
    ['1,200', 1200],
    ['55元', 55],
    ['$55', 55],
    ['NT$1,980', 1980],
    ['０', 0],
  ])('%s → %i', (token, expected) => {
    expect(parseNumberToken(normalizeInput(token))).toBe(expected)
  })

  it.each(['咖啡', '7-11', '', '12a', '--'])('%s 不是金額', (token) => {
    expect(parseNumberToken(token)).toBeNull()
  })

  it('小數四捨五入成整數（schema 規定 amount 為整數元）', () => {
    expect(parseNumberToken('55.4')).toBe(55)
    expect(parseNumberToken('55.5')).toBe(56)
  })

  it('沒有任何數字 token 時擋下，不猜金額', () => {
    const r = parse('全家 咖啡')
    expect(r.blockingError).toBe('amount_missing')
    expect(r.amount).toBeNull()
  })

  it('空輸入擋下', () => {
    expect(parse('   ').blockingError).toBe('empty_input')
  })
})

describe('日期前綴', () => {
  it('今天 / 昨天', () => {
    expect(parseDatePrefix('今天', TODAY)).toBe(TODAY)
    expect(parseDatePrefix('昨天', TODAY)).toBe('2026-10-07')
  })

  it('M/D 與 MM-DD 都吃', () => {
    expect(parseDatePrefix('10/3', TODAY)).toBe('2026-10-03')
    expect(parseDatePrefix('09-28', TODAY)).toBe('2026-09-28')
  })

  it('未來日期退回去年（錢不會花在未來）', () => {
    expect(parseDatePrefix('12/25', TODAY)).toBe('2025-12-25')
  })

  it('不合法的月日不當日期', () => {
    expect(parseDatePrefix('13/40', TODAY)).toBeNull()
    expect(parseDatePrefix('咖啡', TODAY)).toBeNull()
  })

  it('7-11 是店家不是 7 月 11 日（破折號形式要求補零兩位）', () => {
    expect(parseDatePrefix('7-11', TODAY)).toBeNull()
    expect(parseDatePrefix('07-11', TODAY)).toBe('2026-07-11')
    expect(parseDatePrefix('7/11', TODAY)).toBe('2026-07-11')
  })

  it('單一 token 時視為金額，不視為日期', () => {
    const r = parse('1200')
    expect(r.amount).toBe(1200)
    expect(r.dateExplicit).toBe(false)
  })

  it('todayIso 產生 YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 9, 8))).toBe('2026-10-08')
  })
})

describe('店家字典', () => {
  it('命中字典時標記 merchantMatched', () => {
    expect(parse('全家 咖啡 55').merchantMatched).toBe(true)
    expect(parse('蝦皮 320').merchantMatched).toBe(false)
  })

  it('比對不分大小寫', () => {
    expect(parse('netflix 390').merchantMatched).toBe(true)
  })
})

describe('全半形正規化', () => {
  it('全形數字、全形空白、全形符號都能處理', () => {
    const r = parse('全家　咖啡　５５元')
    expect(shape(r)).toEqual({ merchant: '全家', items: ['咖啡'], amount: 55 })
  })
})

interface Case {
  input: string
  merchant: string | null
  items: string[]
  amount: number | null
  date?: string
  reasons?: string[]
}

// 20 筆代表性輸入，驗收門檻 ≥95%（design.md §12 #4）。
const CORPUS: Case[] = [
  { input: '全家 咖啡 55', merchant: '全家', items: ['咖啡'], amount: 55 },
  { input: '7-11 御飯糰 45', merchant: '7-11', items: ['御飯糰'], amount: 45 },
  { input: '星巴克 大杯拿鐵 150元', merchant: '星巴克', items: ['大杯拿鐵'], amount: 150 },
  { input: '蝦皮 320', merchant: '蝦皮', items: [], amount: 320 },
  { input: 'Netflix 390', merchant: 'Netflix', items: [], amount: 390 },
  { input: 'uber 230', merchant: 'uber', items: [], amount: 230 },
  { input: '計程車 $120', merchant: '計程車', items: [], amount: 120 },
  {
    input: '家樂福 衛生紙 洗髮精 沐浴乳 689',
    merchant: '家樂福',
    items: ['衛生紙', '洗髮精', '沐浴乳'],
    amount: 689,
  },
  { input: '誠品 書 450', merchant: '誠品', items: ['書'], amount: 450 },
  { input: '加油 ９００元', merchant: '加油', items: [], amount: 900 },
  { input: '全聯 雞胸 蛋 牛奶 1,280', merchant: '全聯', items: ['雞胸', '蛋', '牛奶'], amount: 1280 },
  {
    input: '今天 麥當勞 大麥克餐 159',
    merchant: '麥當勞',
    items: ['大麥克餐'],
    amount: 159,
    date: TODAY,
  },
  {
    input: '昨天 全聯 蛋 雞胸 268',
    merchant: '全聯',
    items: ['蛋', '雞胸'],
    amount: 268,
    date: '2026-10-07',
  },
  { input: '10/3 全聯 蛋 85', merchant: '全聯', items: ['蛋'], amount: 85, date: '2026-10-03' },
  {
    input: '09-28 藥局 口罩 120',
    merchant: '藥局',
    items: ['口罩'],
    amount: 120,
    date: '2026-09-28',
  },
  {
    input: '12/25 禮物 800',
    merchant: '禮物',
    items: [],
    amount: 800,
    date: '2025-12-25',
  },
  { input: '全家　咖啡　５５', merchant: '全家', items: ['咖啡'], amount: 55 },
  { input: '55', merchant: null, items: [], amount: 55, reasons: ['missing_merchant'] },
  {
    input: '全聯 咖啡 55 麵包 30',
    merchant: '全聯',
    items: ['咖啡', '麵包'],
    amount: 30,
    reasons: ['ambiguous_item_tokens'],
  },
  { input: '鼎泰豐 小籠包 炒飯 酸辣湯 1,450', merchant: '鼎泰豐', items: ['小籠包', '炒飯', '酸辣湯'], amount: 1450 },
]

describe('20 筆代表性輸入回測', () => {
  it('語料庫有 20 筆', () => {
    expect(CORPUS).toHaveLength(20)
  })

  it.each(CORPUS.map((c) => [c.input, c] as const))('%s', (_input, c) => {
    const r = parse(c.input)
    expect(shape(r)).toEqual({ merchant: c.merchant, items: c.items, amount: c.amount })
    if (c.date) expect(r.date).toBe(c.date)
    expect(r.pendingReasons.sort()).toEqual((c.reasons ?? []).sort())
  })

  it('整體正確率 ≥ 95%', () => {
    const pass = CORPUS.filter((c) => {
      const r = parse(c.input)
      const shapeOk =
        r.merchant === c.merchant &&
        r.amount === c.amount &&
        r.items.length === c.items.length &&
        r.items.every((it, i) => it.name === c.items[i])
      const dateOk = !c.date || r.date === c.date
      return shapeOk && dateOk
    }).length

    const rate = pass / CORPUS.length
    expect(rate).toBeGreaterThanOrEqual(0.95)
  })
})
