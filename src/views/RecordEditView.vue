<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getStorage } from '@/storage'
import type { SpendRecord } from '@/models/types'
import {
  correctCategory,
  deleteRecord,
  getRecord,
  updateRecordFields,
} from '@/services/entryService'
import { activeCategories, categoryName, refreshRecords } from '@/composables/useRecords'
import { initStorage } from '@/composables/useStorageStatus'

const route = useRoute()
const router = useRouter()
const storage = getStorage()

const record = shallowRef<SpendRecord | null>(null)
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref<string | null>(null)
const message = ref<string | null>(null)
const confirmingDelete = ref(false)
const perItemNeeded = ref(false)

const date = ref('')
const merchant = ref('')
const amount = ref('')
const itemsText = ref('')
const note = ref('')

const dirty = computed(() => {
  const r = record.value
  if (!r) return false
  return (
    date.value !== r.date ||
    merchant.value !== r.merchant ||
    amount.value !== String(r.amount) ||
    itemsText.value !== r.items.map((i) => i.name).join(' ') ||
    note.value !== r.note
  )
})

function fill(r: SpendRecord) {
  record.value = r
  date.value = r.date
  merchant.value = r.merchant
  amount.value = String(r.amount)
  itemsText.value = r.items.map((i) => i.name).join(' ')
  note.value = r.note
}

onMounted(async () => {
  await initStorage()
  try {
    const r = await getRecord(storage, String(route.params.id))
    if (r) fill(r)
    else errorMsg.value = '找不到這筆紀錄'
  } catch (err) {
    errorMsg.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

async function act(fn: () => Promise<void>) {
  if (saving.value) return
  saving.value = true
  errorMsg.value = null
  try {
    await fn()
    await refreshRecords()
  } catch (err) {
    errorMsg.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

function save() {
  const r = record.value
  if (!r) return
  return act(async () => {
    const next = await updateRecordFields(storage, r, {
      date: date.value,
      merchant: merchant.value,
      amount: Number(amount.value),
      itemNames: itemsText.value.split(/\s+/),
      note: note.value,
    })
    fill(next)
    message.value = '已儲存'
  })
}

function setCategory(categoryId: string) {
  const r = record.value
  if (!r || !categoryId) return
  return act(async () => {
    const { record: next, plan } = await correctCategory(storage, r, categoryId)
    fill(next)
    perItemNeeded.value = plan.kind === 'needs_per_item'
    message.value = plan.kind === 'create' || plan.kind === 'update' ? '已記住這條規則' : '已更新分類'
  })
}

function setItemCategory(index: number, categoryId: string) {
  const r = record.value
  if (!r || !categoryId) return
  return act(async () => {
    const { record: next } = await correctCategory(storage, r, categoryId, { kind: 'item', index })
    fill(next)
    message.value = '已記住這條規則'
  })
}

function skipPerItem() {
  const r = record.value
  if (!r) return
  return act(async () => {
    const { record: next } = await correctCategory(
      storage,
      r,
      r.categoryId ?? '',
      { kind: 'record' },
      { skipPerItem: true },
    )
    fill(next)
    perItemNeeded.value = false
  })
}

function remove() {
  const r = record.value
  if (!r) return
  return act(async () => {
    await deleteRecord(storage, r)
    await router.replace('/records')
  })
}
</script>

<template>
  <main class="page">
    <RouterLink to="/records" class="back">← 紀錄</RouterLink>
    <h1>編輯紀錄</h1>

    <p v-if="loading" class="hint">載入中…</p>
    <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>

    <template v-if="record">
      <section class="panel">
        <label class="field">
          <span>日期</span>
          <input v-model="date" type="date" :disabled="saving" />
        </label>
        <label class="field">
          <span>店家</span>
          <input v-model="merchant" type="text" :disabled="saving" />
        </label>
        <label class="field">
          <span>金額</span>
          <input v-model="amount" type="number" inputmode="numeric" step="1" :disabled="saving" />
        </label>
        <label class="field">
          <span>品項</span>
          <input v-model="itemsText" type="text" placeholder="用空白分隔" :disabled="saving" />
        </label>
        <label class="field">
          <span>備註</span>
          <input v-model="note" type="text" :disabled="saving" />
        </label>

        <button class="btn-primary mt" :disabled="saving || !dirty" @click="save">
          {{ saving ? '儲存中…' : dirty ? '儲存' : '沒有變更' }}
        </button>
      </section>

      <section class="panel">
        <h2>分類</h2>
        <p class="hint">
          目前：{{ categoryName(record.categoryId) }}（{{
            record.categorySource === 'user' ? '你指定的' : '規則判斷'
          }}）。改成別的類別時，系統會把它記成規則。
        </p>
        <label class="field">
          <span>類別</span>
          <select
            :value="record.categoryId ?? ''"
            :disabled="saving"
            @change="setCategory(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>請選擇</option>
            <option v-for="c in activeCategories" :key="c.id" :value="c.id">
              {{ c.icon }} {{ c.name }}
            </option>
          </select>
        </label>

        <div v-if="perItemNeeded" class="per-item">
          <p class="hint">
            這筆有多個品項。整筆改分類不會自動記成規則，否則系統會學到像
            「衛生紙 → 飲食」這種錯規則。要記住的話請逐項指定：
          </p>
          <label v-for="(item, i) in record.items" :key="i" class="field">
            <span>{{ item.name }}</span>
            <select
              :value="item.categoryId ?? ''"
              :disabled="saving"
              @change="setItemCategory(i, ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>請選擇</option>
              <option v-for="c in activeCategories" :key="c.id" :value="c.id">
                {{ c.icon }} {{ c.name }}
              </option>
            </select>
          </label>
          <button class="btn-text" :disabled="saving" @click="skipPerItem">
            略過，只記住店家
          </button>
        </div>
      </section>

      <p v-if="message" class="result ok">{{ message }}</p>

      <section class="panel danger">
        <button v-if="!confirmingDelete" class="btn-text danger" @click="confirmingDelete = true">
          刪除這筆紀錄
        </button>
        <div v-else class="delete-confirm">
          <span class="warn">確定刪除？無法復原。</span>
          <button class="btn-text" @click="confirmingDelete = false">取消</button>
          <button class="btn-text danger" :disabled="saving" @click="remove">確定刪除</button>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: var(--space-3);
  color: var(--c-text-dim);
  font-size: 14px;
  text-decoration: none;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  font-size: 14px;
}

.field input,
.field select {
  flex: 1;
  max-width: 62%;
  padding: var(--space-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-bg);
  color: var(--c-text);
  /* iOS 在 font-size < 16px 的輸入框會自動放大畫面。 */
  font-size: 16px;
}

.mt {
  margin-top: var(--space-2);
}

.per-item {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--c-border);
}

.panel.danger {
  border-color: color-mix(in srgb, var(--c-warn) 40%, var(--c-border));
  text-align: center;
}

.danger {
  color: var(--c-warn);
}

.delete-confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  font-size: 13px;
}
</style>
