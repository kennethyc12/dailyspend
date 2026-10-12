// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SpendRecord } from '@/models/types'
import BackupView from '@/views/BackupView.vue'
import { BACKUP_FORMAT_VERSION, createBackup } from '@/backup/backup'
import { createFromText } from '@/services/entryService'
import { button, mountView, pickFile, useViewTest, waitForText } from '@/test/mountView'

vi.mock('@/backup/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/backup/share')>()),
  saveFile: vi.fn(async () => 'downloaded' as const),
}))

const { storage } = useViewTest()

async function backupWithoutRecords(): Promise<File> {
  const entries = unzipSync(new Uint8Array(await (await createBackup(storage())).arrayBuffer()))
  const data = JSON.parse(strFromU8(entries['data.json']!)) as Record<string, object>
  delete data.records
  entries['data.json'] = strToU8(JSON.stringify(data))
  return new File([zipSync(entries)], 'broken.zip', { type: 'application/zip' })
}

/** 兩筆同 invoiceKey 會撞上 unique index：清空之後第二筆寫入必定失敗。 */
function conflictingBackup(): File {
  const key = '11509-AB12345678'
  const record = (id: string): Partial<SpendRecord> => ({
    id,
    date: '2026-10-05',
    merchant: '全家',
    amount: 55,
    items: [],
    status: 'confirmed',
    pendingReasons: [],
    invoiceKey: key,
  })
  const zip = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({ formatVersion: BACKUP_FORMAT_VERSION, createdAt: 0, counts: { records: 2 } }),
    ),
    'data.json': strToU8(
      JSON.stringify({ records: [record('x1'), record('x2')], categories: [], rules: [], settings: null, photos: [] }),
    ),
  })
  return new File([zip], 'conflict.zip', { type: 'application/zip' })
}

describe('備份與還原', () => {
  it('選到缺 records 的備份檔 → 說明哪裡壞了，既有資料不動', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    await createFromText(storage(), '全聯 蛋 85')
    const broken = await backupWithoutRecords()

    const wrapper = await mountView(BackupView, '/backup')
    await pickFile(wrapper.find<HTMLInputElement>('input[type="file"]'), broken)

    await waitForText(wrapper, '備份檔缺少 records 清單')
    expect(await storage().count('records')).toBe(2)
  })

  it('還原寫到一半失敗 → 顯示「資料未變更」，而且資料真的沒變', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    await createFromText(storage(), '全聯 蛋 85')

    const wrapper = await mountView(BackupView, '/backup')
    await pickFile(wrapper.find<HTMLInputElement>('input[type="file"]'), conflictingBackup())
    await waitForText(wrapper, '② 確認覆寫並還原')

    await button(wrapper, '① 先存下目前資料的保險備份').trigger('click')
    await waitForText(wrapper, '已存下保險備份')
    await button(wrapper, '② 確認覆寫並還原').trigger('click')

    await waitForText(wrapper, '還原失敗，資料未變更')
    const merchants = (await storage().getAll<SpendRecord>('records')).map((r) => r.merchant).sort()
    expect(merchants).toEqual(['全家', '全聯'])
  })
})
