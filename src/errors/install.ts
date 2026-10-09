import type { App } from 'vue'
import { reportError } from './errorLog'

/**
 * 接住所有沒被 handler 攔下的錯誤。
 *
 * 每個 view 的 async handler 都有自己的 try/catch，但只要漏掉一個，
 * 使用者看到的就是「按鈕沒反應」——Phase 6 的還原按鈕就是這樣卡住的。
 * 這層是安全網，不是替代品：能在 handler 裡處理的仍然要在那裡處理，
 * 因為那裡才知道該顯示什麼訊息。
 *
 * iPhone 上沒有 console 可看，所以錯誤要留在 App 裡（設定 › 環境檢查）。
 */
export function installGlobalErrorHandlers(app: App) {
  app.config.errorHandler = (err, instance, info) => {
    reportError(err, 'vue', `${instance?.$options.name ?? '元件'} · ${info}`)
  }

  if (typeof window === 'undefined') return

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'promise', null)
  })

  window.addEventListener('error', (event) => {
    // 圖片或 script 載入失敗也會觸發這個事件，但沒有 error 物件。
    if (!event.error) return
    const where = event.filename ? `${event.filename}:${event.lineno}` : null
    reportError(event.error, 'window', where)
  })
}
