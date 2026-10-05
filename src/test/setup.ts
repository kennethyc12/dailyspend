// 掛上 indexedDB / IDBKeyRange / IDBFactory 等全域，模擬瀏覽器環境。
// 各測試仍會用新的 IDBFactory 取代 indexedDB，確保彼此不共用資料。
import 'fake-indexeddb/auto'
