import type { PendingReason, RecordItem, Rule, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'
import { parseQuickInput, type BlockingError, type QuickInputParse } from '@/parsing/quickInput'
import { classifyWithRules } from '@/classify/ruleClassifier'
import { planCorrection, type CorrectionPlan, type CorrectionScope } from '@/classify/correction'
import { applyCorrection, loadActiveRules, recordHits } from './ruleService'
import { saveRecord, type SaveOutcome } from './recordService'
import type { Settings } from '@/models/types'

/** 歷史店家 + 內建 merchant 規則，用來標記 merchantMatched。 */
export async function merchantDictionary(storage: StoragePort): Promise<string[]> {
  const [records, rules] = await Promise.all([
    storage.getAll<SpendRecord>('records'),
    storage.getAll<Rule>('rules'),
  ])
  const names = new Set<string>()
  for (const r of records) if (r.merchant) names.add(r.merchant)
  for (const r of rules) if (r.type === 'merchant') names.add(r.pattern)
  return [...names]
}

export type EntryResult =
  | { ok: false; blocked: BlockingError; parse: QuickInputParse }
  | { ok: true; parse: QuickInputParse; save: SaveOutcome }

/**
 * §9 的資料流程（文字輸入路徑）。照片與 QR 是 Phase 9。
 *
 * 剖析、分類都在 `saveRecord` 之前跑完，寫入才進 transaction（§2.2）。
 */
export async function createFromText(
  storage: StoragePort,
  text: string,
  now = Date.now(),
): Promise<EntryResult> {
  const [dict, rules, settings] = await Promise.all([
    merchantDictionary(storage),
    loadActiveRules(storage),
    storage.get<Settings>('settings', 'settings'),
  ])

  const parse = parseQuickInput(text, { merchantDict: dict })
  if (parse.blockingError) return { ok: false, blocked: parse.blockingError, parse }

  const classified = classifyWithRules(
    { merchant: parse.merchant, items: parse.items },
    rules,
    settings?.confidence.pendingBelow ?? 0.6,
  )

  const items: RecordItem[] = parse.items.map((item, i) => ({
    name: item.name,
    qty: settings?.defaults.qty ?? 1,
    unitPrice: null,
    amount: null,
    categoryId: classified.itemCategoryIds[i] ?? null,
  }))

  const pendingReasons = [
    ...new Set<PendingReason>([...parse.pendingReasons, ...classified.pendingReasons]),
  ]

  const record: SpendRecord = {
    id: crypto.randomUUID(),
    date: parse.date,
    merchant: parse.merchant ?? '',
    amount: parse.amount!,
    items,
    categoryId: classified.categoryId,
    categorySource: 'rule',
    classifyConfidence: classified.classifyConfidence,
    recognizeConfidence: null,
    status: pendingReasons.length > 0 ? 'pending' : 'confirmed',
    pendingReasons,
    invoiceNumber: null,
    invoicePeriod: null,
    invoiceKey: null,
    invoiceRandomCode: null,
    sourceType: 'manual',
    photoId: null,
    rawRecognition: null,
    note: '',
    createdAt: now,
    updatedAt: now,
  }

  const save = await saveRecord(storage, record, { now })
  await recordHits(storage, classified.matchedRuleIds, now)

  return { ok: true, parse, save }
}

/** 分類相關的待確認原因，使用者指定類別後就不再成立。 */
const CATEGORY_REASONS: PendingReason[] = [
  'no_category_match',
  'ambiguous_merchant',
  'low_confidence',
]

export interface CorrectionResult {
  record: SpendRecord
  plan: CorrectionPlan
}

/**
 * 使用者修正分類：更新紀錄，並依 §6.2 決定要不要同時學成規則。
 * 多品項改整筆時 plan 會是 `needs_per_item`，此時只改紀錄、不建規則。
 */
export async function correctCategory(
  storage: StoragePort,
  record: SpendRecord,
  targetCategoryId: string,
  scope: CorrectionScope = { kind: 'record' },
  opts: { skipPerItem?: boolean; now?: number } = {},
): Promise<CorrectionResult> {
  const now = opts.now ?? Date.now()
  const existingRules = await storage.getAll<Rule>('rules')

  const plan = planCorrection({
    merchant: record.merchant || null,
    items: record.items,
    targetCategoryId,
    scope,
    skipPerItem: opts.skipPerItem,
    existingRules,
    now,
  })
  await applyCorrection(storage, plan)

  const items =
    scope.kind === 'item'
      ? record.items.map((it, i) =>
          i === scope.index ? { ...it, categoryId: targetCategoryId } : it,
        )
      : record.items

  const next: SpendRecord =
    scope.kind === 'item'
      ? { ...record, items, updatedAt: now }
      : {
          ...record,
          items,
          categoryId: targetCategoryId,
          categorySource: 'user',
          classifyConfidence: 1,
          pendingReasons: record.pendingReasons.filter((r) => !CATEGORY_REASONS.includes(r)),
          updatedAt: now,
        }

  next.status = next.pendingReasons.length > 0 ? 'pending' : 'confirmed'
  await storage.put('records', next)

  return { record: next, plan }
}

/** §10 的「確認」：使用者看過了，清掉所有待確認原因。 */
export async function confirmRecord(
  storage: StoragePort,
  record: SpendRecord,
  patch: Partial<SpendRecord> = {},
  now = Date.now(),
): Promise<SpendRecord> {
  const next: SpendRecord = {
    ...record,
    ...patch,
    pendingReasons: [],
    status: 'confirmed',
    updatedAt: now,
  }
  await storage.put('records', next)
  return next
}

export async function deleteRecord(storage: StoragePort, record: SpendRecord): Promise<void> {
  await storage.transaction(['records', 'photos'], async (tx) => {
    await tx.delete('records', record.id)
    if (record.photoId) await tx.delete('photos', record.photoId)
  })
}
