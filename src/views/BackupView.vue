<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { getStorage } from '@/storage'
import { saveFile, type SaveOutcome } from '@/backup/share'
import { BackupFormatError } from '@/backup/backup'
import {
  buildBackupFile,
  buildCsvFile,
  commitRestore,
  markBackedUp,
  prepareRestore,
  type RestorePreview,
} from '@/services/backupService'
import { useStorageStatus, initStorage } from '@/composables/useStorageStatus'

const { settings } = useStorageStatus()
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

const lastBackupText = computed(() => {
  const at = settings.value?.backup.lastBackupAt
  return at ? new Date(at).toLocaleString('zh-TW') : '從未備份'
})

function fail(prefix: string, err: unknown) {
  errorMsg.value =
    err instanceof BackupFormatError ? err.message : `${prefix}：${(err as Error).message}`
}

async function prepareFiles() {
  preparing.value = true
  try {
    csvFile.value = await buildCsvFile(storage)
    backupFile.value = await buildBackupFile(storage)
  } catch (err) {
    fail('準備檔案失敗', err)
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
    fail('匯出失敗', err)
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
    fail('備份失敗', err)
  }
}

async function onPickRestoreFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  errorMsg.value = null
  message.value = null
  safetyDelivered.value = false
  try {
    restorePreview.value = await prepareRestore(storage, file)
  } catch (err) {
    restorePreview.value = null
    errorMsg.value =
      err instanceof BackupFormatError ? err.message : `讀取失敗：${(err as Error).message}`
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
    fail('保險備份匯出失敗', err)
  }
}

async function confirmRestore() {
  if (!restorePreview.value || restoring.value) return
  errorMsg.value = null
  message.value = null
  restoring.value = true
  try {
    const preview = restorePreview.value
    await commitRestore(storage, preview)
    restorePreview.value = null
    safetyDelivered.value = false
    await initStorage()
    await prepareFiles()
    message.value = `還原完成，共 ${preview.parsed.data.records.length} 筆紀錄`
  } catch (err) {
    // 還原是整個 App 最危險的操作，絕不能無聲失敗。
    fail('還原失敗，資料未變更', err)
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

    <section class="panel danger">
      <h2>還原</h2>
      <p class="hint">
        還原會<strong>覆寫目前所有資料</strong>。選擇備份檔後，請先存下系統自動產生的
        保險備份，才能繼續。
      </p>

      <label class="file-label">
        選擇備份檔
        <input type="file" accept=".zip,application/zip" @change="onPickRestoreFile" />
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
</style>
