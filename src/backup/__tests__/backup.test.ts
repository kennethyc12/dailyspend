import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Photo, Settings, SpendRecord } from '@/models/types'
import { IndexedDbAdapter, seed } from '@/storage'
import { seedBuiltinRules } from '@/services/ruleService'
import { saveRecord } from '@/services/recordService'
import {
  BACKUP_FORMAT_VERSION,
  BackupFormatError,
  createBackup,
  readBackup,
  restoreBackup,
} from '../backup'
import { categoryNameMap, csvBlob, CSV_COLUMNS, toCsv } from '../csv'
import { backupFileName, csvFileName, dateStamp } from '../share'
import {
  buildBackupFile,
  buildCsvFile,
  commitRestore,
  markBackedUp,
  prepareRestore,
  REMIND_AFTER_RECORDS,
  shouldRemindBackup,
} from '@/services/backupService'

const NOW = 1_760_000_000_000

function rec(over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    id: over.id ?? crypto.randomUUID(),
    date: '2026-10-05',
    merchant: '全家',
    amount: 55,
    items: [{ name: '咖啡', qty: 1, unitPrice: null, amount: null, categoryId: null }],
    categoryId: 'drink',
    categorySource: 'rule',
    classifyConfidence: 0.95,
    recognizeConfidence: null,
    status: 'confirmed',
    pendingReasons: [],
    invoiceNumber: null,
    invoicePeriod: null,
    invoiceKey: null,
    invoiceRandomCode: null,
    sourceType: 'manual',
    photoId: null,
    rawRecognition: null,
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

function photo(id: string): Photo {
  return {
    id,
    blob: new Blob([PHOTO_BYTES], { type: 'image/jpeg' }),
    thumbBlob: new Blob([PHOTO_BYTES.slice(0, 4)], { type: 'image/jpeg' }),
    width: 1600,
    height: 1200,
    bytes: PHOTO_BYTES.length,
    capturedAt: NOW,
  }
}

let storage: IndexedDbAdapter

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
})

describe('CSV', () => {
  it('欄位順序符合 §11', () => {
    expect([...CSV_COLUMNS]).toEqual([
      'date',
      'merchant',
      'items',
      'amount',
      'category',
      'categorySource',
      'classifyConfidence',
      'status',
      'invoiceKey',
      'note',
    ])
  })

  it('品項以分號串接，類別輸出名稱而非 id', () => {
    const csv = toCsv(
      [
        rec({
          items: [
            { name: '咖啡', qty: 1, unitPrice: null, amount: null, categoryId: null },
            { name: '麵包', qty: 1, unitPrice: null, amount: null, categoryId: null },
          ],
        }),
      ],
      { categoryNames: new Map([['drink', '飲料']]) },
    )
    const row = csv.split('\r\n')[1]!
    expect(row).toContain('咖啡;麵包')
    expect(row).toContain('飲料')
  })

  it('未分類輸出「待確認」', () => {
    const csv = toCsv([rec({ categoryId: null })])
    expect(csv).toContain('待確認')
  })

  it('含逗號、引號、換行的欄位會正確跳脫', () => {
    const csv = toCsv([rec({ merchant: '店,家', note: '他說「"讚"」\n第二行' })])
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain('"店,家"')
    expect(csv).toContain('""讚""')
    // 跳脫後換行被包在引號內，整份不會多出一列資料。
    expect(csv.split('\r\n').filter((l) => l.startsWith('2026-10-05'))).toHaveLength(1)
  })

  it('加上 BOM，Excel 才不會把中文開成亂碼', async () => {
    const bytes = new Uint8Array(await csvBlob('date\r\n2026-10-05').arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('categoryNameMap 建出 id → 名稱對照', async () => {
    await seed(storage)
    const map = categoryNameMap(await storage.getAll('categories'))
    expect(map.get('drink')).toBe('飲料')
  })

  it('依日期區間匯出', async () => {
    await seed(storage)
    for (const date of ['2026-09-30', '2026-10-05', '2026-10-20', '2026-11-02']) {
      await saveRecord(storage, rec({ date }))
    }

    const file = await buildCsvFile(storage, { from: '2026-10-01', to: '2026-10-31' })
    const text = await file.text()
    expect(text).toContain('2026-10-05')
    expect(text).toContain('2026-10-20')
    expect(text).not.toContain('2026-09-30')
    expect(text).not.toContain('2026-11-02')
  })

  it('檔名含日期', () => {
    expect(csvFileName(new Date(2026, 9, 9))).toBe('dailyspend-2026-10-09.csv')
    expect(backupFileName(new Date(2026, 9, 9))).toBe('dailyspend-backup-2026-10-09.zip')
    expect(dateStamp(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})

describe('備份完整來回', () => {
  it('匯出後還原，紀錄、規則、類別、設定、照片位元組都一致', async () => {
    await seed(storage)
    await seedBuiltinRules(storage, NOW)
    await saveRecord(storage, rec({ id: 'r1', note: '第一筆' }), { photo: photo('p1') })
    await saveRecord(storage, rec({ id: 'r2', date: '2026-10-06', amount: 120 }))

    const before = {
      records: await storage.count('records'),
      categories: await storage.count('categories'),
      rules: await storage.count('rules'),
      photos: await storage.count('photos'),
    }

    const blob = await createBackup(storage, NOW)

    // 模擬換機或清除資料：全部清空再還原。
    globalThis.indexedDB = new IDBFactory()
    storage = new IndexedDbAdapter()
    expect(await storage.count('records')).toBe(0)

    await restoreBackup(storage, await readBackup(blob))

    expect({
      records: await storage.count('records'),
      categories: await storage.count('categories'),
      rules: await storage.count('rules'),
      photos: await storage.count('photos'),
    }).toEqual(before)

    const r1 = await storage.get<SpendRecord>('records', 'r1')
    expect(r1?.note).toBe('第一筆')
    expect(r1?.items[0]?.name).toBe('咖啡')

    const p1 = await storage.get<Photo>('photos', 'p1')
    expect(p1?.blob.type).toBe('image/jpeg')
    expect(new Uint8Array(await p1!.blob.arrayBuffer())).toEqual(PHOTO_BYTES)
    expect(p1?.thumbBlob.size).toBe(4)
  })

  it('manifest 記錄版本與筆數', async () => {
    await seed(storage)
    await saveRecord(storage, rec())

    const parsed = await readBackup(await createBackup(storage, NOW))
    expect(parsed.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(parsed.manifest.createdAt).toBe(NOW)
    expect(parsed.manifest.counts.records).toBe(1)
    expect(parsed.manifest.counts.categories).toBe(12)
  })

  it('還原會清掉備份裡沒有的資料，不是疊加', async () => {
    await seed(storage)
    await saveRecord(storage, rec({ id: 'keep' }))
    const blob = await createBackup(storage, NOW)

    await saveRecord(storage, rec({ id: 'added-later' }))
    expect(await storage.count('records')).toBe(2)

    await restoreBackup(storage, await readBackup(blob))
    expect(await storage.count('records')).toBe(1)
    expect(await storage.get('records', 'added-later')).toBeUndefined()
  })

  it('空資料庫也能備份與還原', async () => {
    const parsed = await readBackup(await createBackup(storage, NOW))
    expect(parsed.data.records).toEqual([])
    await expect(restoreBackup(storage, parsed)).resolves.toBeUndefined()
  })
})

describe('備份檔驗證', () => {
  it('不是 zip → BackupFormatError', async () => {
    await expect(readBackup(new Blob(['這不是 zip']))).rejects.toBeInstanceOf(BackupFormatError)
  })

  it('zip 裡缺 manifest → BackupFormatError', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const bogus = new Blob([zipSync({ 'readme.txt': strToU8('hi') }) as BlobPart])
    await expect(readBackup(bogus)).rejects.toThrow(/不是 DailySpend 備份檔/)
  })

  it('版本比 App 新 → 擋下並要求更新，不嘗試解讀', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const future = new Blob([
      zipSync({
        'manifest.json': strToU8(
          JSON.stringify({ formatVersion: 99, createdAt: NOW, counts: {} }),
        ),
        'data.json': strToU8('{}'),
      }) as BlobPart,
    ])
    await expect(readBackup(future)).rejects.toThrow(/請先更新/)
  })

  it('照片檔遺失時仍可還原紀錄（紀錄比照片重要）', async () => {
    await seed(storage)
    await saveRecord(storage, rec({ id: 'r1', photoId: 'p1' }), { photo: photo('p1') })

    const { unzipSync, zipSync } = await import('fflate')
    const entries = unzipSync(new Uint8Array(await (await createBackup(storage, NOW)).arrayBuffer()))
    delete entries['photos/p1.bin']
    const damaged = new Blob([zipSync(entries) as BlobPart])

    const parsed = await readBackup(damaged)
    expect(parsed.photos).toHaveLength(0)
    expect(parsed.data.records).toHaveLength(1)
  })
})

describe('還原的兩步驟安全機制', () => {
  it('prepareRestore 會一併產出當前資料的保險備份', async () => {
    await seed(storage)
    await saveRecord(storage, rec({ id: 'current' }))
    const incoming = await createBackup(storage, NOW)

    await saveRecord(storage, rec({ id: 'only-in-current' }))

    const preview = await prepareRestore(storage, incoming, new Date(NOW))
    expect(preview.current.records).toBe(2)
    expect(preview.safetyBackup.name).toMatch(/^dailyspend-backup-.*\.zip$/)

    // 保險備份必須含有即將被覆蓋掉的那筆。
    const safety = await readBackup(preview.safetyBackup)
    expect(safety.data.records.map((r) => r.id)).toContain('only-in-current')
  })

  it('prepareRestore 不會改動資料，要 commit 才覆寫', async () => {
    await seed(storage)
    await saveRecord(storage, rec({ id: 'a' }))
    const incoming = await createBackup(storage, NOW)
    await saveRecord(storage, rec({ id: 'b' }))

    const preview = await prepareRestore(storage, incoming, new Date(NOW))
    expect(await storage.count('records')).toBe(2)

    await commitRestore(storage, preview)
    expect(await storage.count('records')).toBe(1)
    expect(await storage.get('records', 'b')).toBeUndefined()
  })

  it('備份檔壞掉時 prepareRestore 就失敗，不會碰到既有資料', async () => {
    await seed(storage)
    await saveRecord(storage, rec())
    await expect(prepareRestore(storage, new Blob(['壞檔']))).rejects.toBeInstanceOf(
      BackupFormatError,
    )
    expect(await storage.count('records')).toBe(1)
  })
})

describe('備份提醒', () => {
  async function settings(): Promise<Settings> {
    return seed(storage)
  }

  it('從未備份且筆數不足 → 不提醒', async () => {
    expect(shouldRemindBackup(await settings(), REMIND_AFTER_RECORDS - 1, NOW)).toBe(false)
  })

  it('從未備份且達到筆數 → 提醒', async () => {
    expect(shouldRemindBackup(await settings(), REMIND_AFTER_RECORDS, NOW)).toBe(true)
  })

  it('距上次備份未滿 7 天 → 不提醒', async () => {
    const s = await settings()
    s.backup.lastBackupAt = NOW - 6 * 86_400_000
    expect(shouldRemindBackup(s, 100, NOW)).toBe(false)
  })

  it('距上次備份超過 7 天 → 提醒', async () => {
    const s = await settings()
    s.backup.lastBackupAt = NOW - 8 * 86_400_000
    expect(shouldRemindBackup(s, 100, NOW)).toBe(true)
  })

  it('markBackedUp 寫入時間戳', async () => {
    await seed(storage)
    await markBackedUp(storage, NOW)
    const s = await storage.get<Settings>('settings', 'settings')
    expect(s?.backup.lastBackupAt).toBe(NOW)
    expect(shouldRemindBackup(s!, 100, NOW)).toBe(false)
  })

  it('沒有 settings 時不提醒，也不當機', () => {
    expect(shouldRemindBackup(null, 999, NOW)).toBe(false)
  })
})

describe('buildBackupFile', () => {
  it('產出 zip File，檔名含日期', async () => {
    await seed(storage)
    const file = await buildBackupFile(storage, new Date(2026, 9, 9))
    expect(file.name).toBe('dailyspend-backup-2026-10-09.zip')
    expect(file.type).toBe('application/zip')
    expect(file.size).toBeGreaterThan(0)
  })
})
