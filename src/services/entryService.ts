import type { PendingReason, Photo, RecordItem, Rule, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'
import { parseQuickInput, type BlockingError, type QuickInputParse } from '@/parsing/quickInput'
import { classifyWithRules } from '@/classify/ruleClassifier'
import { planCorrection, type CorrectionPlan, type CorrectionScope } from '@/classify/correction'
import { applyCorrection, loadActiveRules, recordHits } from './ruleService'
import { prepareRecord, saveRecord, type SaveOutcome } from './recordService'
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

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

interface Classified {
  categoryId: string | null
  itemCategoryIds: (string | null)[]
  classifyConfidence: number
  matchedRuleIds: string[]
  pendingReasons: PendingReason[]
}

async function classify(
  storage: StoragePort,
  input: { merchant: string | null; items: { name: string }[] },
): Promise<Classified> {
  const [rules, settings] = await Promise.all([
    loadActiveRules(storage),
    storage.get<Settings>('settings', 'settings'),
  ])
  return classifyWithRules(input, rules, settings?.confidence.pendingBelow ?? 0.6)
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
  photo?: Photo,
): Promise<EntryResult> {
  const [dict, settings] = await Promise.all([
    merchantDictionary(storage),
    storage.get<Settings>('settings', 'settings'),
  ])

  const parse = parseQuickInput(text, { merchantDict: dict })
  if (parse.blockingError) return { ok: false, blocked: parse.blockingError, parse }

  const classified = await classify(storage, { merchant: parse.merchant, items: parse.items })

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
    // 附照片不等於欄位比較可信——照片只是證據，金額仍是手打的。
    // sourceType 影響 §7.3 的 merge 優先序，等 QR 真的解出欄位才改成 'photo'。
    sourceType: 'manual',
    photoId: photo?.id ?? null,
    rawRecognition: null,
    note: '',
    createdAt: now,
    updatedAt: now,
  }

  const save = await saveRecord(storage, record, { now, photo })
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

export function getRecord(storage: StoragePort, id: string): Promise<SpendRecord | undefined> {
  return storage.get<SpendRecord>('records', id)
}

export interface RecordPatch {
  date?: string
  merchant?: string
  amount?: number
  /** 品項名稱清單。同名的品項會保留既有的 categoryId，新的才重跑分類。 */
  itemNames?: string[]
  note?: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 編輯既有紀錄。分類來源是 `user` 時不會被重跑的規則蓋掉——
 * 使用者改過的分類比規則可信（§7.3 同樣的原則）。
 */
export async function updateRecordFields(
  storage: StoragePort,
  record: SpendRecord,
  patch: RecordPatch,
  now = Date.now(),
): Promise<SpendRecord> {
  const date = patch.date ?? record.date
  if (!ISO_DATE.test(date)) throw new ValidationError('日期格式需為 YYYY-MM-DD', 'date')

  const amount = patch.amount ?? record.amount
  if (!Number.isInteger(amount)) throw new ValidationError('金額必須是整數（元）', 'amount')
  if (amount < 0) throw new ValidationError('金額不能是負數', 'amount')

  const merchant = (patch.merchant ?? record.merchant).trim()

  const previous = new Map(record.items.map((i) => [i.name, i]))
  const items: RecordItem[] =
    patch.itemNames === undefined
      ? record.items
      : patch.itemNames
          .map((n) => n.trim())
          .filter(Boolean)
          .map(
            (name) =>
              previous.get(name) ?? {
                name,
                qty: 1,
                unitPrice: null,
                amount: null,
                categoryId: null,
              },
          )

  const structureChanged =
    merchant !== record.merchant ||
    items.length !== record.items.length ||
    items.some((it, i) => it.name !== record.items[i]?.name)

  let next: SpendRecord = {
    ...record,
    date,
    merchant,
    amount,
    items,
    note: patch.note ?? record.note,
    updatedAt: now,
  }

  // 店家或品項變了就重跑分類，但使用者指定過的類別不動。
  if (structureChanged && record.categorySource !== 'user') {
    const out = await classify(storage, { merchant: merchant || null, items })
    next = {
      ...next,
      categoryId: out.categoryId,
      classifyConfidence: out.classifyConfidence,
      items: items.map((it, i) => ({ ...it, categoryId: out.itemCategoryIds[i] ?? null })),
      pendingReasons: [
        ...new Set<PendingReason>([
          ...next.pendingReasons.filter((r) => !CATEGORY_REASONS.includes(r)),
          ...out.pendingReasons,
        ]),
      ],
    }
    await recordHits(storage, out.matchedRuleIds, now)
  }

  // invoiceKey 由 prepareRecord 重算——它是 unique index 的 key，
  // 改了日期就必須跟著改，而且只能有一個產生點（§7.1）。
  next = prepareRecord(next)
  next.status = next.pendingReasons.length > 0 ? 'pending' : 'confirmed'

  await storage.put('records', next)
  return next
}

/** 替既有紀錄換一張照片。舊照片在同一個 transaction 內刪掉，不留孤兒。 */
export async function attachPhoto(
  storage: StoragePort,
  record: SpendRecord,
  photo: Photo,
  now = Date.now(),
): Promise<SpendRecord> {
  const next: SpendRecord = { ...record, photoId: photo.id, updatedAt: now }
  const previousId = record.photoId

  await storage.transaction(['records', 'photos'], async (tx) => {
    if (previousId && previousId !== photo.id) await tx.delete('photos', previousId)
    await tx.put('photos', photo)
    await tx.put('records', next)
  })
  return next
}

export async function removePhoto(
  storage: StoragePort,
  record: SpendRecord,
  now = Date.now(),
): Promise<SpendRecord> {
  if (!record.photoId) return record
  const next: SpendRecord = { ...record, photoId: null, updatedAt: now }
  const previousId = record.photoId

  await storage.transaction(['records', 'photos'], async (tx) => {
    await tx.delete('photos', previousId)
    await tx.put('records', next)
  })
  return next
}

export function getPhoto(storage: StoragePort, id: string): Promise<Photo | undefined> {
  return storage.get<Photo>('photos', id)
}

export async function deleteRecord(storage: StoragePort, record: SpendRecord): Promise<void> {
  await storage.transaction(['records', 'photos'], async (tx) => {
    await tx.delete('records', record.id)
    if (record.photoId) await tx.delete('photos', record.photoId)
  })
}
