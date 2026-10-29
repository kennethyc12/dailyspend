<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { getStorage } from '@/storage'
import { saveFile, type SaveOutcome } from '@/backup/share'
import { handleError } from '@/errors/handleError'
import {
  buildBackupFile,
  buildCsvFile,
  commitRestore,
  markBackedUp,
  prepareRestore,
  type RestorePreview,
} from '@/services/backupService'
import { useStorageStatus, initStorage } from '@/composables/useStorageStatus'
import { refreshRecords } from '@/composables/useRecords'
import {
  CarrierImportStaleError,
  commitCarrierImport,
  planWrites,
  prepareCarrierImport,
  type CandidateChoices,
  type CarrierImportPreview,
  type WritePlan,
} from '@/services/carrierImportService'
import {
  parseCarrierCsv,
  type CarrierInvoice,
  type CarrierRejectReason,
  type RejectedInvoice,
} from '@/parsing/carrierCsv'
import type { SpendRecord } from '@/models/types'
import { NO_MERCHANT } from '@/models/labels'

const { settings, state: storageState } = useStorageStatus()
const storage = getStorage()

// iOS 要求 navigator.share 在使用者手勢的同步呼叫鏈內，所以檔案必須先備好，
// 按鈕只負責呼叫 share。若等按下去才 await 組檔，iOS 會擋掉分享。
const csvFile = shallowRef<File | null>(null)
const backupFile = shallowRef<File | null>(null)
const preparing = ref(true)

const message = ref<string | null>(null)
const errorMsg = ref<string | null>(null)

// 必須是 shallowRef：ref() 會深層代理，裡面每個 record 都變成 Proxy，
// 而 IndexedDB 走 structured clone，複製 Proxy 會丟 DataCloneError。
// 任何「之後要寫回資料庫」的資料都不能放進深層響應式的 ref。
const restorePreview = shallowRef<RestorePreview | null>(null)
const safetyDelivered = ref(false)
const restoring = ref(false)

type ParsedCsv = { invoices: CarrierInvoice[]; rejected: RejectedInvoice[] }

// 與 restorePreview 同理必須是 shallowRef：preview 裡的紀錄之後會原封不動寫進 IndexedDB。
const importParsed = shallowRef<ParsedCsv | null>(null)
const importPreview = shallowRef<CarrierImportPreview | null>(null)
const importChoices = shallowRef<CandidateChoices>(new Map())
const importing = ref(false)
const importStale = ref(false)

// 非預期錯誤（UI 一對一限制失效）交給全域 handler，不在這裡吞掉。
const importPlan = computed(() =>
  importPreview.value ? planWrites(importPreview.value, importChoices.value) : null,
)

const importLocked = computed(
  () => storageState.value !== 'ready' || importing.value || restoring.value,
)

const REJECT_TEXT: Record<CarrierRejectReason, string> = {
  number_missing: '缺少發票號碼',
  date_invalid: '消費時間格式不對，或日期不存在',
  rows_inconsistent: '同一張發票的時間、店家或統編不一致',
  total_missing: '沒有總計',
  total_zero: '總計是 0',
  total_invalid: '總計不是正整數',
  total_ambiguous: '總計出現不只一次',
  subtotal_invalid: '小計不是整數',
  qty_invalid: '個數格式不對（要是 0 或正數）',
  item_name_missing: '品名空白',
}

const CONFLICT_TEXT: Record<string, string> = {
  amount: '金額不同',
  date: '日期不同',
  invoiceNumber: '號碼不同',
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function invoiceLabel(inv: CarrierInvoice): string {
  return `${shortDate(inv.date)} ${inv.merchant || NO_MERCHANT} $${inv.total}`
}

function recordLabel(r: SpendRecord): string {
  const items = r.items.map((i) => i.name).join('、')
  return `${shortDate(r.date)} ${r.merchant || NO_MERCHANT} $${r.amount}${items ? `（${items}）` : ''}`
}

function clearImport() {
  importParsed.value = null
  importPreview.value = null
  importChoices.value = new Map()
  importStale.value = false
}

const lastBackupText = computed(() => {
  const at = settings.value?.backup.lastBackupAt
  return at ? new Date(at).toLocaleString('zh-TW') : '從未備份'
})

async function prepareFiles() {
  preparing.value = true
  // 舊檔是重組前的資料：失敗時若還能匯出，使用者會拿到舊備份，還被記成已備份。
  // 不在 catch 才清，zip 失敗時已組好的新 CSV 仍可匯出。
  csvFile.value = null
  backupFile.value = null
  try {
    csvFile.value = await buildCsvFile(storage)
    backupFile.value = await buildBackupFile(storage)
  } catch (err) {
    errorMsg.value = handleError(err, {
      where: 'BackupView.prepareFiles',
      failed: '準備匯出檔失敗，請離開本頁再進來重試',
    })
  } finally {
    preparing.value = false
  }
}

onMounted(prepareFiles)

function describe(outcome: SaveOutcome, what: string) {
  if (outcome === 'cancelled') return `已取消${what}`
  return outcome === 'shared' ? `${what}已送出，請選擇儲存位置` : `${what}已下載`
}

async function exportCsv() {
  if (!csvFile.value) return
  errorMsg.value = null
  try {
    message.value = describe(await saveFile(csvFile.value), 'CSV')
  } catch (err) {
    errorMsg.value = handleError(err, { where: 'BackupView.exportCsv', failed: '匯出失敗' })
  }
}

async function exportBackup() {
  if (!backupFile.value) return
  errorMsg.value = null
  try {
    const outcome = await saveFile(backupFile.value)
    message.value = describe(outcome, '備份')
    if (outcome !== 'cancelled') {
      await markBackedUp(storage)
      await initStorage()
    }
  } catch (err) {
    errorMsg.value = handleError(err, { where: 'BackupView.exportBackup', failed: '備份失敗' })
  }
}

async function preparePreview(parsed: ParsedCsv) {
  importPreview.value = await prepareCarrierImport(storage, parsed)
  // 選擇以 entry index 為 key，新的 preview 一律從頭選。
  importChoices.value = new Map()
  importStale.value = false
}

async function onPickImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMsg.value = null
  message.value = null
  restorePreview.value = null
  safetyDelivered.value = false
  clearImport()
  importing.value = true
  try {
    const parsed = parseCarrierCsv(await file.text())
    if (!parsed.ok) {
      errorMsg.value =
        parsed.reason === 'header_mismatch'
          ? '這不是發票存摺匯出的 CSV（表頭對不上）'
          : `檔案第 ${parsed.line} 列格式損壞（引號沒關或欄數不對）`
      return
    }
    importParsed.value = parsed
    await preparePreview(parsed)
  } catch (err) {
    errorMsg.value = handleError(err, { where: 'BackupView.onPickImportFile', failed: '讀取失敗' })
  } finally {
    input.value = ''
    importing.value = false
  }
}

function choose(index: number, recordId: string | null) {
  const next = new Map(importChoices.value)
  if (recordId === null) next.delete(index)
  else next.set(index, recordId)
  importChoices.value = next
}

/** 這個候選已被哪一張發票（自己以外）選走；畫面顯示那張發票，不顯示內部 index。 */
function takenBy(recordId: string, index: number): CarrierInvoice | null {
  for (const [i, id] of importChoices.value) {
    if (id === recordId && i !== index) return importPreview.value?.entries[i]?.invoice ?? null
  }
  return null
}

async function confirmImport() {
  const preview = importPreview.value
  if (!preview || importing.value) return
  errorMsg.value = null
  message.value = null
  importing.value = true
  try {
    let plan: WritePlan
    try {
      plan = await commitCarrierImport(storage, preview, importChoices.value)
    } catch (err) {
      // 讓「重新預覽」出現；文案的分類只在 handleError
      if (err instanceof CarrierImportStaleError) importStale.value = true
      // 單一 transaction：只有 commit 本身失敗時「資料未變更」才成立。
      errorMsg.value = handleError(err, {
        where: 'BackupView.confirmImport.commit',
        failed: '匯入失敗，資料未變更',
      })
      return
    }
    clearImport()
    const summary = `匯入完成：新增 ${plan.inserted}、合併 ${plan.merged}、已存在 ${plan.unchanged}、無法匯入 ${plan.rejected}；其中 ${plan.newlyPending} 筆進待確認`
    // initStorage 會自己 catch 錯誤，不會往外拋，只能看狀態
    await initStorage()
    if (storageState.value === 'failed') {
      errorMsg.value = `匯入已完成（${plan.inserted + plan.merged} 筆），但重新載入失敗，請重新開啟 App`
      return
    }
    await prepareFiles()
    await refreshRecords()
    message.value = summary
  } catch (err) {
    errorMsg.value = handleError(err, {
      where: 'BackupView.confirmImport.refresh',
      failed: '匯入已完成，但更新畫面失敗',
    })
  } finally {
    importing.value = false
  }
}

async function repreview() {
  if (!importParsed.value || importing.value) return
  errorMsg.value = null
  importing.value = true
  try {
    await preparePreview(importParsed.value)
    message.value = '資料有變動，已重新預覽，請重新選擇'
  } catch (err) {
    errorMsg.value = handleError(err, { where: 'BackupView.repreview', failed: '重新預覽失敗' })
  } finally {
    importing.value = false
  }
}

async function onPickRestoreFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  clearImport()

  errorMsg.value = null
  message.value = null
  safetyDelivered.value = false
  try {
    restorePreview.value = await prepareRestore(storage, file)
  } catch (err) {
    restorePreview.value = null
    errorMsg.value = handleError(err, { where: 'BackupView.onPickRestoreFile', failed: '讀取失敗' })
  } finally {
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function downloadSafety() {
  if (!restorePreview.value) return
  errorMsg.value = null
  try {
    const outcome = await saveFile(restorePreview.value.safetyBackup)
    if (outcome !== 'cancelled') safetyDelivered.value = true
  } catch (err) {
    errorMsg.value = handleError(err, {
      where: 'BackupView.downloadSafety',
      failed: '保險備份匯出失敗',
    })
  }
}

async function confirmRestore() {
  if (!restorePreview.value || restoring.value) return
  errorMsg.value = null
  message.value = null
  restoring.value = true
  try {
    const preview = restorePreview.value
    const count = preview.parsed.data.records.length
    try {
      await commitRestore(storage, preview)
    } catch (err) {
      // 還原是整個 App 最危險的操作，絕不能無聲失敗。transaction 失敗會整批回滾，所以這句話才成立。
      errorMsg.value = handleError(err, {
        where: 'BackupView.confirmRestore.commit',
        failed: '還原失敗，資料未變更',
        conflict: '備份檔裡有兩筆紀錄是同一張發票',
      })
      return
    }
    restorePreview.value = null
    safetyDelivered.value = false
    // initStorage 會自己 catch 錯誤，不會往外拋，只能看狀態
    await initStorage()
    if (storageState.value === 'failed') {
      errorMsg.value = `還原已完成（${count} 筆），但重新載入失敗，請重新開啟 App`
      return
    }
    await prepareFiles()
    await refreshRecords()
    message.value = `還原完成，共 ${count} 筆紀錄`
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <main class="page">
    <RouterLink to="/settings" class="back">← 設定</RouterLink>
    <h1>備份與匯出</h1>
    <p class="hint">上次備份：{{ lastBackupText }}</p>

    <section class="panel">
      <h2>匯出</h2>
      <p class="hint">
        CSV 給 Excel 看；完整備份包含照片與規則，是唯一能還原的格式。
      </p>
      <button class="btn-primary" :disabled="preparing || !csvFile" @click="exportCsv">
        {{ preparing ? '準備中…' : '匯出 CSV' }}
      </button>
      <button class="btn-primary mt" :disabled="preparing || !backupFile" @click="exportBackup">
        {{ preparing ? '準備中…' : '完整備份（zip）' }}
      </button>
    </section>

    <section class="panel">
      <h2>匯入載具 CSV</h2>
      <p class="hint">支援「發票存摺」App 匯出的 CSV。匯入會合併既有紀錄，建議先完整備份。</p>

      <label class="file-label">
        選擇 CSV
        <input
          type="file"
          accept=".csv,text/csv,text/comma-separated-values"
          :disabled="importLocked"
          @change="onPickImportFile"
        />
      </label>

      <div v-if="importPreview && importPlan" class="confirm import-preview">
        <dl>
          <dt>新增</dt>
          <dd>{{ importPlan.inserted }} 張</dd>
          <dt>合併</dt>
          <dd>{{ importPlan.merged }} 張</dd>
          <dt>已存在</dt>
          <dd>{{ importPlan.unchanged }} 張</dd>
          <dt>無法匯入</dt>
          <dd>{{ importPlan.rejected }} 張</dd>
          <dt>會進待確認</dt>
          <dd>{{ importPlan.newlyPending }} 筆</dd>
        </dl>

        <template v-for="(e, i) in importPreview.entries" :key="e.invoice.invoiceNumber">
          <fieldset v-if="e.kind === 'candidate'" class="entry">
            <legend>可能重複：{{ invoiceLabel(e.invoice) }}</legend>
            <p class="hint">
              只比對同日同額。選「兩筆都留」之後再匯入同一份不會再問；要合併只能手動刪掉其中一筆。
            </p>
            <label class="choice">
              <input
                type="radio"
                :name="`candidate-${i}`"
                :checked="!importChoices.has(i)"
                :disabled="importing"
                @change="choose(i, null)"
              />
              兩筆都留
            </label>
            <label v-for="m in e.merges" :key="m.existing.id" class="choice">
              <input
                type="radio"
                :name="`candidate-${i}`"
                :checked="importChoices.get(i) === m.existing.id"
                :disabled="importing || takenBy(m.existing.id, i) !== null"
                @change="choose(i, m.existing.id)"
              />
              合併到：{{ recordLabel(m.existing) }}
              <span v-if="takenBy(m.existing.id, i)" class="note">
                已被 {{ invoiceLabel(takenBy(m.existing.id, i)!) }} 的發票選走
              </span>
              <span v-else class="note">合併後店名保留，品項換成發票明細</span>
            </label>
          </fieldset>

          <div v-else-if="e.kind === 'merge'" class="entry">
            <p>合併：{{ invoiceLabel(e.invoice) }}</p>
            <p v-if="e.write.itemsReplaced" class="note">品項會換成發票明細</p>
            <p v-for="c in e.write.conflicts" :key="c" class="note warn">
              {{ CONFLICT_TEXT[c] ?? c }}，會標記待確認
            </p>
          </div>
        </template>

        <div v-for="r in importPreview.rejected" :key="r.lines.join(',')" class="entry">
          <p>無法匯入：{{ r.invoiceNumber ?? '（無號碼）' }}（第 {{ r.lines.join('、') }} 列）</p>
          <p class="note warn">{{ REJECT_TEXT[r.reason] }}</p>
        </div>

        <button v-if="importStale" class="btn-primary" :disabled="importing" @click="repreview">
          重新預覽
        </button>
        <button
          v-else
          class="btn-primary"
          :disabled="importing || importPlan.writes.length === 0"
          @click="confirmImport"
        >
          {{
            importing
              ? '匯入中…'
              : importPlan.writes.length === 0
                ? '沒有要寫入的資料'
                : '確認匯入'
          }}
        </button>
        <button class="btn-text mt" :disabled="importing" @click="clearImport">取消</button>
      </div>
    </section>

    <section class="panel danger">
      <h2>還原</h2>
      <p class="hint">
        還原會<strong>覆寫目前所有資料</strong>。選擇備份檔後，請先存下系統自動產生的
        保險備份，才能繼續。
      </p>

      <label class="file-label">
        選擇備份檔
        <input
          type="file"
          accept=".zip,application/zip"
          :disabled="importing"
          @change="onPickRestoreFile"
        />
      </label>

      <div v-if="restorePreview" class="confirm">
        <dl>
          <dt>備份檔建立於</dt>
          <dd>{{ new Date(restorePreview.parsed.manifest.createdAt).toLocaleString('zh-TW') }}</dd>
          <dt>將寫入</dt>
          <dd>
            {{ restorePreview.parsed.manifest.counts.records }} 筆紀錄 ·
            {{ restorePreview.parsed.photos.length }} 張照片
          </dd>
          <dt>將覆蓋</dt>
          <dd class="warn">
            目前的 {{ restorePreview.current.records }} 筆紀錄 ·
            {{ restorePreview.current.photos }} 張照片
          </dd>
        </dl>

        <button class="btn-primary" @click="downloadSafety">
          {{ safetyDelivered ? '✓ 已存下保險備份（可重複存）' : '① 先存下目前資料的保險備份' }}
        </button>
        <button
          class="btn-danger mt"
          :disabled="!safetyDelivered || restoring"
          @click="confirmRestore"
        >
          {{ restoring ? '還原中…' : '② 確認覆寫並還原' }}
        </button>
        <button class="btn-text mt" @click="restorePreview = null">取消</button>
      </div>
    </section>

    <p v-if="message" class="result ok">{{ message }}</p>
    <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>
  </main>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: var(--space-4);
  color: var(--c-text-dim);
  font-size: 14px;
  text-decoration: none;
}

h1 {
  font-size: 22px;
}

.panel {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: var(--space-4);
  margin-top: var(--space-4);
}

.panel.danger {
  border-color: color-mix(in srgb, var(--c-warn) 40%, var(--c-border));
}

h2 {
  font-size: 15px;
  margin-bottom: var(--space-2);
}

.hint {
  font-size: 13px;
  color: var(--c-text-dim);
  margin-bottom: var(--space-3);
}

.hint strong {
  color: var(--c-warn);
}

.mt {
  margin-top: var(--space-3);
}

.file-label {
  display: block;
  padding: var(--space-3);
  border: 1px dashed var(--c-border);
  border-radius: var(--radius);
  text-align: center;
  font-size: 14px;
}

.file-label input {
  display: block;
  width: 100%;
  margin-top: var(--space-2);
  font-size: 13px;
}

.confirm {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--c-border);
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-3);
  font-size: 13px;
  margin-bottom: var(--space-4);
}

dt {
  color: var(--c-text-dim);
  white-space: nowrap;
}

.btn-danger {
  display: block;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--c-warn);
  color: #fff;
  font-weight: 600;
  text-align: center;
}

button:disabled {
  opacity: 0.45;
}

.result {
  margin-top: var(--space-4);
  font-size: 14px;
}

.ok {
  color: var(--c-accent);
}

.warn {
  color: var(--c-warn);
}

.entry {
  border: 0;
  border-top: 1px solid var(--c-border);
  padding: var(--space-3) 0;
  margin: 0;
  font-size: 13px;
}

.entry legend {
  font-weight: 600;
  padding: 0;
}

.choice {
  display: block;
  margin-top: var(--space-2);
}

.note {
  display: block;
  color: var(--c-text-dim);
  font-size: 12px;
}

.note.warn {
  color: var(--c-warn);
}
</style>
