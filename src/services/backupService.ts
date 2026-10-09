import type { Category, Settings, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'
import { categoryNameMap, csvBlob, toCsv } from '@/backup/csv'
import { backupFileName, csvFileName } from '@/backup/share'
import {
  createBackup,
  readBackup,
  restoreBackup,
  type ParsedBackup,
} from '@/backup/backup'

const DAY_MS = 86_400_000

/** 從未備份過時，累積到這個筆數就開始提醒。 */
export const REMIND_AFTER_RECORDS = 20

export interface DateRange {
  from?: string
  to?: string
}

export async function buildCsvFile(
  storage: StoragePort,
  range: DateRange = {},
  now = new Date(),
): Promise<File> {
  const records =
    range.from || range.to
      ? await storage.query<SpendRecord>('records', 'by_date', {
          gte: range.from,
          lte: range.to,
        })
      : await storage.getAll<SpendRecord>('records')

  const categories = await storage.getAll<Category>('categories')
  const settings = await storage.get<Settings>('settings', 'settings')

  const csv = toCsv(
    [...records].sort((a, b) => a.date.localeCompare(b.date)),
    { delimiter: settings?.export.delimiter ?? ',', categoryNames: categoryNameMap(categories) },
  )

  return new File([csvBlob(csv)], csvFileName(now), { type: 'text/csv;charset=utf-8' })
}

export async function buildBackupFile(storage: StoragePort, now = new Date()): Promise<File> {
  const blob = await createBackup(storage, now.getTime())
  return new File([blob], backupFileName(now), { type: 'application/zip' })
}

export async function markBackedUp(storage: StoragePort, now = Date.now()): Promise<void> {
  const settings = await storage.get<Settings>('settings', 'settings')
  if (!settings) return
  await storage.put('settings', {
    ...settings,
    backup: { ...settings.backup, lastBackupAt: now },
    updatedAt: now,
  })
}

export function shouldRemindBackup(
  settings: Settings | null,
  recordCount: number,
  now = Date.now(),
): boolean {
  if (!settings) return false
  const { lastBackupAt, remindAfterDays } = settings.backup

  // 從未備份過：資料還很少時不吵，累積到一定筆數才提醒。
  if (lastBackupAt === null) return recordCount >= REMIND_AFTER_RECORDS
  return now - lastBackupAt > remindAfterDays * DAY_MS
}

export interface RestorePreview {
  parsed: ParsedBackup
  /** 還原前先自動匯出的當前資料，呼叫端必須先交給使用者再 commit。 */
  safetyBackup: File
  current: { records: number; photos: number }
}

/**
 * 還原第一步：解析備份檔、同時產出當前資料的保險備份。
 *
 * 刻意拆成兩步，讓「二次確認」與「先自動匯出一份當前備份」（§11）
 * 在 API 上就是強制的，而不是靠呼叫端自律。
 */
export async function prepareRestore(
  storage: StoragePort,
  file: Blob,
  now = new Date(),
): Promise<RestorePreview> {
  const parsed = await readBackup(file)
  const safetyBackup = await buildBackupFile(storage, now)

  return {
    parsed,
    safetyBackup,
    current: {
      records: await storage.count('records'),
      photos: await storage.count('photos'),
    },
  }
}

/** 還原第二步：**覆寫所有資料**。呼叫前必須已取得使用者的二次確認。 */
export async function commitRestore(
  storage: StoragePort,
  preview: RestorePreview,
): Promise<void> {
  await restoreBackup(storage, preview.parsed)
}
