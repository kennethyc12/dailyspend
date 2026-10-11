<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { Photo } from '@/models/types'
import { getStorage } from '@/storage'
import { initStorage } from '@/composables/useStorageStatus'
import { usePhotoPicker } from '@/composables/usePhotoPicker'
import { listSamples } from '@/services/sampleService'
import { compressPhoto } from '@/photo/compress'
import {
  decodeBig5,
  detectQrCodes,
  toHex,
  warmUp,
  type DetectResult,
} from '@/recognize/qrDetect'

interface VariantResult {
  label: string
  bytes: number
  detect: DetectResult
}

const storage = getStorage()
const picker = usePhotoPicker()

const samples = shallowRef<Photo[]>([])
const sampleUrls = ref<Record<string, string>>({})
const selectedId = ref<string | null>(null)
const source = shallowRef<Blob | null>(null)
// 樣本與現拍都已經過 compressPhoto，這裡拿不到相機原圖，標題要說實話。
const sourceLabel = ref('已壓縮版')

const running = ref(false)
const progress = ref<string | null>(null)
const wasmMs = ref<number | null>(null)
const results = shallowRef<VariantResult[]>([])
const errorMsg = ref<string | null>(null)
const openPayload = ref<string | null>(null)

// 原檔之外再壓三組，用來回答「1600 / q0.8 解不解得動」（design.md §5.2.1）。
const PRESETS = [
  { label: '1600px / q0.8（現行預設）', maxEdge: 1600, quality: 0.8 },
  { label: '1600px / q0.6', maxEdge: 1600, quality: 0.6 },
  { label: '1200px / q0.8', maxEdge: 1200, quality: 0.8 },
]

function revokeUrls() {
  for (const url of Object.values(sampleUrls.value)) URL.revokeObjectURL(url)
  sampleUrls.value = {}
}

async function loadSamples() {
  const list = await listSamples(storage)
  revokeUrls()
  samples.value = list
  sampleUrls.value = Object.fromEntries(list.map((p) => [p.id, URL.createObjectURL(p.thumbBlob)]))
}

onMounted(async () => {
  await initStorage()
  await loadSamples()
})

onUnmounted(revokeUrls)

function selectSample(p: Photo) {
  selectedId.value = p.id
  source.value = p.blob
  sourceLabel.value = `樣本存檔版（${p.width}×${p.height}）`
  picker.clear()
  results.value = []
}

async function pickNew(event: Event) {
  const photo = await picker.pick(event)
  if (!photo) return
  selectedId.value = null
  source.value = photo.blob
  sourceLabel.value = `現選的照片（${photo.width}×${photo.height}）`
  results.value = []
}

async function run() {
  const blob = source.value
  if (!blob || running.value) return

  running.value = true
  errorMsg.value = null
  results.value = []

  try {
    progress.value = '載入 wasm…'
    wasmMs.value = await warmUp()

    const out: VariantResult[] = []
    progress.value = '原檔…'
    out.push({ label: sourceLabel.value, bytes: blob.size, detect: await detectQrCodes(blob) })

    for (const preset of PRESETS) {
      progress.value = `${preset.label}…`
      const recompressed = await compressPhoto(blob, {
        maxEdge: preset.maxEdge,
        thumbEdge: 320,
        quality: preset.quality,
      })
      out.push({
        label: preset.label,
        bytes: recompressed.blob.size,
        detect: await detectQrCodes(recompressed.blob),
      })
    }

    results.value = out
  } catch (err) {
    errorMsg.value = (err as Error).message
  } finally {
    running.value = false
    progress.value = null
  }
}

function kb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`
}

function ms(value: number) {
  return `${Math.round(value)} ms`
}

function payloads(r: VariantResult) {
  return r.detect.codes.map((code) => ({
    text: code.text,
    byteLength: code.bytes.length,
    hex: toHex(code.bytes),
    big5: decodeBig5(code.bytes),
    rotation: code.rotation,
  }))
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    progress.value = '已複製'
    setTimeout(() => (progress.value = null), 1500)
  } catch (err) {
    errorMsg.value = `複製失敗：${(err as Error).message}`
  }
}
</script>

<template>
  <main class="page">
    <h1>QR 實驗室</h1>
    <p class="hint">
      同一張照片用四種壓縮設定各解一次，看解到幾個碼、耗時多少，並把 payload 原封不動
      列出來。選型已定案為 zxing-wasm（design.md §5.2）；這一頁留著，是因為欄位切法
      要靠真實 payload 決定。
    </p>

    <section class="panel">
      <h2>選一張照片</h2>
      <p v-if="samples.length === 0" class="hint">
        還沒有樣本。先到「記一筆」拍發票並按「只存成樣本」，或直接在這裡選一張。
      </p>
      <ul v-else class="thumbs">
        <li v-for="p in samples" :key="p.id">
          <button
            class="thumb"
            :class="{ on: selectedId === p.id }"
            @click="selectSample(p)"
          >
            <img :src="sampleUrls[p.id]" alt="樣本縮圖" />
            <span class="sub">{{ p.width }}×{{ p.height }} · {{ kb(p.bytes) }}</span>
          </button>
        </li>
      </ul>

      <div class="pick-actions" :class="{ off: running || picker.working.value }">
        <label class="btn-text">
          📷 拍照
          <input type="file" accept="image/*" capture="environment" @change="pickNew" />
        </label>
        <label class="btn-text">
          🖼 從相簿選
          <input type="file" accept="image/*" @change="pickNew" />
        </label>
      </div>

      <div v-if="picker.previewUrl.value" class="preview">
        <img :src="picker.previewUrl.value" alt="待測照片" />
      </div>
      <p v-if="picker.error.value" class="result warn">{{ picker.error.value }}</p>

      <button class="btn-primary" :disabled="!source || running" @click="run">
        {{ running ? (progress ?? '測試中…') : '跑選型測試' }}
      </button>
    </section>

    <p v-if="errorMsg" class="result warn">{{ errorMsg }}</p>
    <p v-else-if="progress && !running" class="result ok">{{ progress }}</p>

    <template v-if="results.length">
      <section class="panel">
        <h2>結果</h2>
        <p class="hint">wasm 載入（含首次解碼）：{{ wasmMs === null ? '—' : ms(wasmMs) }}</p>
        <table>
          <thead>
            <tr>
              <th>壓縮設定</th>
              <th>大小</th>
              <th>解到幾個</th>
              <th>耗時</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in results" :key="r.label">
              <td>{{ r.label }}</td>
              <td>{{ kb(r.bytes) }}</td>
              <td :class="r.detect.codes.length >= 2 ? 'ok' : 'warn'">
                {{ r.detect.codes.length }} 個
                <template v-if="r.detect.error"><br />{{ r.detect.error }}</template>
              </td>
              <td>{{ ms(r.detect.ms) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint">
          一張發票是左右兩個 QR，所以「2 個」才是完整解到。耗時含 JPEG 解圖——
          zxing 吃 Blob，在 wasm 內自己解圖。
          第一列不是相機原圖：樣本存進資料庫前就已經壓過一次（§5.2.1）。
        </p>
      </section>

      <section v-for="r in results" :key="`${r.label}-payload`" class="panel">
        <h2>{{ r.label }} · 解到的內容</h2>
        <p v-if="payloads(r).length === 0" class="hint">沒有解到任何碼。</p>
        <div v-for="p in payloads(r)" :key="p.text" class="payload">
          <div class="row sub">
            <span>{{ p.byteLength }} bytes · 旋轉 {{ p.rotation }}°</span>
            <button class="btn-text" @click="copy(p.text)">複製</button>
          </div>
          <pre>{{ p.text }}</pre>
          <button class="btn-text" @click="openPayload = openPayload === p.text ? null : p.text">
            {{ openPayload === p.text ? '收起' : '原始位元組' }}
          </button>
          <template v-if="openPayload === p.text">
            <pre class="hex">{{ p.hex }}</pre>
            <p class="sub">Big5 解讀：</p>
            <pre>{{ p.big5 ?? '（這個瀏覽器的 TextDecoder 沒有 big5）' }}</pre>
          </template>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  list-style: none;
  margin-bottom: var(--space-3);
}

.thumb {
  display: block;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-dim);
}

.thumb img {
  display: block;
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: var(--radius);
  border: 2px solid var(--c-border);
}

.thumb.on img {
  border-color: var(--c-accent);
}

.pick-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.pick-actions input {
  display: none;
}

.pick-actions label {
  cursor: pointer;
}

.pick-actions.off {
  opacity: 0.45;
  pointer-events: none;
}

.preview {
  margin-bottom: var(--space-3);
  text-align: center;
}

.preview img {
  max-width: 100%;
  max-height: 200px;
  border-radius: var(--radius);
  border: 1px solid var(--c-border);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: var(--space-2) var(--space-2);
  border-bottom: 1px solid var(--c-border);
  text-align: left;
  vertical-align: top;
}

.payload {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--c-border);
}

.payload:first-of-type {
  border-top: none;
}

pre {
  margin: var(--space-2) 0;
  padding: var(--space-2);
  border-radius: var(--radius);
  background: var(--c-bg);
  font-size: 12px;
  /* 發票 payload 很長且沒有空白，不折行會把表格撐爆。 */
  white-space: pre-wrap;
  word-break: break-all;
}

.hex {
  color: var(--c-text-dim);
}

.row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.sub {
  font-size: 13px;
  color: var(--c-text-dim);
}
</style>
