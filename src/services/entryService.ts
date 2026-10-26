import type { PendingReason, Photo, RecordItem, Rule, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'
import { parseQuickInput, type BlockingError, type QuickInputParse } from '@/parsing/quickInput'
import { classifyWithRules } from '@/classify/ruleClassifier'
import type { ClassifyInput } from '@/classify/port'
import { planCorrection, type CorrectionPlan, type CorrectionScope } from '@/classify/correction'
import {
  applyCorrection,
  bumpHits,
  loadActiveRules,
  recordHits,
  writeCorrection,
} from './ruleService'
import { prepareRecord, saveRecord, type SaveOutcome } from './recordService'
import type { Settings } from '@/models/types'
import { ISO_DATE, isValidYmd, parseIso } from '@/analysis/dates'

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

export interface Classified {
  categoryId: string | null
  itemCategoryIds: (string | null)[]
  classifyConfidence: number
  matchedRuleIds: string[]
  pendingReasons: PendingReason[]
}

export type Classifier = (input: ClassifyInput) => Classified

/** 讀一次規則與設定，之後同步分類。批次分類（載具匯入）不用每筆重讀規則。 */
export async function loadClassifier(storage: StoragePort): Promise<Classifier> {
  const [rules, settings] = await Promise.all([
    loadActiveRules(storage),
    storage.get<Settings>('settings', 'settings'),
  ])
  const pendingBelow = settings?.confidence.pendingBelow ?? 0.6
  return (input) => classifyWithRules(input, rules, pendingBelow)
}

export async function classify(storage: StoragePort, input: ClassifyInput): Promise<Classified> {
  return (await loadClassifier(storage))(input)
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
  const settings = await storage.get<Settings>('settings', 'settings')

  const parse = parseQuickInput(text)
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
    rawInput: parse.raw,
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

/** 套用分類結果：舊的分類原因換成新的，其他原因保留。呼叫端負責「使用者指定的類別不重跑」。 */
export function applyClassification(record: SpendRecord, out: Classified): SpendRecord {
  const pendingReasons = [
    ...new Set<PendingReason>([
      ...record.pendingReasons.filter((r) => !CATEGORY_REASONS.includes(r)),
      ...out.pendingReasons,
    ]),
  ]
  return {
    ...record,
    categoryId: out.categoryId,
    classifyConfidence: out.classifyConfidence,
    items: record.items.map((it, i) => ({ ...it, categoryId: out.itemCategoryIds[i] ?? null })),
    pendingReasons,
    status: pendingReasons.length > 0 ? 'pending' : 'confirmed',
  }
}

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

  const prepared = prepareRecord(next)
  await storage.put('records', prepared)

  return { record: prepared, plan }
}

export interface ResolveOptions {
  /** 卡片上的草稿類別。null = 沒選，維持紀錄現在的類別。 */
  categoryId: string | null
  /** 「確認並記住規則」。 */
  remember: boolean
  /** 逐項面板的「略過，只記住店家」。 */
  skipPerItem?: boolean
  /** 就地編輯時重分類命中、且最後採用了重分類結果的規則（B4.2b-2）。 */
  hitRuleIds?: string[]
  now?: number
}

export type ResolveResult =
  | { kind: 'needs_per_item'; itemNames: string[] }
  /** learned 為 null 且 remember 為 true：沒有店家或品項可記，只確認。 */
  | { kind: 'confirmed'; record: SpendRecord; learned: Rule | null }

/**
 * §10 待確認卡的「確認」與「確認並記住規則」（B4.2a）。
 * 確認清空全部原因、不經過 prepareRecord（同 confirmRecord，理由見 B4.1）。
 * 規則與紀錄同一個 transaction：不會出現「規則學了、紀錄還在待確認」。
 */
export async function resolvePending(
  storage: StoragePort,
  record: SpendRecord,
  opts: ResolveOptions,
): Promise<ResolveResult> {
  const now = opts.now ?? Date.now()
  const categoryId = opts.categoryId ?? record.categoryId
  if (opts.remember && categoryId === null) {
    throw new ValidationError('請先選類別', 'category')
  }

  let plan: CorrectionPlan | null = null
  if (opts.remember && categoryId !== null) {
    plan = planCorrection({
      merchant: record.merchant || null,
      items: record.items,
      targetCategoryId: categoryId,
      scope: { kind: 'record' },
      skipPerItem: opts.skipPerItem,
      existingRules: await storage.getAll<Rule>('rules'),
      now,
    })
    if (plan.kind === 'needs_per_item') return plan
  }

  // 只有類別真的改了才算使用者指定；確認規則猜的結果不改來源
  const changed = categoryId !== record.categoryId
  const next: SpendRecord = {
    ...record,
    ...(changed ? { categoryId, categorySource: 'user' as const, classifyConfidence: 1 } : {}),
    pendingReasons: [],
    status: 'confirmed',
    updatedAt: now,
  }

  const learned = await storage.transaction(['rules', 'records'], async (tx) => {
    const rule = plan ? await writeCorrection(tx, plan) : null
    if (opts.hitRuleIds?.length) await bumpHits(tx, opts.hitRuleIds, now)
    await tx.put('records', next)
    return rule
  })
  return { kind: 'confirmed', record: next, learned }
}

/** 逐項面板選類別：立即學品項規則，紀錄等「完成並確認」再寫（B4.2b-2）。 */
export async function learnItemRule(
  storage: StoragePort,
  items: { name: string }[],
  index: number,
  categoryId: string,
  now = Date.now(),
): Promise<Rule | null> {
  const plan = planCorrection({
    merchant: null,
    items,
    targetCategoryId: categoryId,
    scope: { kind: 'item', index },
    existingRules: await storage.getAll<Rule>('rules'),
    now,
  })
  return applyCorrection(storage, plan)
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
  /**
   * 品項名稱清單。和舊品項依位置與順序對應（同名的各自保留），沿用舊品項的數量、金額與分類；
   * 對不上的是新品項。店家或品名有變時會重分類，規則來源的逐項分類會被重算。
   */
  itemNames?: string[]
  note?: string
}

export interface RecordUpdate {
  record: SpendRecord
  /** 重分類命中的規則；呼叫端決定要不要、何時累計命中次數。 */
  matchedRuleIds: string[]
}

/**
 * 不能用品名當 Map key：同名品項會全拿到最後一個的數量與金額。
 * 相鄰同名刪掉一個時，從文字分不出刪的是哪個，保留前面那個。
 */
function matchItems(previous: RecordItem[], names: string[]): RecordItem[] {
  const limit = Math.min(names.length, previous.length)
  let head = 0
  while (head < limit && names[head] === previous[head]!.name) head++
  let tail = 0
  while (
    tail < limit - head &&
    names[names.length - 1 - tail] === previous[previous.length - 1 - tail]!.name
  )
    tail++

  const pool = new Map<string, RecordItem[]>()
  for (const item of previous.slice(head, previous.length - tail)) {
    const queue = pool.get(item.name)
    if (queue) queue.push(item)
    else pool.set(item.name, [item])
  }

  return names.map((name, i) => {
    if (i < head) return previous[i]!
    if (i >= names.length - tail) return previous[previous.length - (names.length - i)]!
    return (
      pool.get(name)?.shift() ?? { name, qty: 1, unitPrice: null, amount: null, categoryId: null }
    )
  })
}

/** updateRecordFields 的「算」：驗證、重組品項、必要時重分類、prepareRecord。不寫入。 */
export async function computeRecordUpdate(
  storage: StoragePort,
  record: SpendRecord,
  patch: RecordPatch,
  opts: { now?: number; reclassify?: boolean } = {},
): Promise<RecordUpdate> {
  const now = opts.now ?? Date.now()
  const date = patch.date ?? record.date
  if (!ISO_DATE.test(date)) throw new ValidationError('日期格式需為 YYYY-MM-DD', 'date')
  const { y, m, d } = parseIso(date)
  if (!isValidYmd(y, m, d)) throw new ValidationError('日期不存在', 'date')

  const amount = patch.amount ?? record.amount
  if (!Number.isInteger(amount)) throw new ValidationError('金額必須是整數（元）', 'amount')
  if (amount < 0) throw new ValidationError('金額不能是負數', 'amount')

  const merchant = (patch.merchant ?? record.merchant).trim()

  const items: RecordItem[] =
    patch.itemNames === undefined
      ? record.items
      : matchItems(
          record.items,
          patch.itemNames.map((n) => n.trim()).filter(Boolean),
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

  let matchedRuleIds: string[] = []
  // 店家或品項變了就重跑分類，但使用者指定過的類別不動。
  if (opts.reclassify !== false && structureChanged && record.categorySource !== 'user') {
    const out = await classify(storage, { merchant: merchant || null, items })
    next = applyClassification(next, out)
    matchedRuleIds = out.matchedRuleIds
  }

  // invoiceKey 由 prepareRecord 重算——它是 unique index 的 key，
  // 改了日期就必須跟著改，而且只能有一個產生點（§7.1）。
  next = prepareRecord(next)
  next.status = next.pendingReasons.length > 0 ? 'pending' : 'confirmed'
  return { record: next, matchedRuleIds }
}

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
  const { record: next, matchedRuleIds } = await computeRecordUpdate(storage, record, patch, {
    now,
  })
  await recordHits(storage, matchedRuleIds, now)
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

/** 照片 id 讀 DB 當下的值：呼叫端的快照可能已過期，用它會刪到別筆的照片、留下孤兒照片。 */
export async function deleteRecords(storage: StoragePort, ids: string[]): Promise<number> {
  return storage.transaction(['records', 'photos'], async (tx) => {
    let deleted = 0
    for (const id of ids) {
      const current = await tx.get<SpendRecord>('records', id)
      if (!current) continue
      await tx.delete('records', id)
      if (current.photoId) await tx.delete('photos', current.photoId)
      deleted++
    }
    return deleted
  })
}

export async function deleteRecord(storage: StoragePort, record: SpendRecord): Promise<void> {
  await deleteRecords(storage, [record.id])
}
