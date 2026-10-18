import { ref } from 'vue'
import { getStorage, seed } from '@/storage'
import { loadActiveRules, seedBuiltinRules } from '@/services/ruleService'
import { shouldRemindBackup } from '@/services/backupService'
import type { Category, Settings } from '@/models/types'
import { reportError } from '@/errors/errorLog'
import { updateSettings } from '@/services/settingsService'

export type InitState = 'idle' | 'running' | 'ready' | 'failed'

const state = ref<InitState>('idle')
const error = ref<string | null>(null)
const categoryCount = ref<number | null>(null)
const ruleCount = ref<number | null>(null)
const recordCount = ref<number | null>(null)
const needsBackup = ref(false)
const settings = ref<Settings | null>(null)
const persistGranted = ref<boolean | null>(null)
const usage = ref<{ usage: number; quota: number | null } | null>(null)

let running: Promise<void> | null = null
let queued: Promise<void> | null = null

/**
 * 呼叫後保證完成一次完整執行：寫入後要重讀的呼叫端不能拿到寫入前那一輪的結果。
 * 執行中再呼叫就排一輪，排隊那一輪開始前的呼叫都併進它。
 */
export function initStorage(): Promise<void> {
  if (queued) return queued
  if (!running) {
    running = runInit().finally(() => {
      running = null
    })
    return running
  }
  // runInit 不會 reject（catch-all），兩路都接是為了不讓 queued 卡死
  const rerun = () => {
    queued = null
    return initStorage()
  }
  queued = running.then(rerun, rerun)
  return queued
}

async function runInit() {
  state.value = 'running'
  error.value = null

  const storage = getStorage()
  try {
    const loaded = await seed(storage)
    await seedBuiltinRules(storage)

    // persist() 必須在有資料之後才問，否則 Safari 幾乎必定拒絕。
    const granted = (await storage.isPersisted()) || (await storage.requestPersist())
    persistGranted.value = granted

    let current = loaded
    if (loaded.platform.persistGranted !== granted) {
      // requestPersist 期間其他頁可能寫了 settings，不能拿 loaded 整份寫回
      const saved = await updateSettings(storage, (s) => ({
        ...s,
        platform: { ...s.platform, persistGranted: granted },
      }))
      if (!saved) throw new Error('settings 在初始化途中被刪除')
      current = saved
    }

    settings.value = current
    categoryCount.value = (await storage.getAll<Category>('categories')).length
    ruleCount.value = (await loadActiveRules(storage)).length
    recordCount.value = await storage.count('records')
    needsBackup.value = shouldRemindBackup(current, recordCount.value)
    usage.value = await storage.estimateUsage()
    state.value = 'ready'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    state.value = 'failed'
    // 環境檢查顯示原文；錯誤紀錄留 stack 與 where（B5b）
    reportError(e, 'manual', 'useStorageStatus.initStorage')
  }
}

export interface BlobRoundTrip {
  ok: boolean
  detail: string
}

/**
 * §13 要求在真機確認 iOS Safari 能把 Blob 存進 IndexedDB 再原樣讀回。
 * 這是 Phase 2 唯一無法用 fake-indexeddb 代替的驗收項目。
 */
export async function runBlobRoundTrip(): Promise<BlobRoundTrip> {
  const storage = getStorage()
  const id = `selftest-${crypto.randomUUID()}`
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

  try {
    await storage.put('photos', {
      id,
      blob: new Blob([bytes], { type: 'image/jpeg' }),
      thumbBlob: new Blob([bytes.slice(0, 4)], { type: 'image/jpeg' }),
      width: 1,
      height: 1,
      bytes: bytes.length,
      capturedAt: Date.now(),
    })

    const got = await storage.get<{ blob: Blob; thumbBlob: Blob }>('photos', id)
    if (!got) return { ok: false, detail: '寫入後讀不到資料' }

    const back = new Uint8Array(await got.blob.arrayBuffer())
    const same = back.length === bytes.length && back.every((b, i) => b === bytes[i])
    const typeKept = got.blob.type === 'image/jpeg'

    return same && typeKept
      ? { ok: true, detail: `${back.length} bytes 一致，MIME 保留` }
      : { ok: false, detail: `位元組一致=${same}，MIME 保留=${typeKept}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  } finally {
    await storage.delete('photos', id).catch(() => {})
  }
}

export function useStorageStatus() {
  return {
    state,
    error,
    categoryCount,
    ruleCount,
    recordCount,
    needsBackup,
    settings,
    persistGranted,
    usage,
  }
}
