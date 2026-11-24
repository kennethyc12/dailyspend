// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { IDBObjectStore } from 'fake-indexeddb'
import QuickInputView from '@/views/QuickInputView.vue'
import PendingView from '@/views/PendingView.vue'
import type { Photo, Rule, SpendRecord } from '@/models/types'
import type { StoreKey, StoreName } from '@/storage'
import { createFromText } from '@/services/entryService'
import { pendingRecords, refreshRecords } from '@/composables/useRecords'
import { clearErrors } from '@/errors/errorLog'
import { prepareRecord } from '@/services/recordService'
import { basePriority } from '@/classify/matching'
import { deferred } from '@/test/fixtures'
import { router } from '@/router'
import { button, mountView, settled, useViewTest, waitForText } from '@/test/mountView'

vi.mock('@/recognize/qrDetect', () => ({
  detectQrCodes: vi.fn(),
  warmUp: vi.fn(async () => 0),
}))

const { storage } = useViewTest()

// pendingRecords 是模組層級狀態：先 refreshRecords，immediate watch 才不會讀到上一個測試的 photoId
async function open() {
  await refreshRecords()
  const wrapper = await mountView(PendingView, '/pending')
  await settled(wrapper)
  return wrapper
}

function bareRecord(overrides: Partial<SpendRecord>): SpendRecord {
  return {
    id: 'r1',
    date: '2026-01-01',
    merchant: '某店',
    amount: 320,
    items: [],
    categoryId: null,
    categorySource: 'rule',
    classifyConfidence: 0,
    recognizeConfidence: null,
    status: 'pending',
    pendingReasons: ['no_category_match'],
    invoiceNumber: null,
    invoicePeriod: null,
    invoiceKey: null,
    invoiceRandomCode: null,
    sourceType: 'manual',
    photoId: null,
    rawRecognition: null,
    note: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function card(wrapper: VueWrapper, merchant: string) {
  const found = wrapper.findAll('section').find((s) => s.find('.merchant').text() === merchant)
  if (!found) throw new Error(`找不到卡片「${merchant}」`)
  return found
}

describe('待確認', () => {
  it('記一筆輸入「全家 咖啡 55 麵包」→ 待確認頁說明金額後面還有字', async () => {
    const entry = await mountView(QuickInputView)
    await settled(entry)
    await entry.find('input.entry').setValue('全家 咖啡 55 麵包')
    await button(entry, '存檔').trigger('click')
    await waitForText(entry, '需要確認')

    const pending = await mountView(PendingView, '/pending')
    await waitForText(pending, '金額後面還有字，已當成品項，請確認')
    expect(pending.text()).toContain('咖啡、麵包')
  })
})

describe('確認與確認並記住規則（B4.2a）', () => {
  // pendingRecords 是模組層級的狀態，不先重讀的話剛掛上時還是上一個測試的卡片
  async function pendingWith(text: string) {
    await createFromText(storage(), text)
    await refreshRecords()
    const wrapper = await mountView(PendingView, '/pending')
    await settled(wrapper)
    return wrapper
  }

  const only = async () => (await storage().getAll<SpendRecord>('records'))[0]!

  it('多品項改類別後卡片不會消失（B-1）', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await pending.find('select').setValue('fun')
    await settled(pending)

    expect(pending.text()).toContain('某店')
    expect(await only()).toMatchObject({ status: 'pending', categoryId: null })
  })

  const learnedRules = async () =>
    (await storage().getAll<Rule>('rules')).filter((r) => r.origin === 'userCorrection')

  function selectFor(wrapper: VueWrapper, label: string) {
    const found = wrapper.findAll('label').find((l) => l.find('span').text() === label)
    if (!found) throw new Error(`找不到欄位「${label}」`)
    return found.find('select')
  }

  it('多品項記住 → 逐項指定 → 完成並確認', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)

    await selectFor(pending, '甲甲').setValue('fun')
    await waitForText(pending, '已記住：甲甲 → 娛樂（可在設定 › 規則中刪除）')
    await settled(pending)
    await selectFor(pending, '乙乙').setValue('daily')
    await settled(pending)
    await button(pending, '完成並確認').trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    const patterns = (await learnedRules()).map((r) => [r.pattern, r.categoryId])
    expect(patterns).toEqual(
      expect.arrayContaining([
        ['甲甲', 'fun'],
        ['乙乙', 'daily'],
      ]),
    )
    expect(await only()).toMatchObject({ status: 'confirmed', categoryId: 'fun' })
  })

  it('「確認」只確認，不記規則', async () => {
    const pending = await pendingWith('某店 320')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認（目前為 娛樂）').trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    expect(pending.text()).not.toContain('已記住')
    expect(await learnedRules()).toHaveLength(0)
  })

  it('「確認並記住規則」提示學到的規則', async () => {
    const pending = await pendingWith('某店 320')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')

    await waitForText(pending, '已記住：某店 → 娛樂（可在設定 › 規則中刪除）')
  })

  it('沒選類別時不能記住', async () => {
    const pending = await pendingWith('某店 320')

    expect(button(pending, '確認並記住規則').element.disabled).toBe(true)
  })

  it('多品項略過逐項指定 → 只記住店家並確認', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)
    await button(pending, '略過，只記住店家（並確認）').trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    const learned = await learnedRules()
    expect(learned).toHaveLength(1)
    expect(learned[0]).toMatchObject({ type: 'merchant', pattern: '某店' })
  })

  it('沒有店家也沒有品項：照樣確認並說明沒東西可記', async () => {
    const pending = await pendingWith('320')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')

    await waitForText(pending, '沒有店家或品項可記，只確認')
    expect(pending.text()).toContain('沒有待確認的紀錄')
  })

  it('逐項面板展開時也能刪除', async () => {
    const pending = await pendingWith('某店 甲甲 乙乙 100')
    await selectFor(pending, '類別').setValue('fun')
    await button(pending, '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)
    await button(pending, '刪除這筆').trigger('click')
    await button(pending, '確定刪除').trigger('click')

    await waitForText(pending, '沒有待確認的紀錄')
    expect(await storage().getAll('records')).toHaveLength(0)
  })
})

describe('原始輸入與縮圖（B4.2b-1）', () => {
  async function pendingWithPhoto(text: string, photo?: Photo) {
    await createFromText(storage(), text, undefined, photo)
    return open()
  }

  function fakePhoto(id: string): Photo {
    return {
      id,
      blob: new Blob(['full'], { type: 'image/jpeg' }),
      thumbBlob: new Blob(['thumb'], { type: 'image/jpeg' }),
      width: 10,
      height: 10,
      bytes: 5,
      capturedAt: 0,
    }
  }

  function spyGet() {
    const s = storage()
    const real = s.get.bind(s)
    return vi.spyOn(s, 'get').mockImplementation(real)
  }

  /** 讓 photos 的讀取停住，手動放行；其他 store 照常。 */
  function holdPhotoReads() {
    const s = storage()
    const real = s.get.bind(s)
    const gates: (() => void)[] = []
    const get = vi
      .spyOn(s, 'get')
      .mockImplementation(async <T>(store: StoreName, key: StoreKey) => {
        if (store === 'photos') await new Promise<void>((r) => gates.push(r))
        return real<T>(store, key)
      })
    return { get, release: () => gates.splice(0).forEach((r) => r()) }
  }

  /** 負向斷言前的同步點：等那一次 photos 讀取真的回來。 */
  async function photoReadDone(get: ReturnType<typeof spyGet>, id: string) {
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('photos', id))
    const i = get.mock.calls.findIndex(([store, key]) => store === 'photos' && key === id)
    await get.mock.results[i]!.value
    await flushPromises()
  }

  const confirmIn = (wrapper: VueWrapper, merchant: string) =>
    card(wrapper, merchant)
      .findAll('button')
      .find((b) => b.text() === '確認（目前為 未分類）')!
      .trigger('click')

  const createUrl = () => vi.mocked(URL.createObjectURL)
  const revokeUrl = () => vi.mocked(URL.revokeObjectURL)

  it('顯示當初打的原始輸入', async () => {
    const pending = await pendingWithPhoto('某店 甲甲 55 乙乙')

    expect(pending.text()).toContain('原始輸入：某店 甲甲 55 乙乙')
  })

  it('原始輸入不正規化', async () => {
    const pending = await pendingWithPhoto('某店 甲甲 ５５ 乙乙')

    expect(pending.text()).toContain('原始輸入：某店 甲甲 ５５ 乙乙')
  })

  it('沒有原始輸入也沒有照片：不顯示原始輸入、不讀照片', async () => {
    await storage().put('records', bareRecord({}))
    const get = spyGet()
    const pending = await open()

    expect(pending.text()).toContain('某店')
    expect(pending.text()).not.toContain('原始輸入')
    expect(get.mock.calls.filter(([store]) => store === 'photos')).toHaveLength(0)
  })

  it('有照片：顯示縮圖，用的是縮圖不是原圖', async () => {
    const pending = await pendingWithPhoto('某店 320', fakePhoto('p1'))

    await vi.waitFor(() => expect(pending.find('img[alt="發票照片"]').exists()).toBe(true))
    expect(await (createUrl().mock.calls[0]![0] as Blob).text()).toBe('thumb')
  })

  it('照片已不存在：不顯示縮圖', async () => {
    await storage().put('records', bareRecord({ photoId: 'gone' }))
    const get = spyGet()
    const pending = await open()
    await photoReadDone(get, 'gone')

    expect(pending.find('img[alt="發票照片"]').exists()).toBe(false)
    expect(createUrl()).not.toHaveBeenCalled()
  })

  it('確認後卡片離開，縮圖網址被釋放', async () => {
    const pending = await pendingWithPhoto('某店 320', fakePhoto('p1'))
    await vi.waitFor(() => expect(pending.find('img[alt="發票照片"]').exists()).toBe(true))
    await confirmIn(pending, '某店')
    await waitForText(pending, '沒有待確認的紀錄')

    expect(revokeUrl()).toHaveBeenCalledWith('blob:test')
  })

  it('離開頁面：縮圖網址被釋放', async () => {
    const pending = await pendingWithPhoto('某店 320', fakePhoto('p1'))
    await vi.waitFor(() => expect(pending.find('img[alt="發票照片"]').exists()).toBe(true))
    pending.unmount()

    expect(revokeUrl()).toHaveBeenCalledWith('blob:test')
  })

  it('確認其中一張：只釋放那張的縮圖，另一張不重建', async () => {
    let n = 0
    createUrl().mockImplementation(() => `blob:${++n}`)
    await createFromText(storage(), '甲店 320', undefined, fakePhoto('p1'))
    await createFromText(storage(), '乙店 320', undefined, fakePhoto('p2'))
    const pending = await open()
    await vi.waitFor(() => expect(pending.findAll('img[alt="發票照片"]')).toHaveLength(2))
    const urlOfA = card(pending, '甲店').find('img').attributes('src')!
    const urlOfB = card(pending, '乙店').find('img').attributes('src')!

    await confirmIn(pending, '甲店')
    await vi.waitFor(() => expect(pending.text()).not.toContain('甲店'))

    expect(revokeUrl()).toHaveBeenCalledWith(urlOfA)
    expect(revokeUrl()).not.toHaveBeenCalledWith(urlOfB)
    expect(createUrl()).toHaveBeenCalledTimes(2)
  })

  it('照片還沒讀完就確認：不建立縮圖網址', async () => {
    await createFromText(storage(), '某店 320', undefined, fakePhoto('p1'))
    const { get, release } = holdPhotoReads()
    const pending = await open()
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('photos', 'p1'))
    await confirmIn(pending, '某店')
    await waitForText(pending, '沒有待確認的紀錄')
    release()
    await photoReadDone(get, 'p1')

    expect(createUrl()).not.toHaveBeenCalled()
  })

  it('照片還沒讀完就離開頁面：不建立縮圖網址', async () => {
    await createFromText(storage(), '某店 320', undefined, fakePhoto('p1'))
    const { get, release } = holdPhotoReads()
    const pending = await open()
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('photos', 'p1'))
    pending.unmount()
    release()
    await photoReadDone(get, 'p1')

    expect(createUrl()).not.toHaveBeenCalled()
  })

  it('照片還沒讀完時頁面重整：不重複讀同一張', async () => {
    await createFromText(storage(), '甲店 320', undefined, fakePhoto('p1'))
    await createFromText(storage(), '乙店 320')
    const { get, release } = holdPhotoReads()
    const pending = await open()
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('photos', 'p1'))
    await confirmIn(pending, '乙店')
    await vi.waitFor(() => expect(pending.text()).not.toContain('乙店'))
    release()

    await vi.waitFor(() => expect(pending.find('img[alt="發票照片"]').exists()).toBe(true))
    expect(get.mock.calls.filter(([store]) => store === 'photos')).toHaveLength(1)
    expect(createUrl()).toHaveBeenCalledTimes(1)
  })

  it('讀照片失敗：錯誤交給全域處理', async () => {
    await createFromText(storage(), '某店 320', undefined, fakePhoto('p1'))
    await refreshRecords()
    const s = storage()
    const real = s.get.bind(s)
    const boom = new Error('讀照片失敗')
    vi.spyOn(s, 'get').mockImplementation(<T>(store: StoreName, key: StoreKey) =>
      store === 'photos' ? Promise.reject(boom) : real<T>(store, key),
    )
    const errorHandler = vi.fn()
    await router.replace('/pending')
    const wrapper = mount(PendingView, {
      attachTo: document.body,
      global: { plugins: [router], config: { errorHandler } },
    })

    try {
      await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled())
      expect(errorHandler).toHaveBeenCalledWith(boom, expect.anything(), 'watcher callback')
    } finally {
      wrapper.unmount()
    }
  })
})

describe('就地編輯（B4.2b-2）', () => {
  type Section = DOMWrapper<Element>

  async function pendingOf(text: string) {
    await createFromText(storage(), text)
    return open()
  }

  function fieldIn(section: Section, label: string) {
    const found = section.findAll('label').find((l) => l.find('span').text() === label)
    if (!found) throw new Error(`找不到欄位「${label}」`)
    return found.find<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input, select, textarea',
    )
  }

  function buttonIn(section: Section, text: string) {
    const found = section.findAll<HTMLButtonElement>('button').find((b) => b.text().trim() === text)
    if (!found) throw new Error(`找不到按鈕「${text}」`)
    return found
  }

  function confirmButton(section: Section) {
    const found = section
      .findAll<HTMLButtonElement>('button')
      .find((b) => b.text().startsWith('確認（目前為'))
    if (!found) throw new Error('找不到確認按鈕')
    return found
  }

  /** 按「修改」→ 改欄位 → 「完成修改」，等編輯草稿出現。 */
  async function edit(wrapper: VueWrapper, merchant: string, values: Record<string, string>) {
    await buttonIn(card(wrapper, merchant), '修改').trigger('click')
    const section = card(wrapper, merchant)
    for (const [label, value] of Object.entries(values)) await fieldIn(section, label).setValue(value)
    await buttonIn(section, '完成修改').trigger('click')
    await settled(wrapper)
  }

  const only = async () => (await storage().getAll<SpendRecord>('records'))[0]!
  const rules = () => storage().getAll<Rule>('rules')
  const ruleFor = async (pattern: string) => (await rules()).find((r) => r.pattern === pattern)!

  async function merchantRule(pattern: string, categoryId: string) {
    await storage().put('rules', {
      id: `rule-${pattern}`,
      type: 'merchant',
      pattern,
      matchMode: 'contains',
      categoryId,
      priority: basePriority('merchant', 'userCorrection'),
      origin: 'userCorrection',
      isActive: true,
      hitCount: 0,
      lastHitAt: null,
      createdAt: 0,
      updatedAt: 0,
    } satisfies Rule)
  }

  it('改金額：完成修改只改卡片，確認後才寫入', async () => {
    const pending = await pendingOf('某店 320')
    await edit(pending, '某店', { 金額: '450' })

    expect(card(pending, '某店').text()).toContain('$450')
    expect(card(pending, '某店').text()).toContain('已修改，按確認才會存')
    expect((await only()).amount).toBe(320)

    await confirmButton(card(pending, '某店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')
    expect(await only()).toMatchObject({ amount: 450, status: 'confirmed' })
  })

  it('補好店家後沒有原因了，卡片仍要等按確認才離開', async () => {
    await storage().put(
      'records',
      bareRecord({
        merchant: '',
        categoryId: 'fun',
        categorySource: 'user',
        pendingReasons: ['missing_merchant'],
      }),
    )
    const pending = await open()
    await edit(pending, '（無店家）', { 店家: '某店' })

    expect(card(pending, '某店').exists()).toBe(true)
    expect((await only()).status).toBe('pending')

    await confirmButton(card(pending, '某店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')
    expect(await only()).toMatchObject({ merchant: '某店', status: 'confirmed' })
  })

  it('改店家後重分類：按鈕顯示新類別，確認時才累計命中', async () => {
    await merchantRule('乙店', 'fun')
    const pending = await pendingOf('甲店 320')
    await edit(pending, '甲店', { 店家: '乙店' })

    expect(confirmButton(card(pending, '乙店')).text()).toBe('確認（目前為 娛樂）')
    expect((await ruleFor('乙店')).hitCount).toBe(0)

    await confirmButton(card(pending, '乙店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')
    expect(await only()).toMatchObject({ categoryId: 'fun', categorySource: 'rule' })
    expect((await ruleFor('乙店')).hitCount).toBe(1)
  })

  it('已選類別時改品項不重分類', async () => {
    const pending = await pendingOf('某店 甲甲 100')
    const tissue = await ruleFor('衛生紙')
    await fieldIn(card(pending, '某店'), '類別').setValue('fun')
    await edit(pending, '某店', { 品項: '衛生紙' })
    await confirmButton(card(pending, '某店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    const saved = await only()
    expect(saved).toMatchObject({ categoryId: 'fun', items: [{ name: '衛生紙', categoryId: null }] })
    expect((await ruleFor('衛生紙')).hitCount).toBe(tissue.hitCount)
  })

  it('完成修改後才選類別：不算重分類的命中', async () => {
    await merchantRule('乙店', 'fun')
    const pending = await pendingOf('甲店 320')
    await edit(pending, '甲店', { 店家: '乙店' })
    await fieldIn(card(pending, '乙店'), '類別').setValue('daily')
    await confirmButton(card(pending, '乙店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    expect(await only()).toMatchObject({ categoryId: 'daily', categorySource: 'user' })
    expect((await ruleFor('乙店')).hitCount).toBe(0)
  })

  it('改品項後記住：逐項面板列新品項，完成時一起寫入', async () => {
    const pending = await pendingOf('某店 甲甲 乙乙 100')
    await edit(pending, '某店', { 品項: '丙丙\n丁丁' })
    expect(card(pending, '某店').text()).toContain('丙丙、丁丁')
    await fieldIn(card(pending, '某店'), '類別').setValue('fun')
    await buttonIn(card(pending, '某店'), '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)

    await fieldIn(card(pending, '某店'), '丙丙').setValue('fun')
    await waitForText(pending, '已記住：丙丙 → 娛樂（可在設定 › 規則中刪除）')
    await settled(pending)
    await fieldIn(card(pending, '某店'), '丁丁').setValue('daily')
    await settled(pending)
    await buttonIn(card(pending, '某店'), '完成並確認').trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    expect((await only()).items.map((i) => [i.name, i.categoryId])).toEqual([
      ['丙丙', 'fun'],
      ['丁丁', 'daily'],
    ])
    expect(await ruleFor('丙丙')).toMatchObject({ type: 'itemKeyword', categoryId: 'fun' })
  })

  it('逐項選了類別但沒按完成：規則已學，紀錄的品項類別還沒寫', async () => {
    const pending = await pendingOf('某店 甲甲 乙乙 100')
    await fieldIn(card(pending, '某店'), '類別').setValue('fun')
    await buttonIn(card(pending, '某店'), '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)
    await fieldIn(card(pending, '某店'), '甲甲').setValue('fun')
    await waitForText(pending, '已記住：甲甲 → 娛樂')
    await settled(pending)

    expect(fieldIn(card(pending, '某店'), '甲甲').element.value).toBe('fun')
    expect(await ruleFor('甲甲')).toMatchObject({ categoryId: 'fun' })
    expect((await only()).items.map((i) => i.categoryId)).toEqual([null, null])
  })

  it('表單開著時不能確認', async () => {
    const pending = await pendingOf('某店 320')
    await fieldIn(card(pending, '某店'), '類別').setValue('fun')
    await buttonIn(card(pending, '某店'), '修改').trigger('click')

    expect(confirmButton(card(pending, '某店')).element.disabled).toBe(true)
    expect(buttonIn(card(pending, '某店'), '確認並記住規則').element.disabled).toBe(true)
  })

  it('逐項面板展開時不能修改或放棄修改', async () => {
    const pending = await pendingOf('某店 甲甲 乙乙 100')
    await fieldIn(card(pending, '某店'), '類別').setValue('fun')
    await edit(pending, '某店', { 金額: '200' })
    await buttonIn(card(pending, '某店'), '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)

    expect(buttonIn(card(pending, '某店'), '修改').element.disabled).toBe(true)
    expect(buttonIn(card(pending, '某店'), '放棄修改').element.disabled).toBe(true)
  })

  it('清空金額後完成修改：說明原因，表單留著', async () => {
    const pending = await pendingOf('某店 320')
    await edit(pending, '某店', { 金額: '' })

    expect(pending.text()).toContain('操作失敗：金額不能空白')
    expect(fieldIn(card(pending, '某店'), '金額').exists()).toBe(true)
  })

  it('取消修改：只收起表單，先前完成的修改還在', async () => {
    const pending = await pendingOf('某店 320')
    await edit(pending, '某店', { 金額: '450' })
    await buttonIn(card(pending, '某店'), '修改').trigger('click')
    await fieldIn(card(pending, '某店'), '金額').setValue('999')
    await buttonIn(card(pending, '某店'), '取消修改').trigger('click')

    expect(card(pending, '某店').text()).toContain('$450')

    await confirmButton(card(pending, '某店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')
    expect((await only()).amount).toBe(450)
  })

  it('放棄修改：卡片回到原值，確認時寫原值', async () => {
    const pending = await pendingOf('某店 320')
    await edit(pending, '某店', { 金額: '450' })
    await buttonIn(card(pending, '某店'), '放棄修改').trigger('click')

    expect(card(pending, '某店').text()).toContain('$320')

    await confirmButton(card(pending, '某店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')
    expect((await only()).amount).toBe(320)
  })

  it('改日期撞到另一張同號碼的發票：說明原因，兩筆都不變', async () => {
    const mine = prepareRecord(
      bareRecord({ id: 'mine', merchant: '甲店', date: '2026-01-05', invoiceNumber: 'AB00000001' }),
    )
    const other = prepareRecord(
      bareRecord({
        id: 'other',
        merchant: '乙店',
        date: '2026-03-05',
        invoiceNumber: 'AB00000001',
        pendingReasons: [],
      }),
    )
    await storage().put('records', mine)
    await storage().put('records', other)
    const pending = await open()
    await edit(pending, '甲店', { 日期: '2026-03-06' })
    expect(card(pending, '甲店').text()).toContain('2026-03-06')
    await confirmButton(card(pending, '甲店')).trigger('click')
    await waitForText(pending, '和另一張同號碼的發票重複')

    expect(await storage().get('records', 'mine')).toEqual(mine)
    expect(await storage().get('records', 'other')).toEqual(other)
  })

  it('逐項的「已記住」顯示規則實際存的字', async () => {
    const pending = await pendingOf('某店 甲甲 乙乙 100')
    await edit(pending, '某店', { 品項: 'ＡＡ\n乙乙' })
    await fieldIn(card(pending, '某店'), '類別').setValue('fun')
    await buttonIn(card(pending, '某店'), '確認並記住規則').trigger('click')
    await waitForText(pending, '逐項指定')
    await settled(pending)
    await fieldIn(card(pending, '某店'), 'ＡＡ').setValue('fun')

    await waitForText(pending, '已記住：AA → 娛樂')
  })

  it('再修改一次：以 DB 現值重算，重分類的命中照算', async () => {
    await merchantRule('乙店', 'fun')
    const pending = await pendingOf('甲店 320')
    await edit(pending, '甲店', { 店家: '乙店' })
    await edit(pending, '乙店', { 金額: '400' })
    await confirmButton(card(pending, '乙店')).trigger('click')
    await waitForText(pending, '沒有待確認的紀錄')

    expect(await only()).toMatchObject({ amount: 400, categoryId: 'fun' })
    expect((await ruleFor('乙店')).hitCount).toBe(1)
  })

  // 品名已 trim，正規化後不會是空字串；只剩 index 越界或規則被同時刪除，畫面上造不出來，由 service 測試守
  it.todo('逐項學不成規則時提示「這個品項沒辦法記成規則，只套用到這筆」')
})

describe('多選指定類別（pending-bulk-confirm）', () => {
  type Section = DOMWrapper<Element>

  afterEach(() => {
    vi.restoreAllMocks()
    clearErrors()
  })

  async function seedPending(specs: { merchant: string; amount?: number; reasons?: SpendRecord['pendingReasons'] }[]) {
    for (const [i, spec] of specs.entries()) {
      await storage().put(
        'records',
        bareRecord({
          id: `r${i}`,
          merchant: spec.merchant,
          amount: spec.amount ?? 100,
          pendingReasons: spec.reasons ?? ['no_category_match'],
        }),
      )
    }
    return open()
  }

  function buttonOf(section: Section, text: string) {
    const found = section.findAll<HTMLButtonElement>('button').find((b) => b.text().trim() === text)
    if (!found) throw new Error(`找不到按鈕「${text}」`)
    return found
  }

  const checkbox = (section: Section) => section.find<HTMLInputElement>('input[type="checkbox"]')
  const bar = (wrapper: VueWrapper) => wrapper.find('.bar')
  const barSelect = (wrapper: VueWrapper) => wrapper.find<HTMLSelectElement>('.bar select')
  const barButtons = (wrapper: VueWrapper) =>
    bar(wrapper).findAll<HTMLButtonElement>('button')
  const records = async () => storage().getAll<SpendRecord>('records')

  /** 卡住 run() 結束前那次 refreshRecords 的 getAll，busyId 就停在處理中，直到 gate.resolve()。 */
  function holdRecordsRefresh() {
    const gate = deferred<void>()
    const real = IDBObjectStore.prototype.getAll
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['getAll']>
    ) {
      const request = real.apply(this, args)
      if (this.name !== 'records') return request
      let handler: IDBRequest['onsuccess'] = null
      Object.defineProperty(request, 'onsuccess', {
        configurable: true,
        get: () =>
          function (this: IDBRequest, ev: Event) {
            void gate.promise.then(() => handler?.call(this, ev))
          },
        set: (fn: IDBRequest['onsuccess']) => {
          handler = fn
        },
      })
      return request
    })
    return gate
  }

  async function enterSelecting(wrapper: VueWrapper) {
    await button(wrapper, '選取').trigger('click')
  }

  async function tick(wrapper: VueWrapper, merchant: string) {
    await checkbox(card(wrapper, merchant)).setValue(true)
  }

  it('按「選取」才出現勾選框；有其他原因的卡不能勾並說明', async () => {
    const pending = await seedPending([
      { merchant: '甲店' },
      { merchant: '缺店', reasons: ['no_category_match', 'missing_merchant'] },
    ])
    expect(pending.findAll('input[type="checkbox"]')).toHaveLength(0)

    await enterSelecting(pending)

    expect(checkbox(card(pending, '甲店')).element.disabled).toBe(false)
    expect(checkbox(card(pending, '缺店')).element.disabled).toBe(true)
    expect(card(pending, '缺店').text()).toContain('還有其他待確認原因，請個別處理')
    expect(card(pending, '甲店').text()).not.toContain('還有其他待確認原因')
  })

  it('勾兩筆、選類別、確認 → 兩張卡消失，另一張還在', async () => {
    const pending = await seedPending([
      { merchant: '甲店', amount: 100 },
      { merchant: '乙店', amount: 50 },
      { merchant: '丙店' },
    ])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    await tick(pending, '乙店')
    expect(bar(pending).text()).toContain('已選 2 筆 · $150')
    await barSelect(pending).setValue('fun')
    await button(pending, '確認 2 筆為 娛樂').trigger('click')
    await waitForText(pending, '已確認 2 筆為 娛樂')
    await settled(pending)

    expect(pending.findAll('section').map((s) => s.find('.merchant').text())).toEqual(['丙店'])
    expect(pendingRecords.value).toHaveLength(1)
    const saved = await records()
    expect(saved.filter((r) => r.status === 'confirmed').map((r) => [r.merchant, r.categoryId]).sort()).toEqual([
      ['乙店', 'fun'],
      ['甲店', 'fun'],
    ])
    expect(bar(pending).exists()).toBe(false)
  })

  it('勾選期間有一筆被別處刪掉 → 告知略過幾筆', async () => {
    const pending = await seedPending([{ merchant: '甲店' }, { merchant: '乙店' }])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    await tick(pending, '乙店')
    await barSelect(pending).setValue('fun')
    await storage().delete('records', 'r1')
    await button(pending, '確認 2 筆為 娛樂').trigger('click')

    await waitForText(pending, '已確認 1 筆為 娛樂，1 筆已被處理，略過')
  })

  it('沒勾時沒有底部列；沒選類別時確認鈕停用', async () => {
    const pending = await seedPending([{ merchant: '甲店' }])
    await enterSelecting(pending)
    expect(bar(pending).exists()).toBe(false)

    await tick(pending, '甲店')
    const confirm = () => barButtons(pending).find((b) => b.text().startsWith('確認'))!
    expect(confirm().element.disabled).toBe(true)

    await barSelect(pending).setValue('fun')
    expect(confirm().element.disabled).toBe(false)
  })

  it('卡片展開修改表單 → 不能勾；已勾的卡開始修改 → 自動取消勾選', async () => {
    const pending = await seedPending([{ merchant: '甲店' }, { merchant: '乙店' }])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    expect(bar(pending).text()).toContain('已選 1 筆')

    await buttonOf(card(pending, '甲店'), '修改').trigger('click')
    expect(bar(pending).exists()).toBe(false)
    expect(checkbox(card(pending, '甲店')).element.disabled).toBe(true)
    expect(card(pending, '甲店').text()).toContain('這張卡有未完成的操作，完成或取消後才能勾選')

    await buttonOf(card(pending, '乙店'), '修改').trigger('click')
    expect(checkbox(card(pending, '乙店')).element.disabled).toBe(true)
  })

  it('「全選可勾的」只勾合格且沒有未完成流程的卡', async () => {
    const pending = await seedPending([
      { merchant: '甲店' },
      { merchant: '乙店' },
      { merchant: '缺店', reasons: ['no_category_match', 'missing_merchant'] },
    ])
    await buttonOf(card(pending, '乙店'), '修改').trigger('click')
    await enterSelecting(pending)
    await button(pending, '全選可勾的').trigger('click')

    expect(checkbox(card(pending, '甲店')).element.checked).toBe(true)
    expect(checkbox(card(pending, '乙店')).element.checked).toBe(false)
    expect(checkbox(card(pending, '缺店')).element.checked).toBe(false)
    expect(bar(pending).text()).toContain('已選 1 筆')
  })

  it('「完成」離開選取模式並清掉勾選', async () => {
    const pending = await seedPending([{ merchant: '甲店' }])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    await button(pending, '完成').trigger('click')

    expect(pending.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(bar(pending).exists()).toBe(false)
    await enterSelecting(pending)
    expect(checkbox(card(pending, '甲店')).element.checked).toBe(false)
  })

  it('批次寫入中，所有卡片的動作都停用', async () => {
    const pending = await seedPending([{ merchant: '甲店' }, { merchant: '乙店' }])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    await barSelect(pending).setValue('fun')

    const gate = holdRecordsRefresh()
    try {
      await button(pending, '確認 1 筆為 娛樂').trigger('click')
      const other = card(pending, '乙店')
      await vi.waitFor(() => expect(buttonOf(other, '修改').element.disabled).toBe(true))

      expect(buttonOf(other, '刪除這筆').element.disabled).toBe(true)
      const confirms = other.findAll<HTMLButtonElement>('button').filter((b) => b.text().startsWith('確認'))
      expect(confirms).not.toHaveLength(0)
      expect(confirms.every((b) => b.element.disabled)).toBe(true)
      expect(other.find<HTMLSelectElement>('select').element.disabled).toBe(true)
    } finally {
      gate.resolve()
    }
    await waitForText(pending, '已確認 1 筆為 娛樂')
  })

  it('別張卡單筆處理中：底部確認鈕與勾選框停用', async () => {
    const pending = await seedPending([{ merchant: '甲店' }, { merchant: '乙店' }])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    await barSelect(pending).setValue('fun')

    const gate = holdRecordsRefresh()
    try {
      const single = card(pending, '乙店')
        .findAll<HTMLButtonElement>('button')
        .find((b) => b.text().startsWith('確認（目前為'))!
      await single.trigger('click')
      const confirm = () => barButtons(pending).find((b) => b.text().startsWith('確認'))!
      await vi.waitFor(() => expect(confirm().element.disabled).toBe(true))
      expect(checkbox(card(pending, '甲店')).element.disabled).toBe(true)
      expect(barSelect(pending).element.disabled).toBe(true)
    } finally {
      gate.resolve()
    }
    await settled(pending)
  })

  it('待確認清空就離開選取模式：之後再出現的卡沒有勾選框', async () => {
    const pending = await seedPending([{ merchant: '甲店' }])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    await barSelect(pending).setValue('fun')
    await button(pending, '確認 1 筆為 娛樂').trigger('click')
    await waitForText(pending, '已確認 1 筆為 娛樂')

    await storage().put('records', bareRecord({ id: 'later', merchant: '後來店', pendingReasons: ['no_category_match'] }))
    await refreshRecords()
    await waitForText(pending, '後來店')

    expect(pending.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(button(pending, '選取').exists()).toBe(true)
  })

  it('寫入失敗 → 說明資料未變更，勾選保留', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending = await seedPending([{ merchant: '甲店' }, { merchant: '乙店' }])
    await enterSelecting(pending)
    await tick(pending, '甲店')
    await tick(pending, '乙店')
    await barSelect(pending).setValue('fun')
    const real = IDBObjectStore.prototype.put
    let calls = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      calls++
      if (calls === 2) throw new DOMException('quota', 'QuotaExceededError')
      return real.apply(this, args)
    })
    await button(pending, '確認 2 筆為 娛樂').trigger('click')
    await waitForText(pending, '批次確認失敗，資料未變更')
    vi.restoreAllMocks()

    expect(bar(pending).text()).toContain('已選 2 筆')
    expect((await records()).every((r) => r.status === 'pending')).toBe(true)
    clearErrors()
  })

  it('0 筆待確認時沒有「選取」鈕', async () => {
    const pending = await open()

    expect(pending.findAll('button').map((b) => b.text())).not.toContain('選取')
  })
})
