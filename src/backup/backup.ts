import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Category, Photo, Rule, Settings, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'
import { isValidIsoDate } from '@/analysis/dates'
import { buildInvoiceKey } from '@/dedupe/invoiceKey'

export const BACKUP_FORMAT_VERSION = 1

const MANIFEST_PATH = 'manifest.json'
const DATA_PATH = 'data.json'
const PHOTO_DIR = 'photos'

export interface BackupManifest {
  formatVersion: number
  createdAt: number
  counts: { records: number; categories: number; rules: number; photos: number }
}

/** 照片的二進位內容另外放在 zip 裡，data.json 只留中繼資料。 */
export interface PhotoMeta extends Omit<Photo, 'blob' | 'thumbBlob'> {
  blobType: string
  thumbType: string
}

export interface BackupData {
  records: SpendRecord[]
  categories: Category[]
  rules: Rule[]
  settings: Settings | null
  photos: PhotoMeta[]
}

export interface ParsedBackup {
  manifest: BackupManifest
  data: BackupData
  photos: Photo[]
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupFormatError'
  }
}

type Fields = Record<string, unknown>
type Kind = 'string' | 'number' | 'integer' | 'array' | 'object' | 'string|null'

function ok(v: unknown, kind: Kind): boolean {
  switch (kind) {
    case 'string':
      return typeof v === 'string'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'integer':
      return Number.isInteger(v)
    case 'array':
      return Array.isArray(v)
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v)
    case 'string|null':
      return v === null || typeof v === 'string'
  }
}

/** where 例如「第 3 筆紀錄」；訊息給使用者看，要指得到哪一筆、哪個欄位。 */
function requireField(obj: Fields, key: string, kind: Kind, where: string) {
  if (!ok(obj[key], kind)) throw new BackupFormatError(`備份檔${where}的 ${key} 缺少或格式錯誤`)
}

function eachEntry(list: unknown[], label: string, check: (o: Fields, where: string) => void) {
  list.forEach((item, i) => {
    const where = `第 ${i + 1} 筆${label}`
    if (!ok(item, 'object')) throw new BackupFormatError(`備份檔${where}不是物件`)
    check(item as Fields, where)
  })
}

// 只驗讀取端會炸、會算出 NaN、或會讓去重失效的欄位。enum 成員不驗：
// 型別定義沒有 runtime 清單，另抄一份就是兩個來源。
function checkRecord(r: Fields, where: string) {
  requireField(r, 'id', 'string', where)
  requireField(r, 'date', 'string', where)
  if (!isValidIsoDate(r.date as string)) throw new BackupFormatError(`備份檔${where}的日期不存在`)
  requireField(r, 'merchant', 'string', where)
  requireField(r, 'amount', 'integer', where)
  if ((r.amount as number) < 0) throw new BackupFormatError(`備份檔${where}的金額是負數`)
  requireField(r, 'items', 'array', where)
  ;(r.items as unknown[]).forEach((it, j) => {
    const at = `${where}的第 ${j + 1} 個品項`
    if (!ok(it, 'object')) throw new BackupFormatError(`備份檔${at}不是物件`)
    requireField(it as Fields, 'name', 'string', at)
  })
  requireField(r, 'categoryId', 'string|null', where)
  requireField(r, 'categorySource', 'string', where)
  requireField(r, 'classifyConfidence', 'number', where)
  requireField(r, 'status', 'string', where)
  requireField(r, 'pendingReasons', 'array', where)
  requireField(r, 'invoiceNumber', 'string|null', where)
  requireField(r, 'invoicePeriod', 'string|null', where)
  requireField(r, 'invoiceKey', 'string|null', where)
  requireField(r, 'note', 'string', where)

  // invoiceKey 是 unique index 的 key：和欄位對不上，之後的去重會靜默失效
  const expected = buildInvoiceKey(r.date as string, r.invoiceNumber as string | null)
  if (r.invoiceKey !== expected.invoiceKey || r.invoicePeriod !== expected.invoicePeriod) {
    throw new BackupFormatError(`備份檔${where}的發票去重鍵和日期、號碼對不上`)
  }
}

function checkRule(r: Fields, where: string) {
  for (const key of ['id', 'pattern', 'categoryId']) requireField(r, key, 'string', where)
  for (const key of ['priority', 'hitCount']) requireField(r, key, 'number', where)
}

function checkCategory(c: Fields, where: string) {
  requireField(c, 'id', 'string', where)
  requireField(c, 'name', 'string', where)
}

function checkPhotoMeta(p: Fields, where: string) {
  requireField(p, 'id', 'string', where)
}

function assertBackupShape(data: unknown): asserts data is BackupData {
  if (typeof data !== 'object' || data === null) throw new BackupFormatError('data.json 不是物件')
  const d = data as Partial<Record<keyof BackupData, unknown>>
  for (const key of ['records', 'categories', 'rules', 'photos'] as const) {
    if (!Array.isArray(d[key])) throw new BackupFormatError(`備份檔缺少 ${key} 清單`)
  }
  if (d.settings !== null && typeof d.settings !== 'object') {
    throw new BackupFormatError('備份檔的 settings 格式錯誤')
  }
  eachEntry(d.records as unknown[], '紀錄', checkRecord)
  eachEntry(d.rules as unknown[], '規則', checkRule)
  eachEntry(d.categories as unknown[], '類別', checkCategory)
  eachEntry(d.photos as unknown[], '照片', checkPhotoMeta)
}

async function toBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

export async function createBackup(storage: StoragePort, now = Date.now()): Promise<Blob> {
  const [records, categories, rules, photos, settings] = await Promise.all([
    storage.getAll<SpendRecord>('records'),
    storage.getAll<Category>('categories'),
    storage.getAll<Rule>('rules'),
    storage.getAll<Photo>('photos'),
    storage.get<Settings>('settings', 'settings'),
  ])

  const files: Record<string, Uint8Array> = {}
  const photoMetas: PhotoMeta[] = []

  for (const p of photos) {
    const { blob, thumbBlob, ...meta } = p
    photoMetas.push({ ...meta, blobType: blob.type, thumbType: thumbBlob.type })
    files[`${PHOTO_DIR}/${p.id}.bin`] = await toBytes(blob)
    files[`${PHOTO_DIR}/${p.id}.thumb.bin`] = await toBytes(thumbBlob)
  }

  const data: BackupData = { records, categories, rules, settings: settings ?? null, photos: photoMetas }
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now,
    counts: {
      records: records.length,
      categories: categories.length,
      rules: rules.length,
      photos: photos.length,
    },
  }

  files[MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 2))
  files[DATA_PATH] = strToU8(JSON.stringify(data))

  // 照片已經是 JPEG，再壓一次只是浪費時間；JSON 才值得壓。
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}

export async function readBackup(file: Blob): Promise<ParsedBackup> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(await toBytes(file))
  } catch {
    throw new BackupFormatError('不是有效的 zip 檔')
  }

  const manifestBytes = entries[MANIFEST_PATH]
  const dataBytes = entries[DATA_PATH]
  if (!manifestBytes || !dataBytes) {
    throw new BackupFormatError('缺少 manifest.json 或 data.json，這不是 DailySpend 備份檔')
  }

  let manifest: BackupManifest
  let data: unknown
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest
    data = JSON.parse(strFromU8(dataBytes))
  } catch {
    throw new BackupFormatError('備份檔內容損毀')
  }

  if (!ok(manifest, 'object') || !Number.isInteger(manifest.formatVersion)) {
    throw new BackupFormatError('manifest.json 格式錯誤，這不是 DailySpend 備份檔')
  }
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `備份檔版本為 ${manifest.formatVersion}，這個版本的 App 最高支援 ${BACKUP_FORMAT_VERSION}，請先更新`,
    )
  }

  assertBackupShape(data)

  const photos: Photo[] = []
  for (const meta of data.photos) {
    const blobBytes = entries[`${PHOTO_DIR}/${meta.id}.bin`]
    const thumbBytes = entries[`${PHOTO_DIR}/${meta.id}.thumb.bin`]
    // 照片遺失不該讓整份備份無法還原——紀錄本身比照片重要。
    if (!blobBytes || !thumbBytes) continue

    const { blobType, thumbType, ...rest } = meta
    photos.push({
      ...rest,
      blob: new Blob([blobBytes as BlobPart], { type: blobType }),
      thumbBlob: new Blob([thumbBytes as BlobPart], { type: thumbType }),
    })
  }

  return { manifest, data, photos }
}

/**
 * **破壞性操作**：清空所有 store 再寫入備份內容。
 *
 * 解壓與 JSON 解析都已在 `readBackup()` 完成，這裡只做讀寫，
 * 才不會讓 transaction 提前 commit（§2.2）。
 */
export async function restoreBackup(storage: StoragePort, parsed: ParsedBackup): Promise<void> {
  const { data, photos } = parsed

  await storage.transaction(
    ['records', 'categories', 'rules', 'photos', 'settings'],
    async (tx) => {
      await tx.clear('records')
      await tx.clear('categories')
      await tx.clear('rules')
      await tx.clear('photos')
      await tx.clear('settings')

      for (const r of data.records) await tx.put('records', r)
      for (const c of data.categories) await tx.put('categories', c)
      for (const r of data.rules) await tx.put('rules', r)
      for (const p of photos) await tx.put('photos', p)
      if (data.settings) await tx.put('settings', data.settings)
    },
  )
}
