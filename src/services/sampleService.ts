import type { Photo, SpendRecord } from '@/models/types'
import type { StoragePort } from '@/storage'

/**
 * 發票樣本：只存照片、不建紀錄，給 Phase 9 的 QR 選型當素材。
 *
 * 沒有任何紀錄引用的照片就是樣本。不另外加旗標是因為 `removePhoto` 與
 * `deleteRecord` 都會連帶刪掉照片，所以孤兒照片只會從這條路徑產生；
 * 樣本之後被附到紀錄上也會自動從清單消失。
 */
export async function saveSample(storage: StoragePort, photo: Photo): Promise<Photo> {
  await storage.put('photos', photo)
  return photo
}

export async function listSamples(storage: StoragePort): Promise<Photo[]> {
  const [photos, records] = await Promise.all([
    storage.getAll<Photo>('photos'),
    storage.getAll<SpendRecord>('records'),
  ])
  const owned = new Set(
    records.map((r) => r.photoId).filter((id): id is string => id !== null),
  )
  return photos.filter((p) => !owned.has(p.id)).sort((a, b) => b.capturedAt - a.capturedAt)
}

export function deleteSample(storage: StoragePort, id: string): Promise<void> {
  return storage.delete('photos', id)
}
