export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * iOS standalone 下 `<a download>` 不可靠（可能無聲失敗或開出空白頁），
 * 所以優先走 Web Share，讓使用者存到「檔案」App 或 iCloud Drive。
 *
 * `navigator.share` 必須在使用者手勢的同步呼叫鏈內觸發，因此 `file`
 * 要在按下按鈕之前就備好，不能在這個函式裡才去組。
 */
export async function saveFile(file: File): Promise<SaveOutcome> {
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled'
      // 其他錯誤（權限、不支援）退回下載，不讓使用者拿不到檔案。
    }
  }
  return download(file)
}

function download(file: File): SaveOutcome {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻 revoke 會讓某些瀏覽器來不及下載。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

export function dateStamp(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function csvFileName(now = new Date()): string {
  return `dailyspend-${dateStamp(now)}.csv`
}

export function backupFileName(now = new Date()): string {
  return `dailyspend-backup-${dateStamp(now)}.zip`
}
