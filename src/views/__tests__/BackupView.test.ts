// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SpendRecord } from '@/models/types'
import BackupView from '@/views/BackupView.vue'
import { BACKUP_FORMAT_VERSION, createBackup } from '@/backup/backup'
import { createFromText } from '@/services/entryService'
import { button, mountView, pickFile, useViewTest, waitForText } from '@/test/mountView'
import { carrierCsv, type CarrierRowOptions } from '@/test/fixtures'
import { initStorage } from '@/composables/useStorageStatus'
import { pendingRecords, refreshRecords } from '@/composables/useRecords'
import { todayIso } from '@/parsing/quickInput'
import { saveFile } from '@/backup/share'

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
    await pickFile(wrapper.find<HTMLInputElement>('input[accept=".zip,application/zip"]'), broken)

    await waitForText(wrapper, '讀取失敗：備份檔缺少 records 清單')
    expect(await storage().count('records')).toBe(2)
  })

  it('還原寫到一半失敗 → 顯示「資料未變更」，而且資料真的沒變', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    await createFromText(storage(), '全聯 蛋 85')

    const wrapper = await mountView(BackupView, '/backup')
    await pickFile(wrapper.find<HTMLInputElement>('input[accept=".zip,application/zip"]'), conflictingBackup())
    await waitForText(wrapper, '② 確認覆寫並還原')

    await button(wrapper, '① 先存下目前資料的保險備份').trigger('click')
    await waitForText(wrapper, '已存下保險備份')
    await button(wrapper, '② 確認覆寫並還原').trigger('click')

    await waitForText(wrapper, '還原失敗，資料未變更')
    const merchants = (await storage().getAll<SpendRecord>('records')).map((r) => r.merchant).sort()
    expect(merchants).toEqual(['全家', '全聯'])
  })
})

describe('還原：錯誤處理分工（B5a）', () => {
  it('備份檔裡有重複的發票：說明原因，不顯示原文、不記錯誤', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    const wrapper = await mountView(BackupView, '/backup')
    await pickFile(wrapper.find<HTMLInputElement>('input[accept=".zip,application/zip"]'), conflictingBackup())
    await waitForText(wrapper, '② 確認覆寫並還原')
    await button(wrapper, '① 先存下目前資料的保險備份').trigger('click')
    await waitForText(wrapper, '已存下保險備份')
    await button(wrapper, '② 確認覆寫並還原').trigger('click')

    await waitForText(wrapper, '還原失敗，資料未變更：備份檔裡有兩筆紀錄是同一張發票')
    expect(wrapper.find('.result.warn').text()).toBe(
      '還原失敗，資料未變更：備份檔裡有兩筆紀錄是同一張發票',
    )
  })
})

describe('載具 CSV 匯入', () => {
  // useViewTest 只 seed；BackupView 不自己初始化，不跑的話 storageState 不是 ready，匯入輸入框會停用。
  beforeEach(() => initStorage())

  const TODAY = `${todayIso().replace(/-/g, '/')} 12:00:00`

  const csvInput = (w: VueWrapper) => w.find<HTMLInputElement>('input[accept^=".csv"]')
  const zipInput = (w: VueWrapper) => w.find<HTMLInputElement>('input[accept=".zip,application/zip"]')

  async function pickCsv(w: VueWrapper, text: string) {
    await pickFile(csvInput(w), new File([text], 'invoices.csv', { type: 'text/csv' }))
  }

  async function previewOf(rows: CarrierRowOptions[]) {
    const wrapper = await mountView(BackupView, '/backup')
    await pickCsv(wrapper, carrierCsv(rows))
    await waitForText(wrapper, '會進待確認')
    return wrapper
  }

  async function backupZip(): Promise<File> {
    const bytes = new Uint8Array(await (await createBackup(storage())).arrayBuffer())
    return new File([bytes], 'b.zip', { type: 'application/zip' })
  }

  function radios(w: VueWrapper, index: number) {
    return w.findAll<HTMLInputElement>(`input[name="candidate-${index}"]`)
  }

  function stat(w: VueWrapper, label: string): string {
    const dts = w.findAll('.import-preview dt')
    const i = dts.findIndex((dt) => dt.text() === label)
    return w.findAll('.import-preview dd')[i]!.text()
  }

  async function confirm(w: VueWrapper) {
    await button(w, '確認匯入').trigger('click')
    await waitForText(w, '匯入完成')
  }

  it('選 CSV → 預覽 → 確認後寫入', async () => {
    const wrapper = await previewOf([{ total: '55' }, { number: 'ZZ00000002', total: '55' }])
    await confirm(wrapper)
    expect(wrapper.text()).toContain('匯入完成：新增 2')
    expect(await storage().count('records')).toBe(2)
  })

  it('表頭不符 → 說明不是發票存摺的 CSV，資料不變', async () => {
    const wrapper = await mountView(BackupView, '/backup')
    await pickCsv(wrapper, carrierCsv([{ total: '55' }]).replace('店家名稱', '商店名稱'))
    await waitForText(wrapper, '這不是發票存摺匯出的 CSV')
    expect(await storage().count('records')).toBe(0)
  })

  it('格式損壞 → 訊息帶列號', async () => {
    const wrapper = await mountView(BackupView, '/backup')
    await pickCsv(wrapper, `${carrierCsv([{ total: '55' }])}2026/09/01 12:00:00,ZZ00000009,店\n`)
    await waitForText(wrapper, '檔案第 3 列格式損壞')
  })

  it('被拒收的發票列出中文原因與列號', async () => {
    const wrapper = await previewOf([{ total: '55' }, { number: 'ZZ00000002', total: '' }])
    expect(wrapper.text()).toContain('沒有總計')
    expect(wrapper.text()).toContain('第 3 列')
  })

  it('可能重複預設兩筆都留', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    const wrapper = await previewOf([{ time: TODAY, total: '55' }])
    expect(radios(wrapper, 0)[0]!.element.checked).toBe(true)
    await confirm(wrapper)
    expect(await storage().count('records')).toBe(2)
  })

  it('可能重複選合併 → 只剩一筆，而且有發票號碼', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    const wrapper = await previewOf([{ time: TODAY, total: '55' }])
    await radios(wrapper, 0)[1]!.setValue(true)
    await confirm(wrapper)
    const all = await storage().getAll<SpendRecord>('records')
    expect(all).toHaveLength(1)
    expect(all[0]!.invoiceKey).not.toBeNull()
  })

  it('一個候選被選走後，另一張發票不能再選它', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    const wrapper = await previewOf([
      { time: TODAY, total: '55' },
      { time: TODAY, number: 'ZZ00000002', merchant: '另一家', total: '55' },
    ])
    expect(radios(wrapper, 1)).toHaveLength(2)
    await radios(wrapper, 0)[1]!.setValue(true)
    expect(radios(wrapper, 1)[1]!.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('已被')
    expect(wrapper.text()).toContain('測試商店股份有限公司 $55 的發票選走')
  })

  it('選合併後統計跟著變', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    const wrapper = await previewOf([{ time: TODAY, total: '55' }])
    expect(stat(wrapper, '合併')).toBe('0 張')
    await radios(wrapper, 0)[1]!.setValue(true)
    expect(stat(wrapper, '合併')).toBe('1 張')
  })

  it('預覽後資料被改 → 提示重新預覽，之前的選擇被清掉', async () => {
    await createFromText(storage(), '全家 咖啡 55')
    const wrapper = await previewOf([{ time: TODAY, total: '55' }])
    await radios(wrapper, 0)[1]!.setValue(true)
    await createFromText(storage(), '全聯 茶 55')

    await button(wrapper, '確認匯入').trigger('click')
    await waitForText(wrapper, '預覽之後資料有變動')
    await button(wrapper, '重新預覽').trigger('click')
    await waitForText(wrapper, '請重新選擇')
    expect(radios(wrapper, 0)[0]!.element.checked).toBe(true)
    expect(await storage().count('records')).toBe(2)
  })

  // jsdom 的 File 包 Node 的 Blob 只會得到 "[object Blob]"，讀不到內容。
  // 這裡只驗證匯入後有重組；內容是否是匯入後的資料由真機驗收確認。
  it('匯入後重組匯出檔', async () => {
    const wrapper = await previewOf([{ total: '55' }])
    await button(wrapper, '匯出 CSV').trigger('click')
    await waitForText(wrapper, 'CSV已下載')
    const before = vi.mocked(saveFile).mock.calls.at(-1)![0]

    await confirm(wrapper)
    await button(wrapper, '匯出 CSV').trigger('click')
    const after = vi.mocked(saveFile).mock.calls.at(-1)![0]
    expect(after).not.toBe(before)
  })

  it('匯入後待確認清單立刻更新', async () => {
    await refreshRecords()
    expect(pendingRecords.value).toHaveLength(0)
    const wrapper = await previewOf([{ item: '神秘', subtotal: '55', total: '55' }])
    await confirm(wrapper)
    expect(pendingRecords.value).toHaveLength(1)
  })

  it('同一份再匯入 → 沒有要寫入的資料', async () => {
    const wrapper = await previewOf([{ total: '55' }])
    await confirm(wrapper)
    await pickCsv(wrapper, carrierCsv([{ total: '55' }]))
    await waitForText(wrapper, '沒有要寫入的資料')
    expect(button(wrapper, '沒有要寫入的資料').element.disabled).toBe(true)
  })

  it('匯入預覽開著時選了還原檔 → 匯入預覽消失', async () => {
    const wrapper = await previewOf([{ total: '55' }])
    const zip = await backupZip()
    await pickFile(zipInput(wrapper), zip)
    await waitForText(wrapper, '② 確認覆寫並還原')
    expect(wrapper.text()).not.toContain('確認匯入')
  })

  it('還原預覽開著時選了 CSV → 還原預覽消失', async () => {
    const wrapper = await mountView(BackupView, '/backup')
    const zip = await backupZip()
    await pickFile(zipInput(wrapper), zip)
    await waitForText(wrapper, '② 確認覆寫並還原')
    await pickCsv(wrapper, carrierCsv([{ total: '55' }]))
    await waitForText(wrapper, '確認匯入')
    expect(wrapper.text()).not.toContain('② 確認覆寫並還原')
  })

  it('儲存層初始化中 → 匯入輸入框停用', async () => {
    const wrapper = await mountView(BackupView, '/backup')
    expect(csvInput(wrapper).element.disabled).toBe(false)
    const running = initStorage()
    await nextTick()
    expect(csvInput(wrapper).element.disabled).toBe(true)
    await running
    await nextTick()
    expect(csvInput(wrapper).element.disabled).toBe(false)
  })

  // 要讓 commit 之後的 refreshRecords 失敗只能 spy 自己的 adapter，違反「自己寫的程式真實執行」。
  it.todo('commit 成功但重新整理失敗 → 不說「資料未變更」')
  // prepare 在 iPhone 上要好幾秒，但測試裡抓不穩它執行中的時間點。
  it.todo('匯入預覽計算中 → 還原選檔停用')
})
