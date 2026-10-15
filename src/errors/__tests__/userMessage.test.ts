import { describe, expect, it } from 'vitest'
import { StorageConflictError } from '@/storage'
import { userMessage } from '../userMessage'

describe('userMessage', () => {
  it('紀錄撞 invoiceKey → 說明改日期造成重複', () => {
    const msg = userMessage(new StorageConflictError('Unable to add key', 'records'))

    expect(msg).toContain('和另一張同號碼的發票重複')
  })

  it('其他 store 的衝突 → 原訊息', () => {
    expect(userMessage(new StorageConflictError('rules 衝突', 'rules'))).toBe('rules 衝突')
  })

  it('一般錯誤 → 原訊息', () => {
    expect(userMessage(new Error('壞掉了'))).toBe('壞掉了')
  })
})
