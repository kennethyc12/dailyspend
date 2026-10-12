import { describe, expect, it } from 'vitest'
import { classifyPayload, LEFT_HEADER_LENGTH, parseEInvoicePayload } from '../einvoicePayload'

/**
 * 表頭欄位來自財政部規格（字軌 10 + 日期 7 + 隨機碼 4 + 銷售額 8 + 總計額 8 +
 * 買方統編 8 + 賣方統編 8 + 加密驗證 24 = 77）。這裡的樣例是依規格組出來的，
 * 不是實拍——實拍樣本到目前為止都還沒出現合規的左方 QR。
 */
function leftHeader({
  invoiceNumber = 'AB12345678',
  roc = '1120912',
  randomCode = '3456',
  sales = '000003e8',
  total = '0000041a',
  buyer = '00000000',
  seller = '12345678',
  encrypted = 'MTIzNDU2Nzg5MGFiY2RlZg==',
} = {}) {
  return `${invoiceNumber}${roc}${randomCode}${sales}${total}${buyer}${seller}${encrypted}`
}

describe('左方 QR', () => {
  it('樣例表頭剛好 77 碼——欄位長度加總的回歸測試', () => {
    expect(leftHeader()).toHaveLength(LEFT_HEADER_LENGTH)
  })

  it('拆出號碼、日期與金額，民國年轉成西元', () => {
    const result = classifyPayload(leftHeader())

    expect(result.kind).toBe('left')
    expect(result.header).toMatchObject({
      invoiceNumber: 'AB12345678',
      date: '2023-09-12',
      randomCode: '3456',
      salesAmount: 1000,
      totalAmount: 1050,
      buyerBan: '00000000',
      sellerBan: '12345678',
    })
  })

  it('77 碼之後的 `:` 欄位拆成 segments，開頭的分隔符不算空欄位', () => {
    const result = classifyPayload(`${leftHeader()}:自訂:1:2:咖啡:1:55`)

    expect(result.segments).toEqual(['自訂', '1', '2', '咖啡', '1', '55'])
  })

  it('沒有後續欄位時 segments 是空的', () => {
    expect(classifyPayload(leftHeader()).segments).toEqual([])
  })

  it('字軌不是「兩英文 + 8 數字」時判為不符規格，並說出哪裡不對', () => {
    const result = classifyPayload(leftHeader({ invoiceNumber: '1234567890' }))

    expect(result.kind).toBe('unknown')
    expect(result.reason).toContain('發票字軌')
  })

  it('民國日期的月份超出範圍時判為不符規格', () => {
    const result = classifyPayload(leftHeader({ roc: '1121312' }))

    expect(result.kind).toBe('unknown')
    expect(result.reason).toContain('超出範圍')
  })

  it('民國日期是不存在的日子（115 年 2/29）時判為不符規格', () => {
    const result = classifyPayload(leftHeader({ roc: '1150229' }))

    expect(result.kind).toBe('unknown')
    expect(result.reason).toContain('超出範圍')
  })
})

describe('右方 QR', () => {
  it('以 ** 起始就是右方 QR，後面依 `:` 拆欄位', () => {
    const result = classifyPayload('**:蘋果:1:50:香蕉:2:30')

    expect(result.kind).toBe('right')
    expect(result.segments).toEqual(['蘋果', '1', '50', '香蕉', '2', '30'])
  })

  it('只有填充星號時標記出來，不當成品項', () => {
    const result = classifyPayload('*'.repeat(100))

    expect(result.kind).toBe('right')
    expect(result.reason).toContain('填充星號')
    expect(result.segments).toEqual([])
  })
})

describe('不符規格的 payload', () => {
  // 2026-10-11 的第一張實拍樣本就是這個形狀：只有品項尾段，沒有 77 碼表頭。
  it('只有品項尾段時說明缺少表頭', () => {
    const result = classifyPayload(':營養補品回饋金:2:-300:白蘭氏雞精組:2:1479')

    expect(result.kind).toBe('unknown')
    expect(result.reason).toContain('77')
    expect(result.segments).toEqual(['營養補品回饋金', '2', '-300', '白蘭氏雞精組', '2', '1479'])
  })

  it('長度夠但表頭對不上時不會誤判成左方 QR', () => {
    const result = classifyPayload('x'.repeat(120))

    expect(result.kind).toBe('unknown')
    expect(result.header).toBeNull()
  })
})

describe('parseEInvoicePayload', () => {
  const META = '自訂資料:2:2:0'

  it('同一張照片有兩張不同發票的左方 QR → 整張不帶入，請使用者一次拍一張', () => {
    const result = parseEInvoicePayload([
      `${leftHeader({ invoiceNumber: 'AA12345678' })}:${META}:咖啡:1:55`,
      `${leftHeader({ invoiceNumber: 'BB12345678' })}:${META}:麵包:1:30`,
      '**:蛋糕:1:80',
    ])

    expect(result.items).toEqual([])
    expect(result.invoiceNumber).toBeNull()
    expect(result.totalAmount).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.notes.join()).toContain('請一次拍一張')
    expect(result.notes.join()).toContain('AA12345678')
    expect(result.notes.join()).toContain('BB12345678')
  })

  it('號碼相同但內容不同的兩個左方 QR 也拒絕，不重複併入品項', () => {
    const result = parseEInvoicePayload([
      `${leftHeader()}:${META}:咖啡:1:55`,
      `${leftHeader()}:${META}:咖啡:1:55:麵包:1:30`,
    ])

    expect(result.items).toEqual([])
    expect(result.confidence).toBe(0)
  })

  it('同一個 QR 被偵測到兩次（字串完全相同）→ 當成一個，正常解析', () => {
    const text = `${leftHeader()}:${META}:咖啡:1:55`
    const result = parseEInvoicePayload([text, text])

    expect(result.invoiceNumber).toBe('AB12345678')
    expect(result.items).toEqual([{ name: '咖啡', qty: 1, value: 55 }])
    expect(result.kinds).toEqual(['left'])
  })

  it('左右兩個 QR 的品項接起來，表頭欄位照帶', () => {
    const result = parseEInvoicePayload([`${leftHeader()}:${META}:咖啡:1:55`, '**:麵包:2:30'])

    expect(result.invoiceNumber).toBe('AB12345678')
    expect(result.date).toBe('2023-09-12')
    expect(result.totalAmount).toBe(1050)
    expect(result.items).toEqual([
      { name: '咖啡', qty: 1, value: 55 },
      { name: '麵包', qty: 2, value: 30 },
    ])
    expect(result.confidence).toBe(1)
  })

  it('表頭後的四個中繼欄位不會被當成品項', () => {
    const result = parseEInvoicePayload([`${leftHeader()}:${META}:咖啡:1:55`])

    expect(result.items).toEqual([{ name: '咖啡', qty: 1, value: 55 }])
  })

  it('沒有合規左方 QR 時總計額是 null，不從品項加總推算', () => {
    const result = parseEInvoicePayload([':營養補品回饋金:2:-300:白蘭氏雞精組:2:1479'])

    expect(result.totalAmount).toBeNull()
    expect(result.items).toEqual([
      { name: '營養補品回饋金', qty: 2, value: -300 },
      { name: '白蘭氏雞精組', qty: 2, value: 1479 },
    ])
    expect(result.confidence).toBe(0.5)
    expect(result.notes.join()).toContain('當成純品項解讀')
  })

  it('負數金額（回饋金）照收', () => {
    const result = parseEInvoicePayload([`${leftHeader()}:${META}:回饋金:1:-300`])

    expect(result.items[0]).toEqual({ name: '回饋金', qty: 1, value: -300 })
  })

  it('湊不成三元組的尾巴跳過並留下說明', () => {
    const result = parseEInvoicePayload([`${leftHeader()}:${META}:咖啡:1:55:麵包:2`])

    expect(result.items).toEqual([{ name: '咖啡', qty: 1, value: 55 }])
    expect(result.notes.join()).toContain('湊不成')
  })

  it('數量或單價不是整數時略過該筆，其餘照收', () => {
    const result = parseEInvoicePayload([`${leftHeader()}:${META}:咖啡:一杯:55:麵包:2:30`])

    expect(result.items).toEqual([{ name: '麵包', qty: 2, value: 30 }])
    expect(result.notes.join()).toContain('不是整數')
  })

  it('只有填充星號的右方 QR 不產生品項', () => {
    const result = parseEInvoicePayload([':咖啡:1:55', '*'.repeat(100)])

    expect(result.items).toEqual([{ name: '咖啡', qty: 1, value: 55 }])
    expect(result.kinds).toEqual(['unknown', 'right'])
  })

  it('什麼都沒解到時 confidence 是 0', () => {
    expect(parseEInvoicePayload([]).confidence).toBe(0)
  })
})
