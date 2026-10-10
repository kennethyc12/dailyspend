import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Photo } from '@/models/types'
import { IndexedDbAdapter, seed } from '@/storage'
import { seedBuiltinRules } from '@/services/ruleService'
import { createFromText } from '@/services/entryService'
import { deleteSample, listSamples, saveSample } from '../sampleService'

const NOW = 1_760_000_000_000
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

let storage: IndexedDbAdapter

function photo(id: string, capturedAt = NOW): Photo {
  return {
    id,
    blob: new Blob([BYTES], { type: 'image/jpeg' }),
    thumbBlob: new Blob([BYTES.slice(0, 2)], { type: 'image/jpeg' }),
    width: 1600,
    height: 1200,
    bytes: BYTES.length,
    capturedAt,
  }
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  storage = new IndexedDbAdapter()
  await seed(storage)
  await seedBuiltinRules(storage, NOW)
})

describe('發票樣本', () => {
  it('只存照片不會建立紀錄', async () => {
    await saveSample(storage, photo('p1'))

    expect(await storage.count('photos')).toBe(1)
    expect(await storage.count('records')).toBe(0)
    expect((await listSamples(storage)).map((p) => p.id)).toEqual(['p1'])
  })

  it('新的排前面', async () => {
    await saveSample(storage, photo('old', NOW - 1000))
    await saveSample(storage, photo('new', NOW))

    expect((await listSamples(storage)).map((p) => p.id)).toEqual(['new', 'old'])
  })

  it('附在紀錄上的照片不算樣本', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW, photo('attached'))
    await saveSample(storage, photo('loose'))

    expect((await listSamples(storage)).map((p) => p.id)).toEqual(['loose'])
  })

  it('刪除樣本只動 photos', async () => {
    await createFromText(storage, '全家 咖啡 55', NOW, photo('attached'))
    await saveSample(storage, photo('loose'))

    await deleteSample(storage, 'loose')

    expect(await listSamples(storage)).toEqual([])
    expect(await storage.count('records')).toBe(1)
    expect(await storage.get<Photo>('photos', 'attached')).toBeDefined()
  })
})
