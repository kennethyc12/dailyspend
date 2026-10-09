<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { getStorage } from '@/storage'
import type { PendingReason, SpendRecord } from '@/models/types'
import {
  activeCategories,
  categoryName,
  pendingRecords,
  refreshRecords,
} from '@/composables/useRecords'
import { confirmRecord, correctCategory, deleteRecord } from '@/services/entryService'

const storage = getStorage()
const errorMsg = ref<string | null>(null)
const busyId = ref<string | null>(null)
const confirmingDelete = ref<string | null>(null)
/** 哪幾筆正展開「逐項指定類別」面板（§6.2 多品項不自動學）。 */
const perItemFor = shallowRef<Set<string>>(new Set())

onMounted(refreshRecords)

const REASON_TEXT: Record<PendingReason, string> = {
  no_category_match: '沒有規則能判斷類別，請指定一個',
  ambiguous_merchant: '這家店橫跨多個類別，又沒有品項可以判斷',
  low_confidence: '規則有命中，但信心不足',
  recognition_failed: '發票 QR 辨識失敗',
  amount_mismatch: '手動輸入的金額和發票上的不一樣',
  duplicate_conflict: '和既有的同一張發票有欄位對不上',
  ambiguous_item_tokens: '輸入中間出現純數字，無法判斷是品項還是金額，已略過該字',
  multi_item_correction: '多品項曾整筆改過分類，品項分類可能不準',
  missing_merchant: '缺少店家',
  missing_invoice_date: '有發票號碼但日期不完整，無法去重',
}

function togglePerItem(id: string, on: boolean) {
  const next = new Set(perItemFor.value)
  if (on) next.add(id)
  else next.delete(id)
  perItemFor.value = next
}

async function run(id: string, fn: () => Promise<void>) {
  if (busyId.value) return
  busyId.value = id
  errorMsg.value = null
  try {
    await fn()
    await refreshRecords()
  } catch (err) {
    errorMsg.value = `操作失敗：${(err as Error).message}`
  } finally {
    busyId.value = null
  }
}

function setRecordCategory(record: SpendRecord, categoryId: string) {
  if (!categoryId) return
  return run(record.id, async () => {
    const { plan } = await correctCategory(storage, record, categoryId)
    // 多品項改整筆時不自動學品項規則，改請使用者逐項指定。
    togglePerItem(record.id, plan.kind === 'needs_per_item')
  })
}

function setItemCategory(record: SpendRecord, index: number, categoryId: string) {
  if (!categoryId) return
  return run(record.id, async () => {
    await correctCategory(storage, record, categoryId, { kind: 'item', index })
  })
}

function skipPerItem(record: SpendRecord) {
  return run(record.id, async () => {
    await correctCategory(
      storage,
      record,
      record.categoryId ?? '',
      { kind: 'record' },
      { skipPerItem: true },
    )
    togglePerItem(record.id, false)
  })
}

function confirm(record: SpendRecord) {
  return run(record.id, async () => {
    await confirmRecord(storage, record)
    togglePerItem(record.id, false)
  })
}

function remove(record: SpendRecord) {
  return run(record.id, async () => {
    await deleteRecord(storage, record)
    confirmingDelete.value = null
  })
}
</script>

<template>
  <main class="page">
    <h1>待確認</h1>

    <p v-if="pendingRecords.length === 0" class="hint">
      沒有待確認的紀錄。系統不會亂猜類別，判斷不出來的都會留在這裡。
    </p>

    <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>

    <section v-for="r in pendingRecords" :key="r.id" class="panel">
      <div class="row">
        <span class="merchant">{{ r.merchant || '（無店家）' }}</span>
        <span class="amount">${{ r.amount }}</span>
      </div>
      <p class="sub">{{ r.date }} · {{ r.items.map((i) => i.name).join('、') || '無品項' }}</p>

      <ul class="reasons">
        <li v-for="reason in r.pendingReasons" :key="reason">{{ REASON_TEXT[reason] }}</li>
      </ul>

      <label class="field">
        <span>類別</span>
        <select
          :value="r.categoryId ?? ''"
          :disabled="busyId === r.id"
          @change="setRecordCategory(r, ($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>請選擇</option>
          <option v-for="c in activeCategories" :key="c.id" :value="c.id">
            {{ c.icon }} {{ c.name }}
          </option>
        </select>
      </label>

      <div v-if="perItemFor.has(r.id)" class="per-item">
        <p class="hint">
          這筆有多個品項。整筆改分類不會自動記成規則，否則系統會學到像
          「衛生紙 → 飲食」這種錯規則。要記住的話請逐項指定：
        </p>
        <label v-for="(item, i) in r.items" :key="i" class="field">
          <span>{{ item.name }}</span>
          <select
            :value="item.categoryId ?? ''"
            :disabled="busyId === r.id"
            @change="setItemCategory(r, i, ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>請選擇</option>
            <option v-for="c in activeCategories" :key="c.id" :value="c.id">
              {{ c.icon }} {{ c.name }}
            </option>
          </select>
        </label>
        <button class="btn-text" :disabled="busyId === r.id" @click="skipPerItem(r)">
          略過，只記住店家
        </button>
      </div>

      <div class="actions">
        <button class="btn-primary" :disabled="busyId === r.id" @click="confirm(r)">
          確認（目前為 {{ categoryName(r.categoryId) }}）
        </button>
        <button
          v-if="confirmingDelete !== r.id"
          class="btn-text"
          :disabled="busyId === r.id"
          @click="confirmingDelete = r.id"
        >
          刪除這筆
        </button>
        <div v-else class="delete-confirm">
          <span class="warn">確定刪除？無法復原。</span>
          <button class="btn-text" @click="confirmingDelete = null">取消</button>
          <button class="btn-text danger" :disabled="busyId === r.id" @click="remove(r)">
            確定刪除
          </button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
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

.reasons {
  margin: var(--space-3) 0;
  padding-left: var(--space-5);
  font-size: 13px;
  color: var(--c-warn);
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-3);
  font-size: 14px;
}

.field select {
  flex: 1;
  max-width: 60%;
  padding: var(--space-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-bg);
  color: var(--c-text);
  font-size: 16px;
}

.per-item {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--c-border);
}

.actions {
  margin-top: var(--space-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.delete-confirm {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: 13px;
}

.danger {
  color: var(--c-warn);
}
</style>
