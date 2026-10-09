import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearErrors, dismissLatest, reportError, useErrorLog } from '../errorLog'

const { errors, latest } = useErrorLog()

beforeEach(() => {
  clearErrors()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('錯誤紀錄', () => {
  it('Error 物件取 message 與 stack', () => {
    const e = reportError(new Error('壞掉了'), 'vue', 'PendingView')
    expect(e.message).toBe('壞掉了')
    expect(e.stack).toBeTruthy()
    expect(e.where).toBe('PendingView')
  })

  it('字串與非 Error 的值也接得住', () => {
    expect(reportError('純字串').message).toBe('純字串')
    expect(reportError({ code: 500 }).message).toBe('{"code":500}')
  })

  it('無法序列化的值不會讓記錄本身爆掉', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => reportError(circular)).not.toThrow()
  })

  it('沒有 message 的 Error 退回用 name', () => {
    expect(reportError(new TypeError()).message).toBe('TypeError')
  })

  it('最新的排在最前面', () => {
    reportError(new Error('第一'))
    reportError(new Error('第二'))
    expect(errors.value[0]?.message).toBe('第二')
    expect(latest.value?.message).toBe('第二')
  })

  it('只留最近 20 筆，這是除錯線索不是稽核紀錄', () => {
    for (let i = 0; i < 25; i++) reportError(new Error(`e${i}`))
    expect(errors.value).toHaveLength(20)
    expect(errors.value[0]?.message).toBe('e24')
    expect(errors.value.at(-1)?.message).toBe('e5')
  })

  it('關閉橫幅不會刪掉紀錄', () => {
    reportError(new Error('留著'))
    dismissLatest()
    expect(latest.value).toBeNull()
    expect(errors.value).toHaveLength(1)
  })

  it('清空會同時清掉橫幅', () => {
    reportError(new Error('x'))
    clearErrors()
    expect(errors.value).toEqual([])
    expect(latest.value).toBeNull()
  })

  it('每筆都有唯一 id，v-for 的 key 才不會撞', () => {
    reportError(new Error('同樣的訊息'))
    reportError(new Error('同樣的訊息'))
    expect(errors.value[0]?.id).not.toBe(errors.value[1]?.id)
  })
})
