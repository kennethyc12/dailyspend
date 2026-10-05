<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { useDisplayMode } from '@/composables/useDisplayMode'
import InstallGuideView from '@/views/InstallGuideView.vue'

const { isStandalone, devBypass } = useDisplayMode()
const { needRefresh, updateServiceWorker } = useRegisterSW()
</script>

<template>
  <!--
    閘門放在這裡而非 router guard：router guard 擋不住直接輸入網址，
    而「不讓使用者在 Safari 分頁累積資料」必須是沒有縫隙的。
  -->
  <InstallGuideView v-if="!isStandalone && !devBypass" />
  <RouterView v-else />

  <div v-if="needRefresh" class="update-bar" role="status">
    <span>有新版本</span>
    <button @click="updateServiceWorker(true)">更新</button>
  </div>
</template>

<style scoped>
.update-bar {
  position: fixed;
  left: var(--space-4);
  right: var(--space-4);
  bottom: calc(var(--safe-bottom) + var(--space-4));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--c-text);
  color: var(--c-bg);
  font-size: 14px;
}

.update-bar button {
  font-weight: 600;
  text-decoration: underline;
}
</style>
