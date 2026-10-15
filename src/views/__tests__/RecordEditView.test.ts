// @vitest-environment jsdom
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendRecord } from '@/models/types'
import RecordEditView from '@/views/RecordEditView.vue'
import { createFromText } from '@/services/entryService'
import { prepareRecord } from '@/services/recordService'
import { createFromInvoice } from '@/services/invoiceService'
import { parseEInvoicePayload } from '@/recognize/einvoicePayload'
import { compressPhoto } from '@/photo/compress'
import { leftQr, photoFromFile } from '@/test/fixtures'
import {
  button,
  field,
  mountView,
  pickFile,
  settled,
  useViewTest,
  waitForText,
} from '@/test/mountView'
import { clearErrors, useErrorLog } from '@/errors/errorLog'

vi.mock('@/photo/compress', () => ({
  compressPhoto: vi.fn(),
}))

const { storage } = useViewTest()

beforeEach(() => {
  vi.mocked(compressPhoto).mockReset()
})

async function openEditor(id: string) {
  const wrapper = await mountView(RecordEditView, `/records/${id}`)
  await waitForText(wrapper, '沒有變更')
  await settled(wrapper)
  return wrapper
}

/** 資料層：品名含空白、qty=2 只會從發票路徑產生，所以走 createFromInvoice。 */
async function invoiceRecord(): Promise<SpendRecord> {
  const result = await createFromInvoice(storage(), {
    recognized: parseEInvoicePayload([leftQr({ total: 70, items: [['可口可樂 600ml', 2, 35]] })]),
    merchant: '全家',
    amount: null,
  })
  if (!result.ok) throw new Error(`建立失敗：${result.blocked}`)
  expect(result.save.record.items.map((i) => i.name)).toEqual(['可口可樂 600ml'])
  return result.save.record
}

function otherOption(select: DOMWrapper<Element>, current: string | null): string {
  return select
    .findAll('option')
    .map((o) => o.attributes('value') ?? '')
    .find((v) => v !== '' && v !== current)!
}

/** 修好之前按鈕會變成「沒有變更」，用文字找會先丟「找不到元素」，所以用位置找欄位區塊的儲存鈕。 */
async function saveForm(wrapper: VueWrapper) {
  await wrapper.find('section.panel button').trigger('click')
  await settled(wrapper)
}

async function amountOf(id: string): Promise<number> {
  return (await storage().get<SpendRecord>('records', id))!.amount
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
  it('#1 只改備註，含空白的品項名稱不會被拆開', async () => {
    const before = await invoiceRecord()
    const wrapper = await openEditor(before.id)

    await field(wrapper, '備註').setValue('公司聚餐')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.items).toEqual(before.items)
  })

  // 品項一送出，service 會用品名對應既有品項，同名的兩個會被合併；沒改品項就不該送
  it('#1 只改備註，同名的兩個品項保持原樣', async () => {
    const result = await createFromInvoice(storage(), {
      recognized: parseEInvoicePayload([
        // 數量不同，合併後才看得出差異（兩個都變成最後一個的 qty）
        leftQr({ total: 115, items: [['咖啡', 1, 55], ['咖啡', 2, 30]] }),
      ]),
      merchant: '全家',
      amount: null,
    })
    if (!result.ok) throw new Error(`建立失敗：${result.blocked}`)
    const before = result.save.record
    expect(before.items.map((i) => i.qty)).toEqual([1, 2])
    const wrapper = await openEditor(before.id)

    await field(wrapper, '備註').setValue('公司聚餐')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.items).toEqual(before.items)
  })

  it('#1 編輯品項時一行一個，含空白的品名不會被切開，既有品項的數量保留', async () => {
    const before = await invoiceRecord()
    const wrapper = await openEditor(before.id)

    await field(wrapper, '品項').setValue('可口可樂 600ml\n雪碧')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.items.map((i) => [i.name, i.qty])).toEqual([
      ['可口可樂 600ml', 2],
      ['雪碧', 1],
    ])
  })

  it('#2 清空金額後按儲存，不會存成 $0，並說明原因', async () => {
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '金額').setValue('')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    expect(wrapper.text()).toContain('金額不能空白')
    expect(await amountOf(before.id)).toBe(55)
  })

  it('改日期撞到另一張同號碼的發票：說明原因，兩筆都不變', async () => {
    const base = await textRecord('甲店 320')
    const mine = prepareRecord({ ...base, date: '2026-01-05', invoiceNumber: 'AB00000001' })
    const other = prepareRecord({
      ...base,
      id: 'other',
      merchant: '乙店',
      date: '2026-03-05',
      invoiceNumber: 'AB00000001',
    })
    await storage().put('records', mine)
    await storage().put('records', other)
    const wrapper = await openEditor(mine.id)

    await field(wrapper, '日期').setValue('2026-03-06')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    expect(wrapper.text()).toContain('和另一張同號碼的發票重複')
    expect(await storage().get('records', mine.id)).toEqual(mine)
    expect(await storage().get('records', 'other')).toEqual(other)
  })

  it('金額改回原值，儲存鈕回到「沒有變更」', async () => {
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '金額').setValue('99')
    expect(wrapper.find('section.panel button').text()).toBe('儲存')
    await field(wrapper, '金額').setValue('55')
    expect(wrapper.find('section.panel button').text()).toBe('沒有變更')
  })
})

describe('編輯紀錄：其他動作不會蓋掉還沒存的修改（#3）', () => {
  it('改整筆分類', async () => {
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '金額').setValue('99')
    const select = field(wrapper, '類別')
    await select.setValue(otherOption(select, before.categoryId))
    await settled(wrapper)
    await saveForm(wrapper)

    expect(await amountOf(before.id)).toBe(99)
  })

  async function openPerItem(): Promise<{ wrapper: VueWrapper; id: string }> {
    // 多品項改整筆分類會回 needs_per_item，逐項面板才會出現；這一步在改金額之前做完
    const before = await textRecord('家樂福 衛生紙 洗髮精 100')
    const wrapper = await openEditor(before.id)
    const select = field(wrapper, '類別')
    await select.setValue(otherOption(select, before.categoryId))
    await waitForText(wrapper, '略過，只記住店家')
    await settled(wrapper)
    return { wrapper, id: before.id }
  }

  it('逐項指定分類', async () => {
    const { wrapper, id } = await openPerItem()

    await field(wrapper, '金額').setValue('99')
    const itemSelect = field(wrapper, '衛生紙')
    await itemSelect.setValue(otherOption(itemSelect, null))
    await settled(wrapper)
    await saveForm(wrapper)

    expect(await amountOf(id)).toBe(99)
  })

  it('略過逐項指定', async () => {
    const { wrapper, id } = await openPerItem()

    await field(wrapper, '金額').setValue('99')
    await button(wrapper, '略過，只記住店家').trigger('click')
    await settled(wrapper)
    await saveForm(wrapper)

    expect(await amountOf(id)).toBe(99)
  })

  it('換照片', async () => {
    vi.mocked(compressPhoto).mockImplementation(async (f) => photoFromFile(f))
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '金額').setValue('99')
    const album = wrapper.findAll<HTMLInputElement>('input[type="file"]').find((i) => !i.attributes('capture'))!
    await pickFile(album, new File(['x'], 'new.jpg', { type: 'image/jpeg' }))
    await waitForText(wrapper, '照片已更新')
    await settled(wrapper)
    await saveForm(wrapper)

    const after = await storage().get<SpendRecord>('records', before.id)
    expect(after!.photoId).toBe('new.jpg')
    expect(after!.amount).toBe(99)
  })

  it('移除照片', async () => {
    const photo = photoFromFile(new File(['x'], 'old.jpg', { type: 'image/jpeg' }))
    const result = await createFromText(storage(), '全家 咖啡 55', Date.now(), photo)
    if (!result.ok) throw new Error(`建立失敗：${result.blocked}`)
    const id = result.save.record.id
    const wrapper = await openEditor(id)

    await field(wrapper, '金額').setValue('99')
    await button(wrapper, '移除照片').trigger('click')
    await waitForText(wrapper, '照片已移除')
    await settled(wrapper)
    await saveForm(wrapper)

    const after = await storage().get<SpendRecord>('records', id)
    expect(after!.photoId).toBeNull()
    expect(after!.amount).toBe(99)
  })
})

describe('編輯紀錄：錯誤處理分工（B5a）', () => {
  it('照片處理失敗是非預期錯誤：說明情境並記下錯誤，照片不變', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(compressPhoto).mockRejectedValueOnce(new Error('解不開'))
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    const album = wrapper.findAll<HTMLInputElement>('input[type="file"]').find((i) => !i.attributes('capture'))!
    await pickFile(album, new File(['x'], 'bad.jpg', { type: 'image/jpeg' }))
    await waitForText(wrapper, '照片處理失敗。已記錄錯誤，可到設定頁的「非預期的錯誤」查看')

    expect(wrapper.text()).not.toContain('解不開')
    const { errors } = useErrorLog()
    expect(errors.value).toHaveLength(1)
    expect(errors.value[0]).toMatchObject({ message: '解不開', where: 'usePhotoPicker.pick' })
    expect((await storage().get<SpendRecord>('records', before.id))!.photoId).toBeNull()
    clearErrors()
  })

  it('金額空白是預期錯誤：說明原因，不記錯誤', async () => {
    const before = await textRecord('全家 咖啡 55')
    const wrapper = await openEditor(before.id)

    await field(wrapper, '金額').setValue('')
    await button(wrapper, '儲存').trigger('click')
    await settled(wrapper)

    expect(wrapper.text()).toContain('操作失敗：金額不能空白')
    expect(useErrorLog().errors.value).toEqual([])
  })
})
