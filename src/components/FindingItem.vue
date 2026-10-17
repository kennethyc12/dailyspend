<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { SpendRecord } from '@/models/types'
import { KIND_LABEL, type Finding } from '@/analysis/types'

const props = defineProps<{ finding: Finding; records: SpendRecord[] }>()

const open = ref(false)
const listId = useId()

// 沿用 records 既有的排序（日期新到舊）；evidence 本身的順序各規則不一致
const evidenceRecords = computed(() => {
  const ids = new Set(props.finding.evidence.recordIds)
  return props.records.filter((r) => ids.has(r.id))
})

const evidenceText = computed(() => {
  const f = props.finding
  const n = f.evidence.recordIds.length
  return f.evidence.itemNames?.length
    ? `依據：${f.evidence.itemNames.join('、')}，共 ${n} 筆紀錄`
    : `依據：${n} 筆紀錄`
})

function money(n: number) {
  return n.toLocaleString('zh-TW')
}
</script>

<template>
  <li class="finding">
    <div class="row">
      <span class="title">{{ finding.title }}</span>
      <span class="money">{{ finding.estimated ? '約 ' : '' }}${{ money(finding.monthlyEquivalent) }}/月</span>
    </div>
    <p class="detail">{{ finding.detail }}</p>
    <button
      type="button"
      class="evidence"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      @click="open = !open"
    >
      {{ KIND_LABEL[finding.kind] }} · {{ evidenceText }} {{ open ? '▾' : '▸' }}
    </button>
    <ul v-if="open" :id="listId" class="evidence-list">
      <li v-for="r in evidenceRecords" :key="r.id">
        <RouterLink :to="`/records/${r.id}`">
          {{ r.date }} · {{ r.merchant || '（無店家）' }} · ${{ money(r.amount) }}
        </RouterLink>
      </li>
    </ul>
  </li>
</template>

<style scoped>
.finding {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--c-border);
}

.finding:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.title {
  font-weight: 600;
  font-size: 15px;
}

.money {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--c-accent);
}

.detail {
  margin-top: 2px;
  font-size: 13px;
  color: var(--c-text-dim);
}

.evidence {
  display: block;
  margin-top: 2px;
  padding: 0;
  text-align: left;
  font-size: 12px;
  color: var(--c-text-dim);
}

.evidence-list {
  list-style: none;
  margin-top: var(--space-2);
  padding-left: var(--space-3);
  font-size: 13px;
}

.evidence-list li {
  padding: var(--space-1) 0;
}

.evidence-list a {
  color: var(--c-text-dim);
}
</style>
