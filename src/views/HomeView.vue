<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDisplayMode } from '@/composables/useDisplayMode'
import {
  initStorage,
  runBlobRoundTrip,
  useStorageStatus,
  type BlobRoundTrip,
} from '@/composables/useStorageStatus'

const { isStandalone, platform, devBypass } = useDisplayMode()
const { state, error, categoryCount, ruleCount, persistGranted, usage } = useStorageStatus()

const swSupported = 'serviceWorker' in navigator
const blobResult = ref<BlobRoundTrip | null>(null)
const blobRunning = ref(false)

onMounted(initStorage)

async function testBlob() {
  blobRunning.value = true
  blobResult.value = await runBlobRoundTrip()
  blobRunning.value = false
}

function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}
</script>

<template>
  <main class="home">
    <h1>DailySpend</h1>
    <p class="phase">Phase 2 儲存層 — 記帳功能尚未實作</p>

    <section class="panel">
      <h2>環境檢查</h2>
      <dl>
        <dt>顯示模式</dt>
        <dd :class="isStandalone ? 'ok' : 'warn'">
          {{ isStandalone ? 'standalone（主畫面 App）' : '瀏覽器分頁' }}
          <span v-if="devBypass"> · dev bypass</span>
        </dd>

        <dt>平台判定</dt>
        <dd>{{ platform }}</dd>

        <dt>Service Worker</dt>
        <dd :class="swSupported ? 'ok' : 'warn'">
          {{ swSupported ? '可用' : '不可用（需 HTTPS）' }}
        </dd>
      </dl>
    </section>

    <section class="panel">
      <h2>儲存層</h2>
      <dl>
        <dt>資料庫</dt>
        <dd :class="state === 'ready' ? 'ok' : state === 'failed' ? 'warn' : ''">
          {{
            state === 'ready'
              ? 'dailyspend v1 已開啟'
              : state === 'failed'
                ? `開啟失敗：${error}`
                : '開啟中…'
          }}
        </dd>

        <dt>內建類別</dt>
        <dd>{{ categoryCount === null ? '—' : `${categoryCount} 項` }}</dd>

        <dt>啟用中規則</dt>
        <dd>{{ ruleCount === null ? '—' : `${ruleCount} 條` }}</dd>

        <dt>儲存已持久化</dt>
        <dd :class="persistGranted ? 'ok' : 'warn'">
          {{ persistGranted === null ? '瀏覽器不支援' : persistGranted ? '是' : '否（系統拒絕）' }}
        </dd>

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

    <section class="panel">
      <h2>Blob 往返自我測試</h2>
      <p class="hint">確認 iOS Safari 能把照片原樣存進 IndexedDB 再讀回。</p>
      <button class="btn-primary" :disabled="state !== 'ready' || blobRunning" @click="testBlob">
        {{ blobRunning ? '測試中…' : '執行測試' }}
      </button>
      <p v-if="blobResult" class="result" :class="blobResult.ok ? 'ok' : 'warn'">
        {{ blobResult.ok ? '通過' : '失敗' }} — {{ blobResult.detail }}
      </p>
    </section>
  </main>
</template>

<style scoped>
.home {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

h1 {
  font-size: 24px;
}

.phase {
  color: var(--c-text-dim);
  font-size: 14px;
  margin-bottom: var(--space-5);
}

.panel {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}

h2 {
  font-size: 15px;
  margin-bottom: var(--space-3);
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-4);
  font-size: 14px;
}

dt {
  color: var(--c-text-dim);
  white-space: nowrap;
}

.hint {
  font-size: 13px;
  color: var(--c-text-dim);
  margin-bottom: var(--space-3);
}

.result {
  margin-top: var(--space-3);
  font-size: 14px;
}

button:disabled {
  opacity: 0.5;
}

.ok {
  color: var(--c-accent);
}

.warn {
  color: var(--c-warn);
}
</style>
