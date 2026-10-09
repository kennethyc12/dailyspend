export type StoreName = 'records' | 'categories' | 'rules' | 'photos' | 'settings'

export type StoreKey = string | number

export interface KeyRange<K extends StoreKey = StoreKey> {
  eq?: K
  gte?: K
  gt?: K
  lte?: K
  lt?: K
}

export interface QueryOptions {
  direction?: 'asc' | 'desc'
  limit?: number
}

export interface Tx {
  put<T>(store: StoreName, value: T): Promise<StoreKey>
  get<T>(store: StoreName, id: StoreKey): Promise<T | undefined>
  getByIndex<T>(store: StoreName, index: string, key: StoreKey): Promise<T | undefined>
  delete(store: StoreName, id: StoreKey): Promise<void>
  clear(store: StoreName): Promise<void>
}

export interface StoragePort {
  put<T>(store: StoreName, value: T): Promise<StoreKey>
  get<T>(store: StoreName, id: StoreKey): Promise<T | undefined>
  getByIndex<T>(store: StoreName, index: string, key: StoreKey): Promise<T | undefined>
  query<T>(store: StoreName, index: string, range: KeyRange, opts?: QueryOptions): Promise<T[]>
  getAll<T>(store: StoreName): Promise<T[]>
  count(store: StoreName): Promise<number>
  delete(store: StoreName, id: StoreKey): Promise<void>
  /** 清空整個 store。還原備份時用，是破壞性操作。 */
  clear(store: StoreName): Promise<void>

  /**
   * fn 內只能 await 本介面的方法。await 任何非儲存層的 Promise（影像壓縮、
   * 雜湊、fetch、計時器）會讓 IndexedDB 的 transaction 提前 commit，
   * 之後的寫入直接丟 TransactionInactiveError。前處理一律在呼叫前做完。
   */
  transaction<T>(stores: StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T>

  estimateUsage(): Promise<{ usage: number; quota: number | null }>
  requestPersist(): Promise<boolean>
  isPersisted(): Promise<boolean | null>
  close(): void
}

/**
 * 值無法被 structured clone。最常見的原因是把 Vue 的深層響應式物件
 * （`ref().value` 或 `reactive()`）直接寫進資料庫——Proxy 不可複製。
 */
export class StorageSerializationError extends Error {
  constructor(
    message: string,
    readonly store: StoreName,
  ) {
    super(message)
    this.name = 'StorageSerializationError'
  }
}

export class StorageConflictError extends Error {
  constructor(
    message: string,
    readonly store: StoreName,
  ) {
    super(message)
    this.name = 'StorageConflictError'
  }
}
