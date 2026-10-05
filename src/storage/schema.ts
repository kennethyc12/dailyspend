import type { StoreName } from './port'

export const DB_NAME = 'dailyspend'
export const DB_VERSION = 1

interface IndexDef {
  name: string
  keyPath: string
  unique?: boolean
}

interface StoreDef {
  name: StoreName
  keyPath: string
  indexes: IndexDef[]
}

export const SCHEMA: StoreDef[] = [
  {
    name: 'records',
    keyPath: 'id',
    indexes: [
      { name: 'by_date', keyPath: 'date' },
      // unique + sparse：invoiceKey 為 null 的紀錄不進索引，因此多筆 null 不衝突。
      // 這個行為是去重設計的前提，由 indexedDbAdapter.test.ts 明確驗證。
      { name: 'by_invoiceKey', keyPath: 'invoiceKey', unique: true },
      { name: 'by_categoryId', keyPath: 'categoryId' },
      { name: 'by_merchant', keyPath: 'merchant' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_updatedAt', keyPath: 'updatedAt' },
    ],
  },
  {
    name: 'categories',
    keyPath: 'id',
    indexes: [{ name: 'by_sortOrder', keyPath: 'sortOrder' }],
  },
  {
    name: 'rules',
    keyPath: 'id',
    indexes: [
      { name: 'by_type', keyPath: 'type' },
      { name: 'by_origin', keyPath: 'origin' },
      { name: 'by_pattern', keyPath: 'pattern' },
    ],
  },
  { name: 'photos', keyPath: 'id', indexes: [] },
  { name: 'settings', keyPath: 'key', indexes: [] },
]

export function applySchema(db: IDBDatabase) {
  for (const def of SCHEMA) {
    const store = db.objectStoreNames.contains(def.name)
      ? null
      : db.createObjectStore(def.name, { keyPath: def.keyPath })
    if (!store) continue
    for (const idx of def.indexes) {
      store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false })
    }
  }
}
