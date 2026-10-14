// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import QuickInputView from '@/views/QuickInputView.vue'
import PendingView from '@/views/PendingView.vue'
import type { Rule, SpendRecord } from '@/models/types'
import { createFromText } from '@/services/entryService'
import { refreshRecords } from '@/composables/useRecords'
import { button, mountView, settled, useViewTest, waitForText } from '@/test/mountView'

vi.mock('@/recognize/qrDetect', () => ({
  detectQrCodes: vi.fn(),
  warmUp: vi.fn(async () => 0),
}))

const { storage } = useViewTest()

describe('待確認', () => {
  it('記一筆輸入「全家 咖啡 55 麵包」→ 待確認頁說明金額後面還有字', async () => {
    const entry = await mountView(QuickInputView)
    await settled(entry)
    await entry.find('input.entry').setValue('全家 咖啡 55 麵包')
    await button(entry, '存檔').trigger('click')
    await waitForText(entry, '需要確認')

    const pending = await mountView(PendingView, '/pending')
    await waitForText(pending, '金額後面還有字，已當成品項，請確認')
    expect(pending.text()).toContain('咖啡、麵包')
  })
})

describe('確認與確認並記住規則（B4.2a）', () => {
  // pendingRecords 是模組層級的狀態，不先重讀的話剛掛上時還是上一個測試的卡片
  async function pendingWith(text: string) {
    await createFromText(storage(), text)
    await refreshRecords()
    const wrapper = await mountView(PendingView, '/pending')
    await settled(wrapper)
    return wrapper
  }

  const only = async () => (await storage().getAll<SpendRecord>('records'))[0]!

  it('多品項改類別後卡片不會消失（B-1）', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await pending.find('select').setValue('fun')
    await settled(pending)

    expect(pending.text()).toContain('某店')
    expect(await only()).toMatchObject({ status: 'pending', categoryId: null })
  })

  const learnedRules = async () =>
    (await storage().getAll<Rule>('rules')).filter((r) => r.origin === 'userCorrection')

  function selectFor(wrapper: VueWrapper, label: string) {
    const found = wrapper.findAll('label').find((l) => l.find('span').text() === label)
    if (!found) throw new Error(`找不到欄位「${label}」`)
    return found.find('select')
  }

  it('多品項記住 → 逐項指定 → 完成並確認', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)

    await selectFor(pending, '甲甲').setValue('fun')
    await waitForText(pending, '已記住：甲甲 → 娛樂（可在設定 › 規則中刪除）')
    await settled(pending)
    await selectFor(pending, '乙乙').setValue('daily')
    await settled(pending)
    await button(pending, '完成並確認').trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    const patterns = (await learnedRules()).map((r) => [r.pattern, r.categoryId])
    expect(patterns).toEqual(
      expect.arrayContaining([
        ['甲甲', 'fun'],
        ['乙乙', 'daily'],
      ]),
    )
    expect(await only()).toMatchObject({ status: 'confirmed', categoryId: 'fun' })
  })

  it('「確認」只確認，不記規則', async () => {
    const pending = await pendingWith('某店 320')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認（目前為 娛樂）').trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    expect(pending.text()).not.toContain('已記住')
    expect(await learnedRules()).toHaveLength(0)
  })

  it('「確認並記住規則」提示學到的規則', async () => {
    const pending = await pendingWith('某店 320')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')

    await waitForText(pending, '已記住：某店 → 娛樂（可在設定 › 規則中刪除）')
  })

  it('沒選類別時不能記住', async () => {
    const pending = await pendingWith('某店 320')

    expect(button(pending, '確認並記住規則').element.disabled).toBe(true)
  })

  it('多品項略過逐項指定 → 只記住店家並確認', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)
    await button(pending, '略過，只記住店家（並確認）').trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    const learned = await learnedRules()
    expect(learned).toHaveLength(1)
    expect(learned[0]).toMatchObject({ type: 'merchant', pattern: '某店' })
  })

  it('沒有店家也沒有品項：照樣確認並說明沒東西可記', async () => {
    const pending = await pendingWith('320')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')

    await waitForText(pending, '沒有店家或品項可記，只確認')
    expect(pending.text()).toContain('沒有待確認的紀錄')
  })

  it('逐項面板展開時也能刪除', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)
    await button(pending, '刪除這筆').trigger('click')
    await button(pending, '確定刪除').trigger('click')

    await waitForText(pending, '沒有待確認的紀錄')
    expect(await storage().getAll('records')).toHaveLength(0)
  })
})
