import { describe, expect, it } from 'vitest'
import {
  CsvSyntaxError,
  parseCarrierCsv,
  readCsv,
  type CarrierCsvResult,
  type CarrierInvoice,
  type RejectedInvoice,
} from '../carrierCsv'
import {
  CARRIER_HEADER_LINE,
  REAL_PASSBOOK_CSV,
  carrierCsv,
  type CarrierRowOptions,
} from '@/test/fixtures'

const cells = (text: string) => readCsv(text).map((r) => r.cells)

describe('readCsv', () => {
  it('去掉 BOM', () => {
    expect(cells('\uFEFFa,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('\\r\\n 與 \\n 結果相同，包括引號內的換行', () => {
    const lf = 'a,"x\ny"\n1,2\n'
    const crlf = 'a,"x\r\ny"\r\n1,2\r\n'
    expect(cells(crlf)).toEqual(cells(lf))
    expect(cells(crlf)[0]).toEqual(['a', 'x\ny'])
  })

  it('引號內的逗號留在值裡', () => {
    expect(cells('"阿麥-正常冰,無糖",29')).toEqual([['阿麥-正常冰,無糖', '29']])
  })

  it('"" 是跳脫的引號', () => {
    expect(cells('"他說""好""",1')).toEqual([['他說"好"', '1']])
  })

  it('欄位中間的 " 當一般字元', () => {
    expect(cells('12"吋螢幕,1')).toEqual([['12"吋螢幕', '1']])
  })

  it('引號內換行時，line 是這一列的起始列號', () => {
    const rows = readCsv('h\n"a\nb",1\nc,2')
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4])
  })

  it('結尾換行不會多出一列', () => {
    expect(cells('a,b\n1,2\n')).toHaveLength(2)
  })

  it('空行被濾掉', () => {
    expect(cells('a,b\n\n1,2')).toHaveLength(2)
  })

  it('引號沒關 → CsvSyntaxError 帶起始列號', () => {
    let line: number | null = null
    try {
      readCsv('a,b\n1,2\n"沒關,3\n4,5')
    } catch (e) {
      if (e instanceof CsvSyntaxError) line = e.line
    }
    expect(line).toBe(3)
  })
})

function okResult(result: CarrierCsvResult): { invoices: CarrierInvoice[]; rejected: RejectedInvoice[] } {
  if (!result.ok) throw new Error(`預期 ok，實際是 ${result.reason}`)
  return result
}

function parseOk(text: string) {
  return okResult(parseCarrierCsv(text))
}

function invoice(text: string, number: string): CarrierInvoice {
  const found = parseOk(text).invoices.find((i) => i.invoiceNumber === number)
  if (!found) throw new Error(`找不到 ${number}`)
  return found
}

const GOOD: CarrierRowOptions = { number: 'ZZ00000099', total: '55' }

/** 壞的那張 + 一張正常的，確認拒收只影響壞的那張。 */
function rejectOf(rows: CarrierRowOptions[]) {
  const { invoices, rejected } = parseOk(carrierCsv([...rows, GOOD]))
  expect(invoices.map((i) => i.invoiceNumber)).toEqual(['ZZ00000099'])
  return rejected
}

describe('parseCarrierCsv 整份', () => {
  it('表頭差一個字 → header_mismatch', () => {
    const text = carrierCsv([GOOD]).replace('店家名稱', '商店名稱')
    expect(parseCarrierCsv(text)).toEqual({ ok: false, reason: 'header_mismatch' })
  })

  it('表頭少一欄 → header_mismatch', () => {
    const text = carrierCsv([GOOD]).replace(',備註', '')
    expect(parseCarrierCsv(text)).toEqual({ ok: false, reason: 'header_mismatch' })
  })

  it('表頭多一欄 → header_mismatch', () => {
    const text = carrierCsv([GOOD]).replace(',備註', ',備註,額外')
    expect(parseCarrierCsv(text)).toEqual({ ok: false, reason: 'header_mismatch' })
  })

  it('表頭格內有前後空白 → 接受', () => {
    const text = carrierCsv([GOOD]).replace('店家名稱', ' 店家名稱 ')
    expect(parseOk(text).invoices).toHaveLength(1)
  })

  it('空字串 → header_mismatch', () => {
    expect(parseCarrierCsv('')).toEqual({ ok: false, reason: 'header_mismatch' })
  })

  it('只有表頭 → ok、0 張', () => {
    expect(parseCarrierCsv(`${CARRIER_HEADER_LINE}\n`)).toEqual({
      ok: true,
      invoices: [],
      rejected: [],
    })
  })

  it('某列欄數不對 → malformed，帶列號', () => {
    const text = `${carrierCsv([GOOD, { ...GOOD, number: 'ZZ00000098' }])}2026/09/01 12:00:00,ZZ00000097,店\n`
    expect(parseCarrierCsv(text)).toEqual({ ok: false, reason: 'malformed', line: 4 })
  })

  it('引號沒關 → malformed，帶列號', () => {
    const text = `${carrierCsv([GOOD])}2026/09/01 12:00:00,ZZ00000097,"店\n`
    expect(parseCarrierCsv(text)).toEqual({ ok: false, reason: 'malformed', line: 3 })
  })
})

describe('parseCarrierCsv 真實結構', () => {
  it('8 張全部可匯入，沒有拒收', () => {
    const { invoices, rejected } = parseOk(REAL_PASSBOOK_CSV)
    expect(invoices).toHaveLength(8)
    expect(rejected).toEqual([])
  })

  it('總計大於小計加總（品項未稅）時以總計為準', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000004').total).toBe(1500)
  })

  it('總計小於小計加總（折扣沒列成品項）時以總計為準', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000008').total).toBe(346)
  })

  it('負數小計的品項保留', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000006').items.map((i) => i.amount)).toEqual([
      29, 29, -14,
    ])
  })

  it('個數 0、小計 0 的品項保留', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000007').items.at(-1)).toEqual({
      name: '可樂-中',
      qty: 0,
      amount: 0,
    })
  })

  it('個數的浮點雜訊照 Number() 轉換，不四捨五入', () => {
    const fuel = invoice(REAL_PASSBOOK_CSV, 'ZZ00000005').items
    expect(fuel[0]!.qty).toBe(36.27)
    expect(fuel[1]!.qty).toBe(37)
  })

  it('同一張發票內的同名品項保留兩列', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000002').items.map((i) => i.name)).toEqual([
      '洗衣精',
      '會員回饋金',
      '洗衣精',
    ])
  })

  it('引號內的逗號留在品名裡', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000003').items[0]!.name).toBe('綠茶-正常冰,無糖')
  })

  it('全形品名原樣保留', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000006').items[0]!.name).toBe('ＦＭＣ氣泡水')
  })

  it('消費時間轉成 YYYY-MM-DD', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000001').date).toBe('2026-08-03')
  })

  it('店家與統編取自 CSV', () => {
    const inv = invoice(REAL_PASSBOOK_CSV, 'ZZ00000006')
    expect(inv.merchant).toBe('測試超商股份有限公司台北市第一二三門市部')
    expect(inv.sellerTaxId).toBe('55555555')
  })

  it('rawRows 保留單價原值', () => {
    expect(invoice(REAL_PASSBOOK_CSV, 'ZZ00000004').rawRows[0]![5]).toBe('1428.57')
  })
})

describe('parseCarrierCsv 單張拒收', () => {
  const reasonsOf = (rows: CarrierRowOptions[]) => rejectOf(rows).map((r) => r.reason)

  it('總計空白 → total_missing，不從小計推算', () => {
    const rejected = rejectOf([
      { subtotal: '30', total: '' },
      { item: '茶', subtotal: '25', total: '' },
    ])
    expect(rejected).toEqual([{ invoiceNumber: 'ZZ00000001', lines: [2, 3], reason: 'total_missing' }])
  })

  it('總計 0 → total_zero', () => {
    expect(reasonsOf([{ total: '0' }])).toEqual(['total_zero'])
  })

  it('總計有千分位 → total_invalid', () => {
    expect(reasonsOf([{ total: '1,500' }])).toEqual(['total_invalid'])
  })

  it('總計負數 → total_invalid', () => {
    expect(reasonsOf([{ total: '-55' }])).toEqual(['total_invalid'])
  })

  it('總計有小數 → total_invalid', () => {
    expect(reasonsOf([{ total: '12.5' }])).toEqual(['total_invalid'])
  })

  it('一張發票有兩格總計 → total_ambiguous', () => {
    expect(reasonsOf([{ total: '55' }, { total: '55' }])).toEqual(['total_ambiguous'])
  })

  it('小計空白 → subtotal_invalid', () => {
    expect(reasonsOf([{ subtotal: '', total: '55' }])).toEqual(['subtotal_invalid'])
  })

  it('小計有小數 → subtotal_invalid', () => {
    expect(reasonsOf([{ subtotal: '3.5', total: '55' }])).toEqual(['subtotal_invalid'])
  })

  it('個數空白 → qty_invalid', () => {
    expect(reasonsOf([{ qty: '', total: '55' }])).toEqual(['qty_invalid'])
  })

  it('個數負數 → qty_invalid', () => {
    expect(reasonsOf([{ qty: '-1', total: '55' }])).toEqual(['qty_invalid'])
  })

  it('不存在的日子 → date_invalid', () => {
    expect(reasonsOf([{ time: '2026/02/30 12:00:00', total: '55' }])).toEqual(['date_invalid'])
  })

  it('ISO 日期寫法 → date_invalid', () => {
    expect(reasonsOf([{ time: '2026-09-01 12:00:00', total: '55' }])).toEqual(['date_invalid'])
  })

  it('消費時間少了秒 → date_invalid', () => {
    expect(reasonsOf([{ time: '2026/09/01 12:00', total: '55' }])).toEqual(['date_invalid'])
  })

  it('同號碼但消費時間不同 → rows_inconsistent', () => {
    expect(
      reasonsOf([{ total: '110' }, { time: '2026/09/02 12:00:00' }]),
    ).toEqual(['rows_inconsistent'])
  })

  it('同號碼但店家不同 → rows_inconsistent', () => {
    expect(reasonsOf([{ total: '110' }, { merchant: '別家' }])).toEqual(['rows_inconsistent'])
  })

  it('同號碼但統編不同 → rows_inconsistent', () => {
    expect(reasonsOf([{ total: '110' }, { seller: '87654321' }])).toEqual(['rows_inconsistent'])
  })

  it('號碼空白 → 每列各一筆 number_missing', () => {
    expect(rejectOf([{ number: '', total: '55' }, { number: ' ' }])).toEqual([
      { invoiceNumber: null, lines: [2], reason: 'number_missing' },
      { invoiceNumber: null, lines: [3], reason: 'number_missing' },
    ])
  })

  it('品名空白 → item_name_missing', () => {
    expect(reasonsOf([{ total: '110' }, { item: '' }])).toEqual(['item_name_missing'])
  })
})

describe('parseCarrierCsv 邊界', () => {
  it('同號碼的列不連續 → 合成一張', () => {
    const text = carrierCsv([
      { total: '80' },
      { number: 'ZZ00000002', total: '55' },
      { item: '蛋糕', subtotal: '25' },
    ])
    expect(parseOk(text).invoices.map((i) => [i.invoiceNumber, i.items.length])).toEqual([
      ['ZZ00000001', 2],
      ['ZZ00000002', 1],
    ])
  })

  it('總計寫在非第一列 → 接受', () => {
    expect(invoice(carrierCsv([{}, { item: '蛋糕', total: '110' }]), 'ZZ00000001').total).toBe(110)
  })

  it('店家與統編空白 → 照收', () => {
    const inv = invoice(carrierCsv([{ merchant: '', seller: '', total: '55' }]), 'ZZ00000001')
    expect([inv.merchant, inv.sellerTaxId]).toEqual(['', ''])
  })

  it('行尾空白不算 rows_inconsistent', () => {
    const text = carrierCsv([{ total: '110' }, { merchant: '測試商店股份有限公司 ' }])
    expect(parseOk(text).rejected).toEqual([])
  })

  it('沒有 BOM 也接受', () => {
    expect(parseOk(carrierCsv([GOOD], { bom: false })).invoices).toHaveLength(1)
  })

  it('備註去重後用換行串接', () => {
    const text = carrierCsv([
      { total: '165', note: '公司' },
      { note: '公司' },
      { note: '' },
      { note: '報帳' },
    ])
    expect(invoice(text, 'ZZ00000001').note).toBe('公司\n報帳')
  })
})

describe('parseCarrierCsv 檢查順序（每張只回報第一個原因）', () => {
  it('總計 0 又品名空白 → total_zero（總計先於品項）', () => {
    expect(rejectOf([{ total: '0', item: '' }]).map((r) => r.reason)).toEqual(['total_zero'])
  })

  it('日期不存在又總計空白 → date_invalid（日期先於總計）', () => {
    expect(
      rejectOf([{ time: '2026/02/30 12:00:00', total: '' }]).map((r) => r.reason),
    ).toEqual(['date_invalid'])
  })

  it('品項逐列檢查：第 1 列個數壞、第 2 列品名空白 → qty_invalid', () => {
    expect(
      rejectOf([{ qty: '', total: '110' }, { item: '' }]).map((r) => r.reason),
    ).toEqual(['qty_invalid'])
  })
})
