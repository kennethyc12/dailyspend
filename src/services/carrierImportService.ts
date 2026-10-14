import type { SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'
import type { CarrierInvoice, RejectedInvoice } from '@/parsing/carrierCsv'
import { applyClassification, loadClassifier, type Classifier } from './entryService'
import { mergeForWrite, prepareRecord } from './recordService'
import { bumpHits } from './ruleService'

export interface PlannedWrite {
  record: SpendRecord
  /** 覆寫既有紀錄時，prepare 當下的 updatedAt；新增時是 null。commit 用它做過期檢查。 */
  expectedUpdatedAt: number | null
  /** 寫入前這筆是不是已經在待確認，用來算「新增的待確認筆數」。 */
  wasPending: boolean
  matchedRuleIds: string[]
}

export interface MergePlan extends PlannedWrite {
  existing: SpendRecord
  conflicts: string[]
  /** 依 §7.3 品項整份換成另一方，預覽要標示。 */
  itemsReplaced: boolean
}

export type ImportEntry =
  | { kind: 'insert'; invoice: CarrierInvoice; write: PlannedWrite }
  | { kind: 'merge'; invoice: CarrierInvoice; write: MergePlan }
  | { kind: 'unchanged'; invoice: CarrierInvoice; existing: SpendRecord }
  | {
      kind: 'candidate'
      invoice: CarrierInvoice
      /** 使用者選「兩筆都留」時的寫入。 */
      keepBoth: PlannedWrite
      /** 依候選紀錄預先算好的合併結果。 */
      merges: MergePlan[]
    }

export interface CarrierImportPreview {
  entries: ImportEntry[]
  rejected: RejectedInvoice[]
  /** prepare 當下每個 date|amount 的候選 id，commit 前比對用。 */
  candidateSnapshot: Map<string, string[]>
}

/** entries 的 index → 選擇合併的候選紀錄 id；沒出現在 map 裡的，預設「兩筆都留」。 */
export type CandidateChoices = Map<number, string>

export interface WritePlan {
  writes: PlannedWrite[]
  inserted: number
  merged: number
  unchanged: number
  rejected: number
  /** 寫入後是待確認、寫入前不是的筆數。 */
  newlyPending: number
}

export class CarrierImportStaleError extends Error {
  constructor() {
    super('預覽之後資料有變動，請重新預覽')
    this.name = 'CarrierImportStaleError'
  }
}

export class CarrierImportChoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CarrierImportChoiceError'
  }
}

function candidateKey(r: Pick<SpendRecord, 'date' | 'amount'>): string {
  return `${r.date}|${r.amount}`
}

/** 「可能重複」只比同日同額、沒有發票號碼的紀錄；不比店名，避免模糊比對。 */
function indexCandidates(records: SpendRecord[]): Map<string, SpendRecord[]> {
  const index = new Map<string, SpendRecord[]>()
  for (const r of records) {
    if (r.invoiceKey !== null) continue
    const key = candidateKey(r)
    const list = index.get(key)
    if (list) list.push(r)
    else index.set(key, [r])
  }
  return index
}

function snapshotOf(index: Map<string, SpendRecord[]>): Map<string, string[]> {
  return new Map([...index].map(([key, rs]) => [key, rs.map((r) => r.id).sort()]))
}

function stableJson(record: SpendRecord): string {
  return JSON.stringify(record, (_key, value: object | string | number | boolean | null) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  )
}

function sameExceptUpdatedAt(a: SpendRecord, b: SpendRecord): boolean {
  return stableJson({ ...a, updatedAt: 0 }) === stableJson({ ...b, updatedAt: 0 })
}

function toBareRecord(invoice: CarrierInvoice, now: number): SpendRecord {
  return {
    id: crypto.randomUUID(),
    date: invoice.date,
    merchant: invoice.merchant,
    amount: invoice.total,
    items: invoice.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      unitPrice: null,
      amount: it.amount,
      categoryId: null,
    })),
    categoryId: null,
    categorySource: 'rule',
    classifyConfidence: 0,
    recognizeConfidence: null,
    status: 'confirmed',
    pendingReasons: [],
    invoiceNumber: invoice.invoiceNumber,
    invoicePeriod: null,
    invoiceKey: null,
    invoiceRandomCode: null,
    sourceType: 'carrier',
    photoId: null,
    rawRecognition: {
      source: 'invoice-passbook-csv',
      sellerTaxId: invoice.sellerTaxId,
      rows: invoice.rawRows,
    },
    note: invoice.note,
    createdAt: now,
    updatedAt: now,
  }
}

function planInsert(bare: SpendRecord, classifier: Classifier): PlannedWrite {
  const out = classifier({ merchant: bare.merchant || null, items: bare.items })
  let record = applyClassification(bare, out)
  if (!record.merchant) {
    const pendingReasons = [...record.pendingReasons, 'missing_merchant' as const]
    record = { ...record, pendingReasons, status: 'pending' }
  }
  return { record, expectedUpdatedAt: null, wasPending: false, matchedRuleIds: out.matchedRuleIds }
}

function planMerge(
  existing: SpendRecord,
  bare: SpendRecord,
  classifier: Classifier,
  now: number,
): MergePlan {
  const merged = mergeForWrite(existing, bare, now)
  // 要在套分類之前判斷：applyClassification 會產生新的 items 陣列。
  const itemsReplaced = merged.record.items !== existing.items && existing.items.length > 0
  let record = merged.record
  let matchedRuleIds: string[] = []
  // needsReclassify 已排除使用者指定的類別（merge.ts）。不加「既有類別是 null 也重跑」：
  // 那會讓使用者確認過的紀錄在重新匯入時回到待確認。
  if (merged.needsReclassify) {
    const out = classifier({ merchant: record.merchant || null, items: record.items })
    record = applyClassification(record, out)
    matchedRuleIds = out.matchedRuleIds
  }
  return {
    record,
    existing,
    expectedUpdatedAt: existing.updatedAt,
    wasPending: existing.status === 'pending',
    matchedRuleIds,
    conflicts: merged.conflicts,
    itemsReplaced,
  }
}

/** 只讀：把每張發票分桶並預先算好要寫入的最終紀錄。寫入由 `commitCarrierImport` 負責。 */
export async function prepareCarrierImport(
  storage: StoragePort,
  parsed: { invoices: CarrierInvoice[]; rejected: RejectedInvoice[] },
  now = Date.now(),
): Promise<CarrierImportPreview> {
  const classifier = await loadClassifier(storage)
  const candidateIndex = indexCandidates(await storage.getAll<SpendRecord>('records'))
  const entries: ImportEntry[] = []

  for (const invoice of parsed.invoices) {
    // incoming 不帶分類：pendingReasons 在合併時是聯集，帶了會把使用者處理掉的原因加回來。
    const bare = prepareRecord(toBareRecord(invoice, now))
    const existing = bare.invoiceKey
      ? await storage.getByIndex<SpendRecord>('records', 'by_invoiceKey', bare.invoiceKey)
      : undefined

    if (existing) {
      const plan = planMerge(existing, bare, classifier, now)
      entries.push(
        sameExceptUpdatedAt(plan.record, existing)
          ? { kind: 'unchanged', invoice, existing }
          : { kind: 'merge', invoice, write: plan },
      )
      continue
    }

    const keepBoth = planInsert(bare, classifier)
    const candidates = candidateIndex.get(candidateKey(bare)) ?? []
    entries.push(
      candidates.length === 0
        ? { kind: 'insert', invoice, write: keepBoth }
        : {
            kind: 'candidate',
            invoice,
            keepBoth,
            merges: candidates.map((c) => planMerge(c, bare, classifier, now)),
          },
    )
  }

  return { entries, rejected: parsed.rejected, candidateSnapshot: snapshotOf(candidateIndex) }
}

/** 選擇對應到寫入只有這一個寫法：commit 與預覽的筆數都從這裡算。 */
export function planWrites(preview: CarrierImportPreview, choices: CandidateChoices): WritePlan {
  const chosen = new Set<string>()
  for (const [index, id] of choices) {
    const entry = preview.entries[index]
    if (entry?.kind !== 'candidate') throw new CarrierImportChoiceError(`第 ${index} 筆不是可能重複`)
    if (!entry.merges.some((m) => m.existing.id === id)) {
      throw new CarrierImportChoiceError(`第 ${index} 筆的候選裡沒有這筆紀錄`)
    }
    if (chosen.has(id)) throw new CarrierImportChoiceError('同一筆紀錄不能被兩張發票合併')
    chosen.add(id)
  }

  const plan: WritePlan = {
    writes: [],
    inserted: 0,
    merged: 0,
    unchanged: 0,
    rejected: preview.rejected.length,
    newlyPending: 0,
  }
  preview.entries.forEach((entry, index) => {
    if (entry.kind === 'unchanged') {
      plan.unchanged++
      return
    }
    if (entry.kind === 'insert' || entry.kind === 'merge') {
      plan.writes.push(entry.write)
      if (entry.kind === 'insert') plan.inserted++
      else plan.merged++
      return
    }
    const id = choices.get(index)
    const merge = entry.merges.find((m) => m.existing.id === id)
    plan.writes.push(merge ?? entry.keepBoth)
    if (merge) plan.merged++
    else plan.inserted++
  })
  plan.newlyPending = plan.writes.filter((w) => w.record.status === 'pending' && !w.wasPending).length
  return plan
}

function candidatesChanged(current: Map<string, SpendRecord[]>, preview: CarrierImportPreview): boolean {
  for (const entry of preview.entries) {
    if (entry.kind !== 'insert' && entry.kind !== 'candidate') continue
    const key = candidateKey({ date: entry.invoice.date, amount: entry.invoice.total })
    const now = (current.get(key) ?? []).map((r) => r.id).sort()
    const before = preview.candidateSnapshot.get(key) ?? []
    if (now.join(',') !== before.join(',')) return true
  }
  return false
}

/**
 * 在單一 transaction 內寫入 `planWrites` 的結果，全有或全無。
 * 預覽之後資料有任何變動就丟 `CarrierImportStaleError`，整批回滾（含規則命中次數）。
 */
export async function commitCarrierImport(
  storage: StoragePort,
  preview: CarrierImportPreview,
  choices: CandidateChoices,
  now = Date.now(),
): Promise<WritePlan> {
  const plan = planWrites(preview, choices)
  if (plan.writes.length === 0) return plan

  // Tx 沒有 getAll／query，候選集合只能在 transaction 外比對。
  const current = indexCandidates(await storage.getAll<SpendRecord>('records'))
  if (candidatesChanged(current, preview)) throw new CarrierImportStaleError()

  await storage.transaction(['records', 'rules'], async (tx) => {
    for (const w of plan.writes) {
      if (w.expectedUpdatedAt !== null) {
        const latest = await tx.get<SpendRecord>('records', w.record.id)
        if (latest?.updatedAt !== w.expectedUpdatedAt) throw new CarrierImportStaleError()
      }
      if (w.record.invoiceKey) {
        const owner = await tx.getByIndex<SpendRecord>('records', 'by_invoiceKey', w.record.invoiceKey)
        if (owner && owner.id !== w.record.id) throw new CarrierImportStaleError()
      }
      await tx.put('records', w.record)
    }
    await bumpHits(
      tx,
      plan.writes.flatMap((w) => w.matchedRuleIds),
      now,
    )
  })
  return plan
}
