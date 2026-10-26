<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { categoryName, refreshRecords, useRecords } from '@/composables/useRecords'
import type { SpendRecord } from '@/models/types'
import { NO_MERCHANT } from '@/models/labels'
import { getStorage } from '@/storage'
import { saveFile } from '@/backup/share'
import { handleError } from '@/errors/handleError'
import {
  commitBulkDelete,
  prepareBulkDelete,
  type BulkDeletePreview,
} from '@/services/backupService'

const { records } = useRecords()
const storage = getStorage()
const keyword = ref('')

onMounted(refreshRecords)

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return records.value
  return records.value.filter(
    (r) =>
      r.merchant.toLowerCase().includes(q) ||
      r.items.some((i) => i.name.toLowerCase().includes(q)) ||
      categoryName.value(r.categoryId).toLowerCase().includes(q),
  )
})

/** 依日期分組，列表才看得出「哪一天花了多少」。 */
const groups = computed(() => {
  const map = new Map<string, SpendRecord[]>()
  for (const r of filtered.value) {
    const list = map.get(r.date)
    if (list) list.push(r)
    else map.set(r.date, [r])
  }
  return [...map.entries()].map(([date, items]) => ({
    date,
    items,
    total: items.reduce((s, r) => s + r.amount, 0),
  }))
})

const total = computed(() => filtered.value.reduce((s, r) => s + r.amount, 0))

const selecting = ref(false)
const selected = ref<Set<string>>(new Set())
// 必須是 shallowRef：safetyBackup 是 File，preview 不能被深層代理（同 BackupView 的 restorePreview）
const preview = shallowRef<BulkDeletePreview | null>(null)
const preparing = ref(false)
const safetyDelivered = ref(false)
const deleting = ref(false)
const errorMsg = ref<string | null>(null)
const done = ref<string | null>(null)

const locked = computed(() => preparing.value || preview.value !== null)

// 勾選永遠是畫面上看得到的：換關鍵字或紀錄被別處刪掉，看不到的就不能被刪
watch(keyword, () => {
  selected.value = new Set()
  done.value = null
})
watch(records, (rs) => {
  const alive = new Set(rs.map((r) => r.id))
  selected.value = new Set([...selected.value].filter((id) => alive.has(id)))
})

const picked = computed(() => filtered.value.filter((r) => selected.value.has(r.id)))
const pickedTotal = computed(() => picked.value.reduce((s, r) => s + r.amount, 0))

const showBar = computed(
  () => (selecting.value && (selected.value.size > 0 || locked.value)) || done.value !== null,
)

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectAllVisible() {
  selected.value = new Set(filtered.value.map((r) => r.id))
}

function enterSelecting() {
  done.value = null
  selecting.value = true
}

async function startDelete() {
  errorMsg.value = null
  preparing.value = true
  try {
    preview.value = await prepareBulkDelete(storage, picked.value)
  } catch (err) {
    // 失敗回到選取狀態、勾選保留；再按會重新組檔，不沿用舊檔（舊檔可能是刪除前更早的資料）
    errorMsg.value = handleError(err, { where: 'RecordsView.startDelete', failed: '準備保險備份失敗' })
  } finally {
    preparing.value = false
  }
}

// iOS 要求 navigator.share 在使用者手勢的同步呼叫鏈內：saveFile 之前不能有 await
async function downloadSafety() {
  if (!preview.value) return
  errorMsg.value = null
  try {
    const outcome = await saveFile(preview.value.safetyBackup)
    if (outcome !== 'cancelled') safetyDelivered.value = true
  } catch (err) {
    errorMsg.value = handleError(err, {
      where: 'RecordsView.downloadSafety',
      failed: '保險備份匯出失敗',
    })
  }
}

// 「沒存保險備份不能刪」只由 ② 的 :disabled 守，這裡刻意不再檢查一次；API 層由 prepare/commit 守
async function confirmDelete() {
  const p = preview.value
  if (!p) return
  errorMsg.value = null
  deleting.value = true
  try {
    let deleted: number
    try {
      deleted = await commitBulkDelete(storage, p)
    } catch (err) {
      // 單一 transaction：失敗整批回滾，「資料未變更」才成立
      errorMsg.value = handleError(err, {
        where: 'RecordsView.confirmDelete',
        failed: '刪除失敗，資料未變更',
      })
      return
    }
    // 先退出再 refresh：刪除已完成，refresh 失敗時不該卡在確認步驟
    exitSelecting()
    done.value = `已刪除 ${deleted} 筆`
    await refreshRecords()
  } finally {
    deleting.value = false
  }
}

function cancelDelete() {
  preview.value = null
  safetyDelivered.value = false
  errorMsg.value = null
}

function exitSelecting() {
  cancelDelete()
  selecting.value = false
  selected.value = new Set()
}
</script>

<template>
  <main class="page" :class="{ 'with-bar': showBar }">
    <h1>紀錄</h1>

    <input
      v-model="keyword"
      class="search"
      type="search"
      placeholder="搜尋店家、品項或類別"
      :disabled="locked"
    />
    <div class="toolbar">
      <p class="hint">{{ filtered.length }} 筆 · 共 ${{ total }}</p>
      <template v-if="selecting">
        <button class="btn-text" :disabled="locked" @click="selectAllVisible">全選目前結果</button>
        <button class="btn-text" :disabled="locked" @click="exitSelecting">完成</button>
      </template>
      <button v-else-if="filtered.length > 0" class="btn-text" @click="enterSelecting">選取</button>
    </div>

    <p v-if="records.length === 0" class="hint">還沒有任何紀錄，先到「記帳」存一筆。</p>
    <p v-else-if="filtered.length === 0" class="hint">沒有符合的紀錄。</p>

    <section v-for="g in groups" :key="g.date" class="panel">
      <h2>{{ g.date }} · ${{ g.total }}</h2>
      <ul class="list">
        <li v-for="r in g.items" :key="r.id">
          <component
            :is="selecting ? 'label' : RouterLink"
            v-bind="selecting ? {} : { to: `/records/${r.id}` }"
            class="entry"
            :class="{ pick: selecting }"
          >
            <input
              v-if="selecting"
              type="checkbox"
              :checked="selected.has(r.id)"
              :disabled="locked"
              @change="toggle(r.id)"
            />
            <div class="body">
              <div class="row">
                <span class="merchant">
                  {{ r.merchant || NO_MERCHANT }}
                  <span v-if="r.photoId" class="has-photo" title="有發票照片">📷</span>
                </span>
                <span class="amount">${{ r.amount }}</span>
              </div>
              <div class="row sub">
                <span>{{ r.items.map((i) => i.name).join('、') || '—' }}</span>
                <span :class="{ warn: r.categoryId === null }">
                  {{ categoryName(r.categoryId) }}
                  <template v-if="r.status === 'pending'"> · 待確認</template>
                </span>
              </div>
            </div>
          </component>
        </li>
      </ul>
    </section>

    <div v-if="showBar" class="bar" role="status">
      <p v-if="done !== null">{{ done }}</p>

      <template v-else-if="preview === null">
        <div class="bar-row">
          <span>已選 {{ picked.length }} 筆 · ${{ pickedTotal }}</span>
          <button class="btn-danger" :disabled="preparing || picked.length === 0" @click="startDelete">
            {{ preparing ? '準備中…' : `刪除 ${picked.length} 筆` }}
          </button>
        </div>
      </template>

      <template v-else>
        <p>刪除 {{ preview.count }} 筆紀錄，共 ${{ preview.total }}。</p>
        <p v-if="preview.photoCount > 0">其中 {{ preview.photoCount }} 筆附有發票照片，會一起刪除。</p>
        <p v-if="preview.invoiceCount > 0">
          其中 {{ preview.invoiceCount }} 筆是發票，之後重新匯入或重掃會再出現。
        </p>
        <p>學到的分類規則不會刪除，可到設定 › 規則刪除。</p>
        <button class="btn-primary mt" :disabled="deleting" @click="downloadSafety">
          {{ safetyDelivered ? '✓ 已存下保險備份（可重複存）' : '① 先存下目前資料的保險備份' }}
        </button>
        <button class="btn-danger mt" :disabled="!safetyDelivered || deleting" @click="confirmDelete">
          {{ deleting ? '刪除中…' : `② 確認刪除 ${preview.count} 筆` }}
        </button>
        <button class="btn-text mt" :disabled="deleting" @click="cancelDelete">取消</button>
      </template>

      <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>
    </div>
  </main>
</template>

<style scoped>
.search {
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.toolbar .hint {
  flex: 1;
}

.list {
  list-style: none;
}

.list li {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--c-border);
}

.entry {
  display: block;
  color: inherit;
  text-decoration: none;
}

.entry.pick {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
}

.body {
  flex: 1;
  min-width: 0;
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

.has-photo {
  font-size: 12px;
}

.sub {
  margin-top: 2px;
  font-size: 13px;
  color: var(--c-text-dim);
}

/* 底部列疊在 AppNav 上方（同 App.vue 的 .update-bar），列表要多留空間，最後幾筆才勾得到 */
.page.with-bar {
  padding-bottom: calc(var(--safe-bottom) + 88px + 80px);
}

.bar {
  position: fixed;
  left: var(--space-4);
  right: var(--space-4);
  bottom: calc(var(--safe-bottom) + 72px);
  max-height: 60vh;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  font-size: 14px;
}

.bar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.bar-row .btn-danger {
  width: auto;
  flex-shrink: 0;
}

/* 同 BackupView 的 .btn-danger（scoped，沒有放進 base.css） */
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

.mt {
  margin-top: var(--space-2);
}
</style>
