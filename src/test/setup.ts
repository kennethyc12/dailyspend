// 掛上 indexedDB / IDBKeyRange / IDBFactory 等全域，模擬瀏覽器環境。
// 各測試仍會用新的 IDBFactory 取代 indexedDB，確保彼此不共用資料。
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'

// jsdom 的 Blob 經 Node 的 structuredClone 會默默變成空物件（不丟錯），
// 照片寫進 fake-indexeddb 再讀回就沒有內容了。換回 Node 的 Blob。
if (typeof window !== 'undefined') {
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true, writable: true })
}
