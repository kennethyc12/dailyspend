<script setup lang="ts">
import { pendingRecords } from '@/composables/useRecords'
</script>

<template>
  <nav class="nav">
    <RouterLink to="/" class="tab">
      <span class="icon">＋</span>
      <span>記帳</span>
    </RouterLink>
    <RouterLink to="/records" class="tab">
      <span class="icon">☰</span>
      <span>紀錄</span>
    </RouterLink>
    <RouterLink to="/pending" class="tab">
      <span class="icon">
        ？
        <em v-if="pendingRecords.length" class="badge">{{ pendingRecords.length }}</em>
      </span>
      <span>待確認</span>
    </RouterLink>
    <RouterLink to="/settings" class="tab">
      <span class="icon">⚙</span>
      <span>設定</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--c-surface);
  border-top: 1px solid var(--c-border);
  padding-bottom: var(--safe-bottom);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) 0 var(--space-3);
  color: var(--c-text-dim);
  font-size: 11px;
  text-decoration: none;
}

.tab.router-link-exact-active {
  color: var(--c-accent);
}

.icon {
  position: relative;
  font-size: 19px;
  line-height: 1.1;
}

.badge {
  position: absolute;
  top: -4px;
  right: -12px;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--c-warn);
  color: #fff;
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
  text-align: center;
}
</style>
