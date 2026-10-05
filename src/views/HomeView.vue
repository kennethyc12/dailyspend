<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDisplayMode } from '@/composables/useDisplayMode'

const { isStandalone, platform, devBypass } = useDisplayMode()

const swSupported = 'serviceWorker' in navigator
const persisted = ref<boolean | null>(null)
const quotaMb = ref<number | null>(null)
const usageMb = ref<number | null>(null)

onMounted(async () => {
  if (navigator.storage?.persisted) {
    persisted.value = await navigator.storage.persisted()
  }
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate()
    usageMb.value = usage ? Math.round(usage / 1048576) : 0
    quotaMb.value = quota ? Math.round(quota / 1048576) : null
  }
})
</script>

<template>
  <main class="home">
    <h1>DailySpend</h1>
    <p class="phase">Phase 1 骨架 — 記帳功能尚未實作</p>

    <section class="diag">
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

        <dt>儲存已持久化</dt>
        <dd :class="persisted ? 'ok' : 'warn'">
          {{ persisted === null ? '瀏覽器不支援查詢' : persisted ? '是' : '否（Phase 2 會申請）' }}
        </dd>

        <dt>儲存配額</dt>
        <dd>{{ quotaMb === null ? '未知' : `${usageMb} / ${quotaMb} MB` }}</dd>
      </dl>
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

.diag {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: var(--space-4);
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

dd.ok {
  color: var(--c-accent);
}

dd.warn {
  color: var(--c-warn);
}
</style>
