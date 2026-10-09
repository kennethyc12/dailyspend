<script setup lang="ts">
import { dismissLatest, useErrorLog } from '@/errors/errorLog'

const { latest } = useErrorLog()
</script>

<template>
  <div v-if="latest" class="banner" role="alert">
    <div class="text">
      <strong>發生未處理的錯誤</strong>
      <span>{{ latest.message }}</span>
      <RouterLink to="/settings" class="more" @click="dismissLatest()">查看詳情</RouterLink>
    </div>
    <button aria-label="關閉" @click="dismissLatest()">✕</button>
  </div>
</template>

<style scoped>
.banner {
  position: fixed;
  left: var(--space-4);
  right: var(--space-4);
  top: calc(var(--safe-top) + var(--space-3));
  z-index: 10;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--c-warn);
  color: #fff;
  font-size: 13px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.text span {
  overflow-wrap: anywhere;
}

.more {
  margin-top: var(--space-1);
  color: #fff;
  text-decoration: underline;
}

button {
  color: #fff;
  font-size: 16px;
  line-height: 1;
}
</style>
