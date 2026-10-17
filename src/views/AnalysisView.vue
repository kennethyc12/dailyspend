<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { THRESHOLD_RANGES, getStorage, isInThresholdRange, type ThresholdRange } from '@/storage'
import type { Settings } from '@/models/types'
import { analyze } from '@/analysis/analyze'
import { KIND_LABEL } from '@/analysis/types'
import { todayIso } from '@/parsing/quickInput'
import { refreshRecords, useRecords } from '@/composables/useRecords'
import { initStorage } from '@/composables/useStorageStatus'
import { handleError } from '@/errors/handleError'
import { updateSettings } from '@/services/settingsService'
import FindingItem from '@/components/FindingItem.vue'
import { ValidationError } from '@/services/entryService'

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
async function updateThreshold(f: ThresholdField, raw: string) {
  errorMsg.value = null
  if (!settings.value) return

  const [group, key] = f.path
  try {
    const range = rangeOf(f.path)
    // 空白先擋：Number('') 是 0，而 0 對變異 %、增幅 % 是合法值
    const value = raw.trim() === '' ? Number.NaN : Number(raw)
    if (!isInThresholdRange(value, range)) {
      throw new ValidationError(`${f.label}要填 ${rangeText(range)}`, key)
    }
    const saved = await updateSettings(storage, (s) => ({
      ...s,
      thresholds: {
        ...s.thresholds,
        [group]: { ...(s.thresholds as never as Record<string, object>)[group], [key]: value },
      } as Settings['thresholds'],
    }))
    // 寫入成功才更新畫面：失敗時畫面與重新進頁一致
    if (saved) settings.value = saved
  } catch (err) {
    errorMsg.value = handleError(err, { where: 'AnalysisView.updateThreshold', failed: '門檻儲存失敗' })
  }
}

interface ThresholdField {
  path: [keyof Settings['thresholds'], string]
  label: string
}

const THRESHOLD_FIELDS: ThresholdField[] = [
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

function rangeOf(path: ThresholdField['path']): ThresholdRange {
  return (THRESHOLD_RANGES[path[0]] as Record<string, ThresholdRange>)[path[1]]!
}

function rangeText(r: ThresholdRange): string {
  return r.max === undefined ? `${r.min} 以上的整數` : `${r.min}–${r.max} 的整數`
}

function thresholdValue(path: ThresholdField['path']): number {
  const groups = settings.value?.thresholds as never as Record<string, Record<string, number>>
  return groups?.[path[0]]?.[path[1]] ?? 0
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
          <FindingItem
            v-for="f in result.suggestions"
            :key="`${f.kind}:${f.title}`"
            :finding="f"
            :records="records"
          />
        </ol>
      </section>

      <section v-if="others.length" class="panel">
        <h2>其他觀察</h2>
        <ol class="findings">
          <FindingItem
            v-for="f in others"
            :key="`${f.kind}:${f.title}`"
            :finding="f"
            :records="records"
          />
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
              step="1"
              :min="rangeOf(f.path).min"
              :max="rangeOf(f.path).max"
              :value="thresholdValue(f.path)"
              @change="updateThreshold(f, ($event.target as HTMLInputElement).value)"
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
