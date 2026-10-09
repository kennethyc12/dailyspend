<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { getStorage } from '@/storage'
import type { Rule, RuleOrigin } from '@/models/types'
import { deleteRule, listRules, setRuleActive } from '@/services/ruleService'
import { categoryName, refreshRecords, useRecords } from '@/composables/useRecords'
import { initStorage, useStorageStatus } from '@/composables/useStorageStatus'
import { useDisplayMode } from '@/composables/useDisplayMode'

const storage = getStorage()
const { isStandalone, platform } = useDisplayMode()
const { state, error, persistGranted, usage, settings } = useStorageStatus()
const { records } = useRecords()

const rules = shallowRef<Rule[]>([])
const originFilter = ref<RuleOrigin | 'all'>('userCorrection')
const errorMsg = ref<string | null>(null)
const showDiagnostics = ref(false)

const visibleRules = computed(() =>
  originFilter.value === 'all'
    ? rules.value
    : rules.value.filter((r) => r.origin === originFilter.value),
)

const lastBackupText = computed(() => {
  const at = settings.value?.backup.lastBackupAt
  return at ? new Date(at).toLocaleDateString('zh-TW') : '從未備份'
})

async function loadRules() {
  rules.value = await listRules(storage)
}

onMounted(async () => {
  await initStorage()
  await Promise.all([refreshRecords(), loadRules()])
})

async function act(fn: () => Promise<void>) {
  errorMsg.value = null
  try {
    await fn()
    await loadRules()
  } catch (err) {
    errorMsg.value = (err as Error).message
  }
}

function toggle(rule: Rule) {
  return act(() => setRuleActive(storage, rule.id, !rule.isActive))
}

function remove(rule: Rule) {
  return act(() => deleteRule(storage, rule.id))
}

function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}
</script>

<template>
  <main class="page">
    <h1>設定</h1>

    <RouterLink to="/backup" class="panel link">
      <span>備份與匯出</span>
      <span class="sub">上次備份：{{ lastBackupText }}</span>
    </RouterLink>

    <section class="panel">
      <h2>分類規則</h2>
      <p class="hint">
        你每次修正分類，系統就會記成一條規則。這裡可以查看與刪除。
        刪除規則不會改動既有紀錄，只影響之後的分類。
      </p>

      <div class="filters">
        <button
          v-for="opt in (['userCorrection', 'builtin', 'all'] as const)"
          :key="opt"
          class="chip"
          :class="{ on: originFilter === opt }"
          @click="originFilter = opt"
        >
          {{ opt === 'userCorrection' ? '我修正的' : opt === 'builtin' ? '內建' : '全部' }}
        </button>
      </div>

      <p v-if="visibleRules.length === 0" class="hint">
        {{ originFilter === 'userCorrection' ? '還沒有任何修正學來的規則。' : '沒有規則。' }}
      </p>

      <ul v-else class="list">
        <li v-for="r in visibleRules" :key="r.id" :class="{ off: !r.isActive }">
          <div class="row">
            <span>
              <strong>{{ r.pattern }}</strong>
              → {{ categoryName(r.categoryId) }}
            </span>
            <span class="sub">{{ r.type === 'itemKeyword' ? '品項' : '店家' }}</span>
          </div>
          <div class="row sub">
            <span>命中 {{ r.hitCount }} 次</span>
            <span class="rule-actions">
              <button class="btn-text" @click="toggle(r)">
                {{ r.isActive ? '停用' : '啟用' }}
              </button>
              <button v-if="r.origin === 'userCorrection'" class="btn-text danger" @click="remove(r)">
                刪除
              </button>
            </span>
          </div>
        </li>
      </ul>
    </section>

    <section class="panel">
      <button class="toggle" @click="showDiagnostics = !showDiagnostics">
        環境檢查 {{ showDiagnostics ? '▾' : '▸' }}
      </button>
      <dl v-if="showDiagnostics">
        <dt>顯示模式</dt>
        <dd :class="isStandalone ? 'ok' : 'warn'">
          {{ isStandalone ? 'standalone' : '瀏覽器分頁' }} · {{ platform }}
        </dd>

        <dt>資料庫</dt>
        <dd :class="state === 'ready' ? 'ok' : 'warn'">
          {{ state === 'ready' ? 'dailyspend v1' : (error ?? state) }}
        </dd>

        <dt>紀錄 / 規則</dt>
        <dd>{{ records.length }} 筆 / {{ rules.length }} 條</dd>

        <dt>儲存已持久化</dt>
        <dd :class="persistGranted ? 'ok' : 'warn'">{{ persistGranted ? '是' : '否' }}</dd>

        <dt>用量</dt>
        <dd>
          {{
            usage === null
              ? '—'
              : usage.quota === null
                ? mb(usage.usage)
                : `${mb(usage.usage)} / ${mb(usage.quota)}`
          }}
        </dd>
      </dl>
    </section>

    <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>
  </main>
</template>

<style scoped>
.link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: inherit;
  text-decoration: none;
}

.filters {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.chip {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--c-border);
  border-radius: 999px;
  font-size: 13px;
  color: var(--c-text-dim);
}

.chip.on {
  background: var(--c-accent-dim);
  border-color: var(--c-accent);
  color: var(--c-accent);
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

.list li.off {
  opacity: 0.45;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 14px;
}

.sub {
  font-size: 13px;
  color: var(--c-text-dim);
}

.rule-actions {
  display: flex;
  gap: var(--space-3);
}

.danger {
  color: var(--c-warn);
}

.toggle {
  font-size: 15px;
  font-weight: 600;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-3);
  font-size: 13px;
}

dt {
  color: var(--c-text-dim);
  white-space: nowrap;
}
</style>
