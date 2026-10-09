<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { getStorage } from '@/storage'
import type { Settings } from '@/models/types'
import { analyze } from '@/analysis/analyze'
import { KIND_LABEL, type Finding } from '@/analysis/types'
import { todayIso } from '@/parsing/quickInput'
import { refreshRecords, useRecords } from '@/composables/useRecords'
import { initStorage } from '@/composables/useStorageStatus'

const storage = getStorage()
const { records, categories } = useRecords()

const settings = shallowRef<Settings | null>(null)
const showThresholds = ref(false)
const errorMsg = ref<string | null>(null)
const today = todayIso()

onMounted(async () => {
  await initStorage()
  await refreshRecords()
  settings.value = (await storage.get<Settings>('settings', 'settings')) ?? null
})

const result = computed(() =>
  settings.value
    ? analyze(records.value, categories.value, settings.value.thresholds, today)
    : null,
)

const others = computed(() => {
  const picked = new Set(result.value?.suggestions ?? [])
  return (result.value?.findings ?? []).filter((f) => !picked.has(f))
})

/** 門檻改動即時重算並存回 settings，下次開啟沿用。 */
async function updateThreshold(path: [string, string], value: number) {
  const current = settings.value
  if (!current || !Number.isFinite(value)) return

  const [group, key] = path
  const next: Settings = {
    ...current,
    thresholds: {
      ...current.thresholds,
      [group]: { ...(current.thresholds as never as Record<string, object>)[group], [key]: value },
    } as Settings['thresholds'],
    updatedAt: Date.now(),
  }
  settings.value = next

  try {
    await storage.put('settings', next)
  } catch (err) {
    errorMsg.value = `門檻儲存失敗：${(err as Error).message}`
  }
}

const THRESHOLD_FIELDS: Array<{ path: [string, string]; label: string }> = [
  { path: ['smallFrequent', 'windowDays'], label: '高頻小額 · 觀察天數' },
  { path: ['smallFrequent', 'smallAmount'], label: '高頻小額 · 單筆上限（元）' },
  { path: ['smallFrequent', 'minCount'], label: '高頻小額 · 最少次數' },
  { path: ['subscription', 'minMonths'], label: '訂閱 · 最少連續月數' },
  { path: ['subscription', 'maxMonthlyOccurrences'], label: '訂閱 · 每月最多次數' },
  { path: ['subscription', 'amountVariancePct'], label: '訂閱 · 金額變異上限（%）' },
  { path: ['monthGrowth', 'growthPct'], label: '月對月 · 增幅門檻（%）' },
  { path: ['monthGrowth', 'minDelta'], label: '月對月 · 最小增額（元）' },
  { path: ['repeatPurchase', 'windowDays'], label: '重複購買 · 觀察天數' },
  { path: ['repeatPurchase', 'minRepeat'], label: '重複購買 · 最少次數' },
  { path: ['suggestion', 'topN'], label: '建議條數' },
]

function thresholdValue(path: [string, string]): number {
  const groups = settings.value?.thresholds as never as Record<string, Record<string, number>>
  return groups?.[path[0]]?.[path[1]] ?? 0
}

function money(n: number) {
  return n.toLocaleString('zh-TW')
}

function evidenceText(f: Finding) {
  const n = f.evidence.recordIds.length
  return f.evidence.itemNames?.length
    ? `依據：${f.evidence.itemNames.join('、')}，共 ${n} 筆紀錄`
    : `依據：${n} 筆紀錄`
}
</script>

<template>
  <main class="page">
    <h1>分析</h1>

    <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>

    <template v-if="result">
      <section v-if="result.suggestions.length" class="panel">
        <h2>可以考慮減少的支出</h2>
        <p class="hint">依「每月等值金額」排序，不同性質的支出才能互相比較。</p>
        <ol class="findings">
          <li v-for="(f, i) in result.suggestions" :key="i">
            <div class="row">
              <span class="title">{{ f.title }}</span>
              <span class="money">{{ f.estimated ? '約 ' : '' }}${{ money(f.monthlyEquivalent) }}/月</span>
            </div>
            <p class="detail">{{ f.detail }}</p>
            <p class="evidence">{{ KIND_LABEL[f.kind] }} · {{ evidenceText(f) }}</p>
          </li>
        </ol>
      </section>

      <section v-if="others.length" class="panel">
        <h2>其他觀察</h2>
        <ol class="findings">
          <li v-for="(f, i) in others" :key="i">
            <div class="row">
              <span class="title">{{ f.title }}</span>
              <span class="money">{{ f.estimated ? '約 ' : '' }}${{ money(f.monthlyEquivalent) }}/月</span>
            </div>
            <p class="detail">{{ f.detail }}</p>
            <p class="evidence">{{ KIND_LABEL[f.kind] }} · {{ evidenceText(f) }}</p>
          </li>
        </ol>
      </section>

      <section v-if="result.insufficient.length" class="panel">
        <h2>還不能分析的項目</h2>
        <ul class="pending-list">
          <li v-for="(i, idx) in result.insufficient" :key="idx">
            <strong>{{ KIND_LABEL[i.kind] }}</strong> — {{ i.message }}
          </li>
        </ul>
      </section>

      <p v-for="(c, i) in result.caveats" :key="i" class="hint caveat">※ {{ c }}</p>

      <section class="panel">
        <button class="toggle" @click="showThresholds = !showThresholds">
          調整判斷門檻 {{ showThresholds ? '▾' : '▸' }}
        </button>
        <template v-if="showThresholds">
          <p class="hint">改完立刻重算，設定會保留。</p>
          <label v-for="f in THRESHOLD_FIELDS" :key="f.label" class="field">
            <span>{{ f.label }}</span>
            <input
              type="number"
              inputmode="numeric"
              :value="thresholdValue(f.path)"
              @change="updateThreshold(f.path, Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </template>
      </section>
    </template>
  </main>
</template>

<style scoped>
.findings {
  list-style: none;
  counter-reset: item;
}

.findings li {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--c-border);
}

.findings li:last-child {
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
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-dim);
}

.pending-list {
  list-style: none;
  font-size: 13px;
  color: var(--c-text-dim);
}

.pending-list li {
  padding: var(--space-1) 0;
}

.caveat {
  margin-top: var(--space-4);
}

.toggle {
  font-size: 15px;
  font-weight: 600;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
  font-size: 13px;
}

.field input {
  width: 92px;
  padding: var(--space-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-bg);
  color: var(--c-text);
  font-size: 16px;
  text-align: right;
}
</style>
