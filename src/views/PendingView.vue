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
import { useThumbnails } from '@/composables/useThumbnails'
import {
  computeRecordUpdate,
  deleteRecord,
  learnItemRule,
  resolvePending,
} from '@/services/entryService'
import { userMessage } from '@/errors/userMessage'
import { formFrom, formToPatch, type RecordForm } from '@/views/recordForm'

interface Edit {
  record: SpendRecord
  matchedRuleIds: string[]
}

const storage = getStorage()
const errorMsg = ref<string | null>(null)
const notice = ref<string | null>(null)
const busyId = ref<string | null>(null)
const confirmingDelete = ref<string | null>(null)
/** 哪幾筆正展開「逐項指定類別」面板（§6.2 多品項不自動學）。 */
const perItemFor = shallowRef<Set<string>>(new Set())
/** 卡片上選的類別，按確認才寫入（B4.2a）。沒有草稿就用 working(r) 的類別。 */
const drafts = ref<Record<string, string>>({})
/** 展開中的表單（純字串，可以是深層 ref）。 */
const forms = ref<Record<string, RecordForm>>({})
// 預覽紀錄最後要寫進 IndexedDB，深層 ref 會變成 Proxy，structured clone 會拒絕
const edits = shallowRef<Record<string, Edit>>({})
/** 逐項面板的品項類別草稿，index 對應 working(r).items。 */
const itemDrafts = shallowRef<Record<string, (string | null)[]>>({})
const thumbs = useThumbnails(() => pendingRecords.value.map((r) => r.photoId))

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
  tokens_after_amount: '金額後面還有字，已當成品項，請確認',
}

function togglePerItem(id: string, on: boolean) {
  const next = new Set(perItemFor.value)
  if (on) next.add(id)
  else next.delete(id)
  perItemFor.value = next
}

/** 卡片上看到的紀錄：有編輯草稿就是改後的預覽，否則是 DB 的值。 */
function working(r: SpendRecord): SpendRecord {
  return edits.value[r.id]?.record ?? r
}

function draftOf(r: SpendRecord): string {
  return drafts.value[r.id] ?? working(r).categoryId ?? ''
}

function setDraft(id: string, categoryId: string) {
  drafts.value = { ...drafts.value, [id]: categoryId }
}

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  const next = { ...map }
  delete next[id]
  return next
}

function forget(id: string) {
  drafts.value = without(drafts.value, id)
  forms.value = without(forms.value, id)
  edits.value = without(edits.value, id)
  itemDrafts.value = without(itemDrafts.value, id)
  togglePerItem(id, false)
}

function startEdit(r: SpendRecord) {
  forms.value = { ...forms.value, [r.id]: formFrom(working(r)) }
}

function cancelEdit(id: string) {
  forms.value = without(forms.value, id)
}

function discardEdit(id: string) {
  edits.value = without(edits.value, id)
}

function applyEdit(r: SpendRecord) {
  const form = forms.value[r.id]
  if (!form) return
  return run(r.id, async () => {
    // DB 現值 + 表單，不串接上一份預覽
    const out = await computeRecordUpdate(storage, r, formToPatch(form, r), {
      reclassify: !(r.id in drafts.value),
    })
    edits.value = { ...edits.value, [r.id]: out }
    cancelEdit(r.id)
  })
}

function learnedText(pattern: string, categoryId: string): string {
  return `已記住：${pattern} → ${categoryName.value(categoryId)}（可在設定 › 規則中刪除）`
}

async function run(id: string, fn: () => Promise<void>) {
  if (busyId.value) return
  busyId.value = id
  errorMsg.value = null
  notice.value = null
  try {
    await fn()
    await refreshRecords()
  } catch (err) {
    errorMsg.value = `操作失敗：${userMessage(err)}`
  } finally {
    busyId.value = null
  }
}

function itemDraftOf(r: SpendRecord, index: number): string {
  return itemDrafts.value[r.id]?.[index] ?? working(r).items[index]?.categoryId ?? ''
}

function setItemCategory(record: SpendRecord, index: number, categoryId: string) {
  if (!categoryId) return
  const items = working(record).items
  return run(record.id, async () => {
    const rule = await learnItemRule(storage, items, index, categoryId)
    const next = [...(itemDrafts.value[record.id] ?? items.map((it) => it.categoryId))]
    next[index] = categoryId
    itemDrafts.value = { ...itemDrafts.value, [record.id]: next }
    notice.value = rule
      ? learnedText(rule.pattern, rule.categoryId)
      : '這個品項沒辦法記成規則，只套用到這筆'
  })
}

function resolve(record: SpendRecord, remember: boolean, skipPerItem = false) {
  const edit = edits.value[record.id]
  const base = working(record)
  const items = itemDrafts.value[record.id]
  const target: SpendRecord = items
    ? {
        ...base,
        items: base.items.map((it, i) => ({ ...it, categoryId: items[i] ?? it.categoryId })),
      }
    : base
  const hasDraft = record.id in drafts.value
  return run(record.id, async () => {
    const out = await resolvePending(storage, target, {
      categoryId: drafts.value[record.id] ?? null,
      remember,
      skipPerItem,
      // 採用了重分類的結果才算命中；之後又選了類別就不算
      hitRuleIds: edit && !hasDraft ? edit.matchedRuleIds : [],
    })
    if (out.kind === 'needs_per_item') {
      togglePerItem(record.id, true)
      return
    }
    forget(record.id)
    if (!remember) return
    notice.value = out.learned
      ? learnedText(out.learned.pattern, out.learned.categoryId)
      : '沒有店家或品項可記，只確認'
  })
}

function remove(record: SpendRecord) {
  return run(record.id, async () => {
    await deleteRecord(storage, record)
    confirmingDelete.value = null
    forget(record.id)
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
    <p v-if="notice" class="result ok">{{ notice }}</p>

    <section v-for="r in pendingRecords" :key="r.id" class="panel">
      <div class="row">
        <span class="merchant">{{ working(r).merchant || '（無店家）' }}</span>
        <span class="amount">${{ working(r).amount }}</span>
      </div>
      <p class="sub">
        {{ working(r).date }} ·
        {{ working(r).items.map((i) => i.name).join('、') || '無品項' }}
      </p>
      <p v-if="r.rawInput" class="raw">原始輸入：{{ r.rawInput }}</p>
      <img
        v-if="r.photoId && thumbs[r.photoId]"
        :src="thumbs[r.photoId]"
        alt="發票照片"
        class="thumb"
      />

      <div v-if="edits[r.id]" class="edited">
        <span class="hint">已修改，按確認才會存</span>
        <button
          class="btn-text"
          :disabled="busyId === r.id || perItemFor.has(r.id)"
          @click="discardEdit(r.id)"
        >
          放棄修改
        </button>
      </div>

      <div v-if="forms[r.id]" class="edit-form">
        <label class="field">
          <span>日期</span>
          <input v-model="forms[r.id]!.date" type="date" :disabled="busyId === r.id" />
        </label>
        <label class="field">
          <span>店家</span>
          <input v-model="forms[r.id]!.merchant" type="text" :disabled="busyId === r.id" />
        </label>
        <label class="field">
          <span>金額</span>
          <input
            v-model="forms[r.id]!.amount"
            type="number"
            inputmode="numeric"
            step="1"
            :disabled="busyId === r.id"
          />
        </label>
        <label class="field">
          <span>品項</span>
          <textarea
            v-model="forms[r.id]!.itemsText"
            rows="3"
            placeholder="一行一個品項"
            :disabled="busyId === r.id"
          />
        </label>
        <label class="field">
          <span>備註</span>
          <input v-model="forms[r.id]!.note" type="text" :disabled="busyId === r.id" />
        </label>
        <div class="actions">
          <button class="btn-primary" :disabled="busyId === r.id" @click="applyEdit(r)">
            完成修改
          </button>
          <button class="btn-text" :disabled="busyId === r.id" @click="cancelEdit(r.id)">
            取消修改
          </button>
        </div>
      </div>
      <button
        v-else
        class="btn-text"
        :disabled="busyId === r.id || perItemFor.has(r.id)"
        @click="startEdit(r)"
      >
        修改
      </button>

      <ul class="reasons">
        <li v-for="reason in r.pendingReasons" :key="reason">{{ REASON_TEXT[reason] }}</li>
      </ul>

      <label class="field">
        <span>類別</span>
        <select
          :value="draftOf(r)"
          :disabled="busyId === r.id"
          @change="setDraft(r.id, ($event.target as HTMLSelectElement).value)"
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
        <label v-for="(item, i) in working(r).items" :key="i" class="field">
          <span>{{ item.name }}</span>
          <select
            :value="itemDraftOf(r, i)"
            :disabled="busyId === r.id"
            @change="setItemCategory(r, i, ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>請選擇</option>
            <option v-for="c in activeCategories" :key="c.id" :value="c.id">
              {{ c.icon }} {{ c.name }}
            </option>
          </select>
        </label>
        <div class="actions">
          <button
            class="btn-primary"
            :disabled="busyId === r.id || r.id in forms"
            @click="resolve(r, false)"
          >
            完成並確認
          </button>
          <button
            class="btn-text"
            :disabled="busyId === r.id || r.id in forms"
            @click="resolve(r, true, true)"
          >
            略過，只記住店家（並確認）
          </button>
        </div>
      </div>

      <div v-else class="actions">
        <button
          class="btn-primary"
          :disabled="busyId === r.id || r.id in forms"
          @click="resolve(r, false)"
        >
          確認（目前為 {{ categoryName(draftOf(r) || null) }}）
        </button>
        <button
          class="btn-text"
          :disabled="busyId === r.id || r.id in forms || !draftOf(r)"
          @click="resolve(r, true)"
        >
          確認並記住規則
        </button>
      </div>

      <div class="actions">
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

.raw {
  margin-top: 2px;
  font-size: 13px;
  color: var(--c-text-dim);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.thumb {
  display: block;
  max-height: 96px;
  margin-top: var(--space-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.edited {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
  font-size: 13px;
}

.edit-form {
  margin-top: var(--space-3);
}

.field input,
.field textarea {
  flex: 1;
  max-width: 60%;
  padding: var(--space-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-bg);
  color: var(--c-text);
  /* iOS 在 font-size < 16px 的輸入框會自動放大畫面。 */
  font-size: 16px;
}

.field textarea {
  font-family: inherit;
  resize: vertical;
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
