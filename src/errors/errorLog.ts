import { shallowRef } from 'vue'

export type ErrorSource = 'vue' | 'promise' | 'window' | 'manual'

export interface AppError {
  id: string
  message: string
  source: ErrorSource
  /** 元件名或檔案位置，能指到哪算哪。 */
  where: string | null
  stack: string | null
  at: number
}

const MAX_KEPT = 20

const errors = shallowRef<AppError[]>([])
const latest = shallowRef<AppError | null>(null)

function describe(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) return { message: value.message || value.name, stack: value.stack ?? null }
  if (typeof value === 'string') return { message: value, stack: null }
  try {
    return { message: JSON.stringify(value), stack: null }
  } catch {
    return { message: String(value), stack: null }
  }
}

export function reportError(value: unknown, source: ErrorSource = 'manual', where: string | null = null) {
  const { message, stack } = describe(value)
  const entry: AppError = {
    id: crypto.randomUUID(),
    message,
    source,
    where,
    stack,
    at: Date.now(),
  }

  // 最新的放前面，只留最近 MAX_KEPT 筆——這是除錯用的線索，不是稽核紀錄。
  errors.value = [entry, ...errors.value].slice(0, MAX_KEPT)
  latest.value = entry
  console.error(`[${source}]`, value)
  return entry
}

export function dismissLatest() {
  latest.value = null
}

export function clearErrors() {
  errors.value = []
  latest.value = null
}

export function useErrorLog() {
  return { errors, latest }
}
