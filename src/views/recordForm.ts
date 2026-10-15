import type { SpendRecord } from '@/models/types'
import { ValidationError, type RecordPatch } from '@/services/entryService'

// 發票的品名可以含空白，所以一行一個品項，不用空白分隔
export const ITEM_SEPARATOR = '\n'

export interface RecordForm {
  date: string
  merchant: string
  // type="number" 的 v-model 會把輸入轉成數字，清空時則是 ''
  amount: string | number
  itemsText: string
  note: string
}

export function itemsToText(r: SpendRecord): string {
  return r.items.map((i) => i.name).join(ITEM_SEPARATOR)
}

export function formFrom(r: SpendRecord): RecordForm {
  return {
    date: r.date,
    merchant: r.merchant,
    amount: String(r.amount),
    itemsText: itemsToText(r),
    note: r.note,
  }
}

export function isDirty(f: RecordForm, r: SpendRecord): boolean {
  return (
    f.date !== r.date ||
    f.merchant !== r.merchant ||
    String(f.amount) !== String(r.amount) ||
    f.itemsText !== itemsToText(r) ||
    f.note !== r.note
  )
}

/** 表單 → RecordPatch。品項沒改不送，否則 trim 會改到含空白的發票品名（B3a #1）。 */
export function formToPatch(f: RecordForm, r: SpendRecord): RecordPatch {
  // 0 是合法金額，service 分不出「清空」和「填 0」，只能在這裡擋
  if (f.amount === '') throw new ValidationError('金額不能空白', 'amount')
  return {
    date: f.date,
    merchant: f.merchant,
    amount: Number(f.amount),
    itemNames: f.itemsText !== itemsToText(r) ? f.itemsText.split(ITEM_SEPARATOR) : undefined,
    note: f.note,
  }
}
