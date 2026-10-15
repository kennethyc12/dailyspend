import { StorageConflictError } from '@/storage'

export function userMessage(err: unknown): string {
  // 唯一的 unique index 是 by_invoiceKey，只有改日期會讓它撞上另一張發票
  if (err instanceof StorageConflictError && err.store === 'records') {
    return '改了日期後，這筆和另一張同號碼的發票重複，無法存檔。請改回原日期，或到紀錄頁處理另一筆'
  }
  return (err as Error).message
}
