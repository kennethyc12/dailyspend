<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { getStorage } from '@/storage'
import { createFromText } from '@/services/entryService'
import { categoryName, refreshRecords, useRecords } from '@/composables/useRecords'
import { initStorage, useStorageStatus } from '@/composables/useStorageStatus'
import { usePhotoPicker } from '@/composables/usePhotoPicker'
import { saveSample } from '@/services/sampleService'
import { todayIso } from '@/parsing/quickInput'
import type { SpendRecord } from '@/models/types'

const storage = getStorage()
const { records } = useRecords()
const { state } = useStorageStatus()
const picker = usePhotoPicker()

const text = ref('')
const saving = ref(false)
const errorMsg = ref<string | null>(null)
const lastSaved = shallowRef<SpendRecord | null>(null)
const lastWasPending = ref(false)
const lastWasMerged = ref(false)
const sampleMsg = ref<string | null>(null)

const today = todayIso()
const todayRecords = computed(() => records.value.filter((r) => r.date === today))
const todayTotal = computed(() => todayRecords.value.reduce((sum, r) => sum + r.amount, 0))

// seed 沒跑完就送出會拿到空的規則集，每一筆都變成待確認。
onMounted(async () => {
  await initStorage()
  await refreshRecords()
})

const BLOCKED_MESSAGE = {
  empty_input: '請輸入內容，例如「全家 咖啡 55」',
  amount_missing: '找不到金額。格式是「店家 品項 金額」，例如「全家 咖啡 55」',
} as const

async function submit() {
  if (saving.value) return
  saving.value = true
  errorMsg.value = null
  sampleMsg.value = null

  try {
    const result = await createFromText(storage, text.value, Date.now(), picker.photo.value ?? undefined)
    if (!result.ok) {
      errorMsg.value = BLOCKED_MESSAGE[result.blocked]
      return
    }

    lastSaved.value = result.save.record
    lastWasPending.value = result.save.record.status === 'pending'
    lastWasMerged.value = result.save.action === 'merge'
    text.value = ''
    picker.clear()
    await refreshRecords()
  } catch (err) {
    // 吞掉錯誤會讓使用者看到「按鈕沒反應」，這是 Phase 6 踩過的坑。
    errorMsg.value = `存檔失敗：${(err as Error).message}`
  } finally {
    saving.value = false
  }
}

// 只存照片、不建紀錄：為了蒐集 Phase 9 的 QR 樣本，這條路徑不需要金額。
async function submitSample() {
  const photo = picker.photo.value
  if (!photo || saving.value) return
  saving.value = true
  errorMsg.value = null
  sampleMsg.value = null

  try {
    await saveSample(storage, photo)
    lastSaved.value = null
    picker.clear()
    sampleMsg.value = '已存成發票樣本，可在設定頁查看或刪除。'
  } catch (err) {
    errorMsg.value = `樣本存檔失敗：${(err as Error).message}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>記一筆</h1>

    <form @submit.prevent="submit">
      <input
        v-model="text"
        class="entry"
        type="text"
        inputmode="text"
        enterkeyhint="done"
        placeholder="全家 咖啡 55"
        autocomplete="off"
        autocapitalize="off"
        :disabled="saving || state !== 'ready'"
      />
      <p class="hint">格式：店家 品項 金額。日期預設今天，可用「昨天」或「10/3」開頭。</p>

      <div class="photo-pick">
        <p class="pick-state">
          <span v-if="picker.working.value">照片處理中…</span>
          <span v-else-if="picker.photo.value">已附照片，可重新選擇</span>
          <span v-else>附上發票照片（選填）</span>
        </p>
        <div class="pick-actions" :class="{ off: saving || picker.working.value }">
          <label class="btn-text">
            📷 拍照
            <input
              type="file"
              accept="image/*"
              capture="environment"
              :disabled="saving || picker.working.value"
              @change="picker.pick"
            />
          </label>
          <label class="btn-text">
            🖼 從相簿選
            <input
              type="file"
              accept="image/*"
              :disabled="saving || picker.working.value"
              @change="picker.pick"
            />
          </label>
        </div>
      </div>

      <div v-if="picker.previewUrl.value" class="preview">
        <img :src="picker.previewUrl.value" alt="發票照片預覽" />
        <div class="preview-actions">
          <button type="button" class="btn-text" @click="picker.clear()">移除照片</button>
          <button type="button" class="btn-text" :disabled="saving" @click="submitSample">
            只存成樣本（不記帳）
          </button>
        </div>
      </div>

      <p v-if="picker.error.value" class="result warn">{{ picker.error.value }}</p>
      <button class="btn-primary" type="submit" :disabled="saving || state !== 'ready' || !text.trim()">
        {{ saving ? '存檔中…' : state !== 'ready' ? '準備中…' : '存檔' }}
      </button>
    </form>

    <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>

    <p v-else-if="sampleMsg" class="result ok">{{ sampleMsg }}</p>

    <RouterLink v-else-if="lastSaved" to="/pending" class="result" :class="lastWasPending ? 'warn' : 'ok'">
      <template v-if="lastWasMerged">已合併到同一張發票 ·</template>
      已存：{{ lastSaved.merchant || '（無店家）' }} ·
      {{ lastSaved.items.map((i) => i.name).join('、') || '無品項' }} ·
      ${{ lastSaved.amount }} · {{ categoryName(lastSaved.categoryId) }}
      <template v-if="lastWasPending"><br />需要確認，點這裡處理</template>
    </RouterLink>

    <section class="panel">
      <h2>今天 · {{ todayRecords.length }} 筆 · 共 ${{ todayTotal }}</h2>
      <p v-if="todayRecords.length === 0" class="hint">還沒有紀錄。</p>
      <ul v-else class="list">
        <li v-for="r in todayRecords" :key="r.id">
          <div class="row">
            <span class="merchant">{{ r.merchant || '（無店家）' }}</span>
            <span class="amount">${{ r.amount }}</span>
          </div>
          <div class="row sub">
            <span>{{ r.items.map((i) => i.name).join('、') || '—' }}</span>
            <span :class="{ warn: r.categoryId === null }">{{ categoryName(r.categoryId) }}</span>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.entry {
  width: 100%;
  padding: var(--space-4);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  color: var(--c-text);
  /* iOS 在 font-size < 16px 的輸入框會自動放大畫面。 */
  font-size: 18px;
}

.entry:focus {
  outline: 2px solid var(--c-accent);
  outline-offset: -1px;
}

form button {
  margin-top: var(--space-3);
}

.photo-pick {
  margin-bottom: var(--space-3);
  padding: var(--space-3);
  border: 1px dashed var(--c-border);
  border-radius: var(--radius);
  text-align: center;
  font-size: 14px;
  color: var(--c-text-dim);
}

.photo-pick input {
  display: none;
}

.pick-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

.pick-actions label {
  cursor: pointer;
}

/* 點擊目標是 label，input 的 :disabled 不會讓它變灰，所以另外標。 */
.pick-actions.off {
  opacity: 0.45;
  pointer-events: none;
}

.preview {
  margin-bottom: var(--space-3);
  text-align: center;
}

.preview-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-3);
}

.preview img {
  max-width: 100%;
  max-height: 220px;
  border-radius: var(--radius);
  border: 1px solid var(--c-border);
}

.list {
  list-style: none;
}

.list li {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--c-border);
}

.list li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.merchant {
  font-weight: 600;
}

.amount {
  font-variant-numeric: tabular-nums;
}

.sub {
  margin-top: 2px;
  font-size: 13px;
  color: var(--c-text-dim);
}

.result {
  display: block;
  text-decoration: none;
}
</style>
