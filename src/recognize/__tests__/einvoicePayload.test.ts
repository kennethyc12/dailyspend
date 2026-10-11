import { describe, expect, it } from 'vitest'
import { classifyPayload, LEFT_HEADER_LENGTH } from '../einvoicePayload'

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
