<script setup lang="ts">
import { computed } from 'vue'
import { useDisplayMode, enableDevBypass } from '@/composables/useDisplayMode'

const { platform } = useDisplayMode()
const isDev = import.meta.env.DEV

const steps = computed<string[]>(() => {
  switch (platform.value) {
    case 'ios-safari':
      return [
        '點畫面下方正中央的「分享」按鈕（方框加向上箭頭）',
        '在選單中往下滑，選「加入主畫面」',
        '右上角按「新增」',
        '回到主畫面，從 DailySpend 圖示開啟',
      ]
    case 'ios-other-browser':
      return [
        '這個瀏覽器無法把網頁加到主畫面',
        '複製目前網址，改用內建的 Safari 開啟',
        '在 Safari 中依照「分享 → 加入主畫面」完成安裝',
      ]
    case 'android':
      return [
        '點右上角的「⋮」選單',
        '選「安裝應用程式」或「加到主畫面」',
        '確認後從主畫面的圖示開啟',
      ]
    default:
      return [
        'DailySpend 是手機 App，請用手機開啟這個網址',
        'iPhone 請使用 Safari，Android 請使用 Chrome',
      ]
  }
})
</script>

<template>
  <main class="guide">
    <div class="mark" aria-hidden="true">₪</div>
    <h1>先把 DailySpend 加到主畫面</h1>

    <p class="why">
      iOS 上，Safari 分頁和主畫面 App 的資料是<strong>兩份完全分開的儲存空間</strong>。
      在分頁裡記的帳，加到主畫面之後看不到；而且分頁的資料閒置幾天就可能被系統清掉。
    </p>
    <p class="why">為了不讓你把帳記在會消失的地方，安裝完成前先不開放記帳。</p>

    <ol class="steps">
      <li v-for="(step, i) in steps" :key="i">{{ step }}</li>
    </ol>

    <p class="note">安裝完成後，請從主畫面的圖示開啟，這個頁面就會自動消失。</p>

    <button v-if="isDev" class="btn-text dev" @click="enableDevBypass">
      [dev only] 略過安裝檢查
    </button>
  </main>
</template>

<style scoped>
.guide {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: var(--radius);
  background: var(--c-accent);
  color: #fff;
  font-size: 30px;
  margin-bottom: var(--space-5);
}

h1 {
  font-size: 22px;
  line-height: 1.4;
  margin-bottom: var(--space-4);
}

.why {
  color: var(--c-text-dim);
  font-size: 15px;
  margin-bottom: var(--space-3);
}

.why strong {
  color: var(--c-text);
}

.steps {
  margin: var(--space-5) 0 var(--space-4);
  padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.steps li {
  margin-bottom: var(--space-3);
}

.steps li:last-child {
  margin-bottom: 0;
}

.note {
  font-size: 14px;
  color: var(--c-text-dim);
}

.dev {
  margin-top: var(--space-6);
}
</style>
