import { DB_NAME, DB_VERSION, applySchema } from './schema'
import {
  StorageConflictError,
  type KeyRange,
  type QueryOptions,
  type StoragePort,
  type StoreKey,
  type StoreName,
  type Tx,
} from './port'

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IDBRequest failed'))
  })
}

export function toIdbRange(range: KeyRange): IDBKeyRange | null {
  if (range.eq !== undefined) return IDBKeyRange.only(range.eq)

  const lower = range.gte ?? range.gt
  const upper = range.lte ?? range.lt
  const lowerOpen = range.gt !== undefined
  const upperOpen = range.lt !== undefined

  if (lower !== undefined && upper !== undefined) {
    return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen)
  }
  if (lower !== undefined) return IDBKeyRange.lowerBound(lower, lowerOpen)
  if (upper !== undefined) return IDBKeyRange.upperBound(upper, upperOpen)
  return null
}

function asConflict(error: unknown, store: StoreName): unknown {
  if (error instanceof DOMException && error.name === 'ConstraintError') {
    return new StorageConflictError(error.message, store)
  }
  return error
}

class IdbTx implements Tx {
  constructor(private readonly tx: IDBTransaction) {}

  async put<T>(store: StoreName, value: T): Promise<StoreKey> {
    try {
      return (await wrap(this.tx.objectStore(store).put(value))) as StoreKey
    } catch (e) {
      throw asConflict(e, store)
    }
  }

  get<T>(store: StoreName, id: StoreKey): Promise<T | undefined> {
    return wrap(this.tx.objectStore(store).get(id)) as Promise<T | undefined>
  }

  getByIndex<T>(store: StoreName, index: string, key: StoreKey): Promise<T | undefined> {
    return wrap(this.tx.objectStore(store).index(index).get(key)) as Promise<T | undefined>
  }

  async delete(store: StoreName, id: StoreKey): Promise<void> {
    await wrap(this.tx.objectStore(store).delete(id))
  }
}

export class IndexedDbAdapter implements StoragePort {
  private dbPromise: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => applySchema(req.result)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'))
      req.onblocked = () => reject(new Error('另一個分頁正開著舊版資料庫，請先關閉'))
    })
    return this.dbPromise
  }

  async transaction<T>(stores: StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T> {
    const db = await this.open()
    const tx = db.transaction(stores, 'readwrite')

    const settled = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(asConflict(tx.error, stores[0] ?? 'records'))
      tx.onerror = () => reject(asConflict(tx.error, stores[0] ?? 'records'))
    })

    let result: T
    try {
      result = await fn(new IdbTx(tx))
    } catch (e) {
      // fn 自己失敗時主動 abort，避免半套寫入留在資料庫裡。
      try {
        tx.abort()
      } catch {
        /* 已經結束的 transaction 再 abort 會丟錯，忽略 */
      }
      await settled.catch(() => {})
      throw e
    }

    await settled
    return result
  }

  async put<T>(store: StoreName, value: T): Promise<StoreKey> {
    return this.transaction([store], (tx) => tx.put(store, value))
  }

  async get<T>(store: StoreName, id: StoreKey): Promise<T | undefined> {
    const db = await this.open()
    return wrap(db.transaction(store, 'readonly').objectStore(store).get(id)) as Promise<
      T | undefined
    >
  }

  async getByIndex<T>(store: StoreName, index: string, key: StoreKey): Promise<T | undefined> {
    const db = await this.open()
    const idx = db.transaction(store, 'readonly').objectStore(store).index(index)
    return wrap(idx.get(key)) as Promise<T | undefined>
  }

  async query<T>(
    store: StoreName,
    index: string,
    range: KeyRange,
    opts: QueryOptions = {},
  ): Promise<T[]> {
    const db = await this.open()
    const source = db.transaction(store, 'readonly').objectStore(store).index(index)
    const idbRange = toIdbRange(range)
    const direction: IDBCursorDirection = opts.direction === 'desc' ? 'prev' : 'next'
    const limit = opts.limit ?? Infinity

    return new Promise((resolve, reject) => {
      const out: T[] = []
      const req = source.openCursor(idbRange, direction)
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor || out.length >= limit) {
          resolve(out)
          return
        }
        out.push(cursor.value as T)
        if (out.length >= limit) {
          resolve(out)
          return
        }
        cursor.continue()
      }
      req.onerror = () => reject(req.error ?? new Error('query failed'))
    })
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    const db = await this.open()
    return wrap(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>
  }

  async count(store: StoreName): Promise<number> {
    const db = await this.open()
    return wrap(db.transaction(store, 'readonly').objectStore(store).count())
  }

  async delete(store: StoreName, id: StoreKey): Promise<void> {
    await this.transaction([store], (tx) => tx.delete(store, id))
  }

  async estimateUsage(): Promise<{ usage: number; quota: number | null }> {
    if (!navigator.storage?.estimate) return { usage: 0, quota: null }
    const { usage, quota } = await navigator.storage.estimate()
    return { usage: usage ?? 0, quota: quota ?? null }
  }

  async requestPersist(): Promise<boolean> {
    if (!navigator.storage?.persist) return false
    return navigator.storage.persist()
  }

  async isPersisted(): Promise<boolean | null> {
    if (!navigator.storage?.persisted) return null
    return navigator.storage.persisted()
  }

  close() {
    void this.dbPromise?.then((db) => db.close())
    this.dbPromise = null
  }
}
