// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import QuickInputView from '@/views/QuickInputView.vue'
import PendingView from '@/views/PendingView.vue'
import { button, mountView, settled, useViewTest, waitForText } from '@/test/mountView'

vi.mock('@/recognize/qrDetect', () => ({
  detectQrCodes: vi.fn(),
  warmUp: vi.fn(async () => 0),
}))

useViewTest()

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
