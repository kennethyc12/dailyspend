import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Category, Photo, Rule, Settings, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'

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
  let data: BackupData
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest
    data = JSON.parse(strFromU8(dataBytes)) as BackupData
  } catch {
    throw new BackupFormatError('備份檔內容損毀')
  }

  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `備份檔版本為 ${manifest.formatVersion}，這個版本的 App 最高支援 ${BACKUP_FORMAT_VERSION}，請先更新`,
    )
  }

  const photos: Photo[] = []
  for (const meta of data.photos ?? []) {
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

      for (const r of data.records ?? []) await tx.put('records', r)
      for (const c of data.categories ?? []) await tx.put('categories', c)
      for (const r of data.rules ?? []) await tx.put('rules', r)
      for (const p of photos) await tx.put('photos', p)
      if (data.settings) await tx.put('settings', data.settings)
    },
  )
}
