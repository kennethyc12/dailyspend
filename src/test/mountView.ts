import { afterEach, beforeEach, expect, vi } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import type { Component } from 'vue'
import { IndexedDbAdapter, seed, setStorage } from '@/storage'
import { seedBuiltinRules } from '@/services/ruleService'
import { router } from '@/router'
import { clearErrors, useErrorLog } from '@/errors/errorLog'

const mounted: VueWrapper[] = []

export async function freshStorage(): Promise<IndexedDbAdapter> {
  globalThis.indexedDB = new IDBFactory()
  const storage = new IndexedDbAdapter()
  setStorage(storage)
  await seed(storage)
  await seedBuiltinRules(storage)
  return storage
}

/** 每個頁面測試檔在頂層呼叫一次：重設 storage、URL mock，並在結束時確認沒有錯誤被吞掉。 */
export function useViewTest(): { storage: () => IndexedDbAdapter } {
  let storage: IndexedDbAdapter

  beforeEach(async () => {
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    storage = await freshStorage()
    await router.replace('/')
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount()
    const { errors } = useErrorLog()
    const leaked = errors.value.map((e) => e.message)
    clearErrors()
    expect(leaked).toEqual([])
  })

  return { storage: () => storage }
}

export async function mountView(view: Component, path = '/'): Promise<VueWrapper> {
  await router.replace(path)
  await router.isReady()
  const wrapper = mount(view, {
    attachTo: document.body,
    global: {
      plugins: [router],
      config: {
        errorHandler: (err) => {
          throw err
        },
      },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

export function field(wrapper: VueWrapper, label: string): DOMWrapper<HTMLInputElement | HTMLSelectElement> {
  const found = wrapper
    .findAll('label')
    .find((l) => l.find('span').exists() && l.find('span').text() === label)
  if (!found) throw new Error(`找不到欄位「${label}」`)
  const control = found.find<HTMLInputElement | HTMLSelectElement>('input, select')
  if (!control.exists()) throw new Error(`欄位「${label}」沒有輸入元件`)
  return control
}

export function button(wrapper: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const found = wrapper.findAll<HTMLButtonElement>('button').find((b) => b.text().trim() === text)
  if (!found) throw new Error(`找不到按鈕「${text}」`)
  return found
}

export async function pickFile(input: DOMWrapper<HTMLInputElement>, file: File) {
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

/** 等到畫面上沒有任何 disabled 的輸入元件，代表非同步工作都結束、使用者可以操作了。 */
export async function settled(wrapper: VueWrapper, selector = 'input, select') {
  await vi.waitFor(() => {
    const busy = wrapper
      .findAll<HTMLInputElement | HTMLSelectElement>(selector)
      .filter((el) => el.element.disabled)
    expect(busy).toHaveLength(0)
  })
}

export async function waitForText(wrapper: VueWrapper, text: string) {
  await vi.waitFor(() => expect(wrapper.text()).toContain(text))
}
