<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { categoryName, refreshRecords, useRecords } from '@/composables/useRecords'
import type { SpendRecord } from '@/models/types'

const { records } = useRecords()
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
</script>

<template>
  <main class="page">
    <h1>紀錄</h1>

    <input v-model="keyword" class="search" type="search" placeholder="搜尋店家、品項或類別" />
    <p class="hint">{{ filtered.length }} 筆 · 共 ${{ total }}</p>

    <p v-if="records.length === 0" class="hint">還沒有任何紀錄，先到「記帳」存一筆。</p>
    <p v-else-if="filtered.length === 0" class="hint">沒有符合的紀錄。</p>

    <section v-for="g in groups" :key="g.date" class="panel">
      <h2>{{ g.date }} · ${{ g.total }}</h2>
      <ul class="list">
        <li v-for="r in g.items" :key="r.id">
          <div class="row">
            <span class="merchant">{{ r.merchant || '（無店家）' }}</span>
            <span class="amount">${{ r.amount }}</span>
          </div>
          <div class="row sub">
            <span>{{ r.items.map((i) => i.name).join('、') || '—' }}</span>
            <span :class="{ warn: r.categoryId === null }">
              {{ categoryName(r.categoryId) }}
              <template v-if="r.status === 'pending'"> · 待確認</template>
            </span>
          </div>
        </li>
      </ul>
    </section>
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
</style>
