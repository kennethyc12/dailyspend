// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SpendRecord } from '@/models/types'
import RecordEditView from '@/views/RecordEditView.vue'
import { createFromText } from '@/services/entryService'
import { createFromInvoice } from '@/services/invoiceService'
import { parseEInvoicePayload } from '@/recognize/einvoicePayload'
import { leftQr } from '@/test/fixtures'
import { button, field, mountView, settled, useViewTest, waitForText } from '@/test/mountView'

vi.mock('@/photo/compress', () => ({
  compressPhoto: vi.fn(),
}))

const { storage } = useViewTest()

async function openEditor(id: string) {
  const wrapper = await mountView(RecordEditView, `/records/${id}`)
  await waitForText(wrapper, '沒有變更')
  await settled(wrapper)
  return wrapper
}

async function textRecord(input: string): Promise<SpendRecord> {
  const result = await createFromText(storage(), input)
  if (!result.ok) throw new Error(`建立失敗：${result.blocked}`)
  return result.save.record
}

describe('編輯紀錄', () => {
  it('改備註後儲存 → DB 的 note 更新', async () => {
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '備註').setValue('公司聚餐')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.note).toBe('公司聚餐')
  })
})

describe('編輯紀錄：不能默默改壞資料', () => {
  it.fails('#1 只改備註，含空白的品項名稱不會被拆開', async () => {
    // 資料層：品名含空白、qty=2 只會從發票路徑產生，所以走 createFromInvoice
    const result = await createFromInvoice(storage(), {
      recognized: parseEInvoicePayload([leftQr({ total: 70, items: [['可口可樂 600ml', 2, 35]] })]),
      merchant: '全家',
      amount: null,
    })
    if (!result.ok) throw new Error(`建立失敗：${result.blocked}`)
    const before = result.save.record
    expect(before.items.map((i) => i.name)).toEqual(['可口可樂 600ml'])

    const wrapper = await openEditor(before.id)
    await field(wrapper, '備註').setValue('公司聚餐')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.items).toEqual(before.items)
  })

  // 錯誤文案等 B3 定稿後，在這裡補上畫面斷言。
  it.fails('#2 清空金額後按儲存，不會存成 $0', async () => {
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '金額').setValue('')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.amount).toBe(55)
  })

  it.fails('#3 改了金額還沒存就換分類，之後儲存的是剛輸入的金額', async () => {
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '金額').setValue('99')
    const select = field(wrapper, '類別')
    const other = select
      .findAll('option')
      .map((o) => o.attributes('value') ?? '')
      .find((v) => v !== '' && v !== before.categoryId)!
    await select.setValue(other)
    await settled(wrapper)
    // bug 發生時按鈕會變成「沒有變更」，所以用位置找欄位區塊的那顆儲存鈕，而不是文字
    await wrapper.find('section.panel button').trigger('click')
    await settled(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.amount).toBe(99)
  })
})
