<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { getStorage } from '@/storage'
import { createFromText } from '@/services/entryService'
import { categoryName, refreshRecords, useRecords } from '@/composables/useRecords'
import { initStorage, useStorageStatus } from '@/composables/useStorageStatus'
import { usePhotoPicker } from '@/composables/usePhotoPicker'
import { saveSample } from '@/services/sampleService'
import { createFromInvoice } from '@/services/invoiceService'
import { detectQrCodes, warmUp } from '@/recognize/qrDetect'
import { parseEInvoicePayload, type RecognizedInvoice } from '@/recognize/einvoicePayload'
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

const invoice = shallowRef<RecognizedInvoice | null>(null)
const reading = ref(false)
const invoiceMerchant = ref('')
const invoiceAmount = ref('')

const invoiceTotal = computed(() => invoice.value?.totalAmount ?? null)
const invoiceItemCount = computed(() => invoice.value?.items.length ?? 0)
const canSaveInvoice = computed(() => {
  if (!invoice.value || saving.value) return false
  return invoiceTotal.value !== null || /^\d+$/.test(invoiceAmount.value.trim())
})

const today = todayIso()
const todayRecords = computed(() => records.value.filter((r) => r.date === today))
const todayTotal = computed(() => todayRecords.value.reduce((sum, r) => sum + r.amount, 0))

// seed 沒跑完就送出會拿到空的規則集，每一筆都變成待確認。
onMounted(async () => {
  await initStorage()
  await refreshRecords()
  // 冷啟動載 wasm 要約 1 秒。先在背景暖好，按下拍照時才不用等。
  void warmUp().catch(() => undefined)
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
    dropPhoto()
    await refreshRecords()
  } catch (err) {
    // 吞掉錯誤會讓使用者看到「按鈕沒反應」，這是 Phase 6 踩過的坑。
    errorMsg.value = `存檔失敗：${(err as Error).message}`
  } finally {
    saving.value = false
  }
}

function clearInvoice() {
  invoice.value = null
  invoiceMerchant.value = ''
  invoiceAmount.value = ''
}

function dropPhoto() {
  picker.clear()
  clearInvoice()
}

/** 選完照片就順手讀 QR。讀不到不是錯誤——手輸那條路照常可用。 */
async function onPickPhoto(event: Event) {
  clearInvoice()
  const photo = await picker.pick(event)
  if (!photo) return

  reading.value = true
  sampleMsg.value = null
  try {
    const detected = await detectQrCodes(photo.blob)
    if (detected.codes.length === 0) return
    invoice.value = parseEInvoicePayload(detected.codes.map((c) => c.text))
  } catch (err) {
    errorMsg.value = `讀取發票失敗：${(err as Error).message}`
  } finally {
    reading.value = false
  }
}

async function submitInvoice() {
  if (!invoice.value || !canSaveInvoice.value) return
  saving.value = true
  errorMsg.value = null
  sampleMsg.value = null

  try {
    const typed = invoiceAmount.value.trim()
    const result = await createFromInvoice(
      storage,
      {
        recognized: invoice.value,
        merchant: invoiceMerchant.value,
        amount: typed === '' ? null : Number(typed),
        photo: picker.photo.value ?? undefined,
      },
      Date.now(),
    )

    if (!result.ok) {
      errorMsg.value =
        result.blocked === 'amount_missing'
          ? '這張發票沒有總計額，請自己填金額'
          : '金額必須是非負整數'
      return
    }

    lastSaved.value = result.save.record
    lastWasPending.value = result.save.record.status === 'pending'
    lastWasMerged.value = result.save.action === 'merge'
    text.value = ''
    dropPhoto()
    await refreshRecords()
  } catch (err) {
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
    dropPhoto()
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
              @change="onPickPhoto"
            />
          </label>
          <label class="btn-text">
            🖼 從相簿選
            <input
              type="file"
              accept="image/*"
              :disabled="saving || picker.working.value"
              @change="onPickPhoto"
            />
          </label>
        </div>
      </div>

      <div v-if="picker.previewUrl.value" class="preview">
        <img :src="picker.previewUrl.value" alt="發票照片預覽" />
        <div class="preview-actions">
          <button type="button" class="btn-text" @click="dropPhoto">移除照片</button>
          <button type="button" class="btn-text" :disabled="saving" @click="submitSample">
            只存成樣本（不記帳）
          </button>
        </div>
      </div>

      <p v-if="picker.error.value" class="result warn">{{ picker.error.value }}</p>
      <p v-if="reading" class="hint">讀取發票 QR…</p>

      <section v-if="invoice" class="panel invoice">
        <h2>從發票讀到 {{ invoiceItemCount }} 個品項</h2>

        <ul v-if="invoiceItemCount" class="list">
          <li v-for="(item, i) in invoice.items" :key="`${item.name}-${i}`">
            <div class="row">
              <span>{{ item.name }}</span>
              <span class="amount">{{ item.qty }} × {{ item.value }}</span>
            </div>
          </li>
        </ul>
        <p v-else class="hint">這張發票的 QR 裡沒有品項。</p>

        <p v-if="invoice.invoiceNumber" class="sub">
          {{ invoice.invoiceNumber }} · {{ invoice.date }}
        </p>

        <label class="field">
          <span>店家</span>
          <input
            v-model="invoiceMerchant"
            type="text"
            placeholder="發票上沒有店家名稱，請自己填"
            autocomplete="off"
            :disabled="saving"
          />
        </label>

        <p v-if="invoiceTotal !== null" class="sub">
          發票總計額 <strong>${{ invoiceTotal }}</strong>，存檔時以它為準。
        </p>
        <label v-else class="field">
          <span>金額</span>
          <input
            v-model="invoiceAmount"
            type="text"
            inputmode="numeric"
            placeholder="發票沒有總計額，請自己填"
            :disabled="saving"
          />
        </label>

        <!-- 品項那欄的「單價」語意未定，所以不幫忙加總；寧可讓人自己看發票。 -->
        <p v-if="invoiceTotal === null && invoiceItemCount" class="hint">
          上面的「數量 × 數字」直接來自發票，但規格沒說清楚那是單價還是小計，
          所以不替你加總。
        </p>

        <ul v-if="invoice.notes.length" class="list notes">
          <li v-for="note in invoice.notes" :key="note" class="sub warn">{{ note }}</li>
        </ul>

        <button
          type="button"
          class="btn-primary"
          :disabled="!canSaveInvoice"
          @click="submitInvoice"
        >
          {{ saving ? '存檔中…' : '用發票資料存檔' }}
        </button>
      </section>

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

.invoice {
  text-align: left;
}

.invoice .list li {
  padding: var(--space-2) 0;
}

.invoice .notes li {
  border-bottom: none;
}

.field {
  display: block;
  margin-top: var(--space-3);
  font-size: 13px;
  color: var(--c-text-dim);
}

.field input {
  width: 100%;
  margin-top: 2px;
  padding: var(--space-3);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-bg);
  color: var(--c-text);
  /* iOS 在 font-size < 16px 的輸入框會自動放大畫面。 */
  font-size: 16px;
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
