import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageConflictError, StorageSerializationError } from '@/storage'
import { ValidationError } from '@/services/entryService'
import { BackupFormatError } from '@/backup/backup'
import { CarrierImportStaleError } from '@/services/carrierImportService'
import { clearErrors, useErrorLog } from '../errorLog'
import { handleError } from '../handleError'

const { errors } = useErrorLog()
const ctx = { where: '測試.動作', failed: '操作失敗' }
const reported = '操作失敗。已記錄錯誤，可到設定頁的「非預期的錯誤」查看'

beforeEach(() => {
  clearErrors()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('預期錯誤：顯示原因，不回報', () => {
  it('ValidationError', () => {
    expect(handleError(new ValidationError('金額不能空白', 'amount'), ctx)).toBe(
      '操作失敗：金額不能空白',
    )
    expect(errors.value).toEqual([])
  })

  it('BackupFormatError', () => {
    expect(handleError(new BackupFormatError('備份檔內容損毀'), ctx)).toBe(
      '操作失敗：備份檔內容損毀',
    )
    expect(errors.value).toEqual([])
  })

  it('CarrierImportStaleError', () => {
    expect(handleError(new CarrierImportStaleError(), ctx)).toBe(
      '操作失敗：預覽之後資料有變動，請重新預覽',
    )
    expect(errors.value).toEqual([])
  })

  it('records 撞號且呼叫端給了情境', () => {
    const err = new StorageConflictError('Unable to add key', 'records')

    expect(handleError(err, { ...ctx, conflict: '有重複的發票' })).toBe('操作失敗：有重複的發票')
    expect(errors.value).toEqual([])
  })
})

describe('非預期錯誤：回報，畫面不顯示原文', () => {
  it('records 撞號但呼叫端沒給情境', () => {
    expect(handleError(new StorageConflictError('Unable to add key', 'records'), ctx)).toBe(
      reported,
    )
    expect(errors.value).toHaveLength(1)
    expect(errors.value[0]).toMatchObject({ where: '測試.動作', source: 'manual' })
  })

  it('其他 store 撞號，即使給了情境', () => {
    const err = new StorageConflictError('rules 衝突', 'rules')

    expect(handleError(err, { ...ctx, conflict: '有重複的發票' })).toBe(reported)
    expect(errors.value).toHaveLength(1)
  })

  it('一般 Error：原文只進錯誤紀錄', () => {
    const msg = handleError(new Error('壞掉了'), ctx)

    expect(msg).toBe(reported)
    expect(msg).not.toContain('壞掉了')
    expect(errors.value[0]).toMatchObject({ message: '壞掉了', source: 'manual', where: '測試.動作' })
  })

  it('非 Error 值不會顯示 undefined', () => {
    const msg = handleError('字串錯誤', ctx)

    expect(msg).toBe(reported)
    expect(msg).not.toContain('undefined')
    expect(errors.value[0]?.message).toBe('字串錯誤')
  })

  it('StorageSerializationError', () => {
    expect(handleError(new StorageSerializationError('無法 clone', 'records'), ctx)).toBe(reported)
    expect(errors.value).toHaveLength(1)
  })
})
