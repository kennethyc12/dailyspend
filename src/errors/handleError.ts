import { reportError } from './errorLog'
import { StorageConflictError } from '@/storage'
import { ValidationError } from '@/services/entryService'
import { BackupFormatError } from '@/backup/backup'
import { CarrierImportStaleError } from '@/services/carrierImportService'

export interface CaughtContext {
  /** 錯誤紀錄裡用來分辨是哪一個 catch：'<檔名>.<函式>[.<步驟>]'。 */
  where: string
  /** 頁面上的情境句，例如「還原失敗，資料未變更」。 */
  failed: string
  /** records 撞 by_invoiceKey 時的人話。同一個 index 在改日期與還原代表不同的事，由呼叫端給；沒給就是非預期。 */
  conflict?: string
}

/** 使用者操作或資料本身造成的錯誤，訊息本身就是給人看的。 */
const EXPECTED = [ValidationError, BackupFormatError, CarrierImportStaleError]

/** 接住錯誤後決定頁面要顯示什麼；非預期的錯誤同時回報（會跳橫幅、留在設定頁）。 */
export function handleError(err: unknown, ctx: CaughtContext): string {
  if (EXPECTED.some((E) => err instanceof E)) return `${ctx.failed}：${(err as Error).message}`
  if (ctx.conflict && err instanceof StorageConflictError && err.store === 'records') {
    return `${ctx.failed}：${ctx.conflict}`
  }
  reportError(err, 'manual', ctx.where)
  return `${ctx.failed}。已記錄錯誤，可到設定頁的「非預期的錯誤」查看`
}
