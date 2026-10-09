import type { Photo } from '@/models/types'

export interface CompressOptions {
  maxEdge: number
  thumbEdge: number
  quality: number
}

export interface Dimensions {
  width: number
  height: number
}

/** 等比縮到長邊不超過 maxEdge。原本就比較小時不放大。 */
export function fitWithin(width: number, height: number, maxEdge: number): Dimensions {
  const longest = Math.max(width, height)
  if (longest <= maxEdge || longest === 0) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function toJpeg(
  source: ImageBitmap,
  { width, height }: Dimensions,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('無法取得繪圖內容')
    ctx.drawImage(source, 0, 0, width, height)
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('無法取得繪圖內容')
  ctx.drawImage(source, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('影像壓縮失敗'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * 壓縮一張照片，產出原圖與縮圖。
 *
 * 這是耗時的前處理，**必須在開 transaction 之前完成**（§2.2）。
 *
 * `imageOrientation: 'from-image'` 不能省：iPhone 拍的照片方向放在 EXIF 裡，
 * 不套用的話存進去的圖會是躺著的。
 */
export async function compressPhoto(
  file: Blob,
  opts: CompressOptions,
  now = Date.now(),
): Promise<Photo> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const full = fitWithin(bitmap.width, bitmap.height, opts.maxEdge)
    const thumb = fitWithin(bitmap.width, bitmap.height, opts.thumbEdge)

    const [blob, thumbBlob] = await Promise.all([
      toJpeg(bitmap, full, opts.quality),
      toJpeg(bitmap, thumb, opts.quality),
    ])

    return {
      id: crypto.randomUUID(),
      blob,
      thumbBlob,
      width: full.width,
      height: full.height,
      bytes: blob.size,
      capturedAt: now,
    }
  } finally {
    bitmap.close()
  }
}
