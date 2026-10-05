# DailySpend 設計文件 v0.2

> 狀態：設計審查第二輪已套用，尚未動工。
> 技術選型已定：Vue 3 PWA + IndexedDB，**目標平台 iPhone（iOS Safari，standalone 模式）**。
> 待補輸入：發票 QR 原始文字樣本、載具明細樣本（缺樣本前不撰寫解析欄位邏輯）。
>
> v0.2 修訂摘要見 §15。

---

## 1. 範圍

| 項目 | 本期 | 範圍外（需先詢問） |
|---|---|---|
| 使用者 | 單人 | 多人共享 |
| 幣別 | TWD | 多幣別 |
| 輸入 | 手動快速輸入、發票照片 | 銀行串接 |
| 辨識 | 台灣電子發票 QR code | OCR |
| 分類 | 規則比對 | AI 推論 |
| 匯入 | 無（預留介面） | 載具匯入 |
| 儲存 | 本機 IndexedDB | 雲端同步 |

個資原則：發票號碼、載具號碼、照片一律只存本機，不經任何外部服務。

---

## 2. 分層架構

```
┌─────────────────────────────────────────┐
│ UI (Vue 3 components / views)           │
│  安裝引導 · 快速輸入 · 待確認 · 列表      │
│  分析 · 規則管理 · 設定/備份              │
└───────────────┬─────────────────────────┘
                │ 只呼叫 use* composables，不碰 adapter
┌───────────────▼─────────────────────────┐
│ Application (composables / services)    │
│  recordService · classifyService         │
│  dedupeService · analysisService         │
│  backupService                           │
└───┬──────────┬──────────┬───────────────┘
    │          │          │   依賴的是 interface，不是實作
┌───▼────┐ ┌───▼──────┐ ┌─▼───────────┐
│Storage │ │Recognizer│ │ Classifier  │
│Port    │ │Port      │ │ Port        │
├────────┤ ├──────────┤ ├─────────────┤
│IndexedDB│ │QrRecognizer│ │RuleClassifier│
│(v1)    │ │(v1)      │ │(v1)         │
│  …SQLite│ │ …OcrRecognizer│ │ …AiClassifier│
└────────┘ └──────────┘ └─────────────┘
```

**Port（介面）= 穩定契約，Adapter（實作）= 可替換。**

### 2.1 StoragePort

**規則：port 的簽章不得出現任何 IndexedDB 專屬型別**（`IDBKeyRange`、`IDBTransaction`、`IDBValidKey`…）。範圍查詢與交易都用自定義型別，由 adapter 負責轉換。這是「儲存可替換」承諾的實際驗收點。

```ts
type StoreKey = string | number

interface KeyRange<K extends StoreKey = StoreKey> {
  gte?: K
  gt?: K
  lte?: K
  lt?: K
  eq?: K
}

interface QueryOptions {
  direction?: 'asc' | 'desc'
  limit?: number
}

interface Tx {                       // 自定義，非 IDBTransaction
  put<T>(store: StoreName, value: T): Promise<StoreKey>
  get<T>(store: StoreName, id: StoreKey): Promise<T | undefined>
  getByIndex<T>(store: StoreName, index: string, key: StoreKey): Promise<T | undefined>
  delete(store: StoreName, id: StoreKey): Promise<void>
}

interface StoragePort {
  put<T>(store: StoreName, value: T): Promise<StoreKey>
  get<T>(store: StoreName, id: StoreKey): Promise<T | undefined>
  query<T>(store: StoreName, index: string, range: KeyRange, opts?: QueryOptions): Promise<T[]>
  delete(store: StoreName, id: StoreKey): Promise<void>
  transaction<T>(stores: StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T>
  estimateUsage(): Promise<{ usage: number; quota: number }>
  requestPersist(): Promise<boolean>
}
```

`IndexedDbAdapter` 內部把 `KeyRange` 轉成 `IDBKeyRange`（`gte`+`lte` → `bound`、僅 `gte` → `lowerBound`、以此類推）。未來的 `SqliteAdapter` 把同一個 `KeyRange` 轉成 `WHERE` 子句，service 層完全不動。

### 2.2 Transaction 使用規則（IndexedDB 自動 commit 限制）

IndexedDB 的 transaction 只在「微任務佇列中持續有 IDB 請求」時存活。一旦在 `fn` 裡 `await` 了**非 IDB 的 Promise**（canvas 壓縮、`crypto.subtle`、`fetch`、`setTimeout`），transaction 會提前 commit，之後的寫入直接丟 `TransactionInactiveError`。

**硬性規則，寫進 code review checklist：**

```
transaction(fn) 的 fn 內部：
  ✅ 只能 await StoragePort / Tx 的方法
  ❌ 不得 await 影像壓縮、QR 解析、分類、雜湊、網路、計時器
```

所有前處理（壓縮縮圖、QR 解析、分類、去重判斷用的查詢）**必須在開 transaction 之前全部完成**，transaction 內只做最後的純讀寫。

寫入一筆含照片的紀錄，正確順序：

```
1. 壓縮照片 → { blob, thumbBlob }        ← transaction 外
2. QR 解析 → RecognitionResult            ← transaction 外
3. 分類 → categoryId / classifyConfidence ← transaction 外
4. 查既有同 invoiceKey 紀錄               ← 獨立的唯讀 transaction
5. 算出最終要寫的 record 物件（含 merge） ← 純函式，transaction 外
6. transaction(['records','photos'], tx => {
       await tx.put('photos', photo)
       await tx.put('records', record)
   })                                     ← 只有這裡寫
```

第 4 步與第 6 步之間理論上有 race，但本 App 單人單分頁，且 `by_invoiceKey` 是 unique index，衝突時 adapter 會拋 `ConstraintError`，service 捕捉後轉為 `duplicate_conflict` 並重跑 merge。

### 2.3 RecognizerPort / ClassifierPort

```ts
interface RecognitionResult {
  fields: Partial<RecognizedFields>
  recognizeConfidence: number        // 0–1
  raw: unknown
  errors: RecognitionError[]
}

interface RecognizerPort {
  readonly kind: 'qr' | 'ocr'
  recognize(input: Blob | string): Promise<RecognitionResult>
}

interface ClassifyOutput {
  categoryId: string | null
  itemCategoryIds: (string | null)[]
  classifyConfidence: number         // 0–1
  source: 'rule' | 'ai'
  matchedRuleIds: string[]
}

interface ClassifierPort {
  readonly source: 'rule' | 'ai'
  classify(input: ClassifyInput): Promise<ClassifyOutput>
}
```

兩種 confidence 刻意用不同名稱（`recognizeConfidence` / `classifyConfidence`），避免在 record 上混淆。

多個 recognizer 可串接（QR 先跑，未來 OCR 補缺欄位），service 層以 chain 呼叫，合併時「先到且 `recognizeConfidence` 較高者勝」。

---

## 3. 資料模型

IndexedDB database `dailyspend`，schema version 1。

### 3.1 `records` — 消費紀錄（主表）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | `crypto.randomUUID()`，非自增。自增 key 在備份合併與日後同步時會撞號 |
| `date` | string `YYYY-MM-DD` | 預設今天；QR 有值則覆蓋 |
| `merchant` | string | 店家 |
| `amount` | number | **整數，單位元。禁止浮點數**，寫入前 `Number.isInteger` 斷言 |
| `items` | `RecordItem[]` | 見 3.2，可為空陣列 |
| `categoryId` | string \| null | null 代表待確認 |
| `categorySource` | `'rule' \| 'user' \| 'ai'` | 分類來源 |
| `classifyConfidence` | number | 0–1，分類信心（v0.1 名為 `confidence`） |
| `recognizeConfidence` | number \| null | 0–1，辨識信心，無照片為 null |
| `status` | `'confirmed' \| 'pending'` | pending 進待確認佇列 |
| `pendingReasons` | `PendingReason[]` | **陣列**，可同時成立多個原因 |
| `invoiceNumber` | string \| null | `AB12345678`，10 碼 |
| `invoicePeriod` | string \| null | 發票年期，民國年+期別起始月，如 `11509` |
| `invoiceKey` | string \| null | **去重鍵**，`${invoicePeriod}-${invoiceNumber}`，見 §7 |
| `invoiceRandomCode` | string \| null | QR 內隨機碼 |
| `sourceType` | `'manual' \| 'photo' \| 'carrier'` | carrier 預留 |
| `photoId` | string \| null | → `photos.id` |
| `rawRecognition` | object \| null | 原始解析結果，debug 與回測用 |
| `note` | string | |
| `createdAt` | number | epoch ms |
| `updatedAt` | number | epoch ms，**每次寫入必更新**。備份合併與日後同步靠它判斷新舊 |

Index：`by_date`、`by_invoiceKey`（unique sparse）、`by_categoryId`、`by_merchant`、`by_status`、`by_updatedAt`。

**`by_yearMonth` 已移除。** 月份查詢用 `by_date` 的字串範圍即可：

```ts
query('records', 'by_date', { gte: '2026-10-01', lte: '2026-10-31' })
```

少一個衍生欄位就少一個不同步的可能。

**`by_invoiceKey` 的 sparse 行為**：依 IndexedDB 規格，`null` 不是合法 key，該筆不會進索引，因此多筆 `invoiceKey: null` 不會違反 unique 約束。邏輯正確，但**必須在 Phase 2 寫一個明確的測試驗證**（連續寫入 3 筆 `invoiceKey: null` 不應報錯），不靠假設。

### 3.2 `RecordItem`（內嵌，不獨立 store）

| 欄位 | 型別 |
|---|---|
| `name` | string |
| `qty` | number（預設 1） |
| `unitPrice` | number \| null（整數元） |
| `amount` | number \| null（整數元） |
| `categoryId` | string \| null（品項層級分類，供「同類重複購買」分析） |

> 不獨立成 store 的理由：品項永遠依附於一筆消費，沒有跨紀錄查單一品項的需求；分析需要的聚合用 in-memory map 算即可（單人資料量級 < 10 萬筆）。日後若要全文檢索品項再拆。

### 3.3 `categories` — 類別

| 欄位 | 型別 |
|---|---|
| `id` | string |
| `name` | string |
| `parentId` | string \| null（一層子類別即可） |
| `icon` / `color` | string |
| `isBuiltin` | boolean（內建不可刪，只能停用） |
| `isActive` | boolean |
| `sortOrder` | number |
| `updatedAt` | number |

**預設清單（v0.2）**：飲食、飲料、交通、居家、日用品、娛樂、訂閱、醫療、教育、服飾、人情往來、其他。

> **「超商」已移除。** 它是店家類型而非消費類別，在品項優先的設計下會和「飲料」「飲食」重疊：全家買的咖啡該進哪一類會變得沒有確定答案。

**超商不設 merchant fallback 規則（v0.2 定案）。** 7-11、全家、萊爾富等橫跨飲料 / 飲食 / 日用品，內建規則不替它們猜類別——沒有品項時直接 `pending(ambiguous_merchant)`。

理由：給一個預設值（例如都算「日用品」）會讓「飲料」的月總額被系統性低估，而 §8 的建議排序完全靠這些金額，猜錯一次就污染所有分析。初期待確認筆數會偏多，但每修正一次就會透過 §6.2 建立一條 itemKeyword 規則（咖啡 → 飲料），待確認量會自己收斂。

**刪除類別的行為（v0.1 未定義）：**

| 類別種類 | 可否刪除 | 行為 |
|---|---|---|
| `isBuiltin: true` | 否 | 只能設 `isActive: false`，從選單隱藏，既有紀錄照常顯示 |
| 使用者自建，無紀錄引用 | 是 | 直接刪除 |
| 使用者自建，有紀錄引用 | 是，但需轉移 | 刪除前跳出對話框，強制選擇轉移目標類別；確認後在單一 transaction 內批次改寫 `records.categoryId` 與 `items[].categoryId`，並刪除指向它的 rules |

絕不留下指向已刪類別的孤兒 `categoryId`。

### 3.4 `rules` — 分類規則

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | uuid |
| `type` | `'itemKeyword' \| 'merchant'` | |
| `pattern` | string | 關鍵字或店家名 |
| `matchMode` | `'contains' \| 'exact' \| 'regex'` | 預設 contains |
| `categoryId` | string | |
| `priority` | number | 數字大者優先 |
| `origin` | `'builtin' \| 'userCorrection'` | 規則清單畫面可刪除 userCorrection |
| `hitCount` / `lastHitAt` | number | 顯示「這條規則用過幾次」 |
| `createdAt` / `updatedAt` | number | |

**優先序**

```
priority 基準值：
  itemKeyword + userCorrection : 400
  itemKeyword + builtin        : 300
  merchant    + userCorrection : 200
  merchant    + builtin        : 100
同層再比 pattern 長度（長者優先，較具體）→ 再比 createdAt（新者優先）
```

> **這組數字只在同類型規則互相衝突時起作用。** 「品項優先於店家」這件事是由 §6.1 的流程結構保證的（先跑完所有 itemKeyword，有結果就不看 merchant），不是靠數字大小。兩者不矛盾，但**不要誤以為把 merchant 的數字調到 500 就能讓店家優先**——流程根本不會走到那裡。要改變優先順序必須改 §6.1 的流程。

### 3.5 `photos` — 發票照片

| 欄位 | 型別 |
|---|---|
| `id` | string |
| `blob` | Blob（原圖，壓縮後存；長邊上限 1600px、JPEG q0.8） |
| `thumbBlob` | Blob（長邊 320px，列表用） |
| `width` / `height` / `bytes` | number |
| `capturedAt` | number |

> 存 Blob 而非 base64：IndexedDB 原生支援 Blob，省 33% 體積且不佔 JS heap。iOS Safari 的 Blob 寫入與讀回需在 Phase 2 於真機驗證一次（見 §13）。

### 3.6 `settings` — 單筆 key-value

```ts
{
  defaults: { date: 'today', categoryFallback: null, qty: 1 },
  parsing: { amountPosition: 'last', merchantDictEnabled: true },
  thresholds: { /* 見 §8 */ },
  confidence: { pendingBelow: 0.6 },
  export: { delimiter: ',', encoding: 'utf-8-bom' },
  backup: { remindAfterDays: 7, lastBackupAt: null },
  platform: { persistGranted: null }
}
```

所有預設值集中於此，UI 的「設定」頁直接編輯。

### 3.7 `PendingReason`

```ts
type PendingReason =
  | 'no_category_match'      // 沒有任何規則命中
  | 'ambiguous_merchant'     // 店家橫跨多類別且無品項
  | 'low_confidence'         // < settings.confidence.pendingBelow
  | 'recognition_failed'     // QR 解析失敗
  | 'amount_mismatch'        // 手輸金額 ≠ QR 金額
  | 'duplicate_conflict'     // 同 invoiceKey 但欄位衝突
  | 'ambiguous_item_tokens'  // 快速輸入中間出現純數字 token（§4.3）
  | 'multi_item_correction'  // 多品項被整筆改分類，需逐項確認（§6.2）
```

存成陣列，UI 把每個 reason 轉成一句人話並列出；不同 reason 對應不同的修正欄位聚焦。

---

## 4. 快速輸入切詞

目標：`全家 咖啡 55` → `{ merchant:'全家', items:[{name:'咖啡'}], amount:55 }`

### 4.1 規則（由後往前，確定性剖析，不猜）

1. **金額**：取字串中**最後一個**純數字 token（允許 `55`、`1,200`、`55元`、`$55`）。找不到 → 擋下，提示補金額（金額是唯一必填）。
2. **店家**：第一個 token。若命中店家字典（歷史紀錄 + 內建常見店家）則標記 `merchantMatched = true`。
3. **品項**：中間所有 token，以空白切，每個 token 一個 item；沒有中間 token → `items: []`。
4. **日期前綴**（選配）：首 token 符合 `今天 | 昨天 | M/D | MM-DD` 則吃掉作為日期，店家往後移一位。

### 4.2 範例回測表

| 輸入 | merchant | items | amount | 結果 |
|---|---|---|---|---|
| `全家 咖啡 55` | 全家 | [咖啡] | 55 | confirmed |
| `蝦皮 320` | 蝦皮 | [] | 320 | 可能 pending（店家橫跨多類別） |
| `昨天 全聯 蛋 雞胸 268` | 全聯 | [蛋, 雞胸] | 268 | confirmed |
| `星巴克 大杯拿鐵 150元` | 星巴克 | [大杯拿鐵] | 150 | confirmed |
| `55` | — | [] | 55 | pending（merchant 缺） |
| `全聯 咖啡 55 麵包 30` | 全聯 | [咖啡, 麵包] | 30 | **pending（`ambiguous_item_tokens`）** |

### 4.3 多品項金額：不處理，但不默默吃掉

v1 不剖析「品項與金額一一對應」。但**中間 token 出現純數字時，不得產生一個名叫「55」的品項**——那違反文件自己「不亂猜」的原則，而且會污染品項統計與規則學習。

```
剖析後，若 items 中任一 name 是純數字（或 數字+元/$）：
  → 把該 token 從 items 移除
  → status = 'pending'
  → pendingReasons += 'ambiguous_item_tokens'
  → UI 顯示原始輸入全文，讓使用者自行拆成品項與金額
```

這是低成本保護：10 行程式，換掉一整類難以察覺的髒資料。若日後實際使用頻率高，再評估「多品項模式」。

---

## 5. 辨識流程（QR）

**本節的欄位切法為架構佔位，待樣本確認後補。**

已知前提（需用樣本驗證，不預設）：
- 台灣電子發票列印時為**左右兩個 QR 並排**，左 QR 含發票號碼、日期、隨機碼、金額等固定長度欄位；品項明細（若有）放在右 QR 的延伸區。
- 品項能取到幾項、編碼方式（Base64 / UTF-8 / Big5）**必須由樣本決定**，不臆測。

### 5.1 不使用 BarcodeDetector

v0.1 寫的是「`BarcodeDetector` 原生 API，不支援時 fallback」。**v0.2 移除原生路徑**：目標平台是 iOS Safari，原生 `BarcodeDetector` 不支援，維護兩條路徑只會讓真正會跑的那條缺乏測試。v1 統一用單一 library。

### 5.2 Library 選型（待樣本驗證）

決定性條件是**能不能一次處理一張圖裡的兩個 QR**：

| 候選 | 多碼偵測 | 代價 |
|---|---|---|
| `jsQR` | 否，單張單碼 | 體積小，但必須自己把圖切左右半張分別解；切分點受拍攝角度與裁切影響，容易失敗 |
| `zxing-wasm` | 是，單張多碼 | 體積較大（wasm），但原生支援本情境 |

**初步傾向 `zxing-wasm`**，理由是「切左右半張」是我們自己引入的不確定性來源。但**不先定案**——樣本到手後用實際照片各測一次（成功率、耗時、不同拍攝角度）再決定，結果寫回本節。

### 5.3 流程

```
照片 Blob（來自 <input type="file" capture="environment">）
  → 壓縮 (createImageBitmap + OffscreenCanvas)
  → QR 多碼偵測 (single library)
  → 左右 QR payload 合併
  → parseEInvoicePayload(payload)   ← 待樣本
  → RecognitionResult { fields, recognizeConfidence, raw, errors }
```

以上全部在 transaction **之外**完成（§2.2）。

### 5.4 失敗處理

- 偵測不到 QR → `recognizeConfidence: 0`，`recognition_failed`，**照片仍保存**，使用者手動補欄位。
- 只偵測到一個 QR → 用左 QR 的欄位，品項留空，`recognition_failed` 不設，但 `classifyConfidence` 依無品項的路徑走。
- 解析部分成功 → 填入已知欄位，缺的留空，`status: 'pending'`。
- 手輸金額 ≠ QR 金額 → 兩個數字都顯示，`amount_mismatch`，預設採信 QR，使用者可改。

---

## 6. 分類與修正學習

### 6.1 RuleClassifier 流程

```
輸入 { merchant, items[] }
  1. 對每個 item.name 跑 itemKeyword 規則 → item.categoryId
  2. 對 merchant 跑 merchant 規則 → merchantCategoryId
  3. 決定 record.categoryId：
     - items 全部命中且同一類別       → 該類別, classifyConfidence 0.95
     - items 部分命中                 → 多數決類別, classifyConfidence 0.7
     - items 無命中但 merchant 命中單一類別 → 該類別, classifyConfidence 0.8
     - merchant 命中多類別且 items 為空 → null, pending(ambiguous_merchant)
     - 全無命中                       → null, pending(no_category_match)
  4. classifyConfidence < settings.confidence.pendingBelow → pending(low_confidence)
```

**步驟 1 先於步驟 2，且步驟 3 的順序本身就是「品項優先於店家」。** 見 §3.4 的註記。

### 6.2 修正即成規則（v0.2 修正：多品項不自動學習）

v0.1 寫「有品項 → 以最長的 item.name 建規則」有明確的教錯風險：一筆全聯紀錄 `[雞胸, 衛生紙]`，使用者把整筆改成「飲食」，系統會學到「衛生紙 → 飲食」，而且這條錯規則會一直生效到使用者自己發現。

**v0.2 規則：**

| 情境 | 行為 |
|---|---|
| `items.length === 0` | 建 merchant 規則 |
| `items.length === 1` | 建 itemKeyword 規則（pattern = 該品項名） |
| `items.length >= 2`，使用者只改**整筆**分類 | **不自動建 itemKeyword 規則**。UI 出現「要記住嗎？」面板，列出每個品項讓使用者逐項指定類別；每項指定才各建一條 itemKeyword 規則。使用者選「略過」→ 只建 merchant 規則，並記 `multi_item_correction` 供日後回看 |
| `items.length >= 2`，使用者改**單一品項**的分類 | 直接為該品項建 itemKeyword 規則 |

共同行為：
- `origin = 'userCorrection'`
- 已存在同 `pattern` + `type` 的規則 → 更新 `categoryId` 與 `updatedAt`，不新增
- 建立後 toast：「已記住：拿鐵 → 飲料（可在設定 › 規則中刪除）」+ undo

### 6.3 規則管理畫面

列出所有規則，可依 `type` / `origin` 篩選，顯示 `hitCount` 與 `lastHitAt`，支援刪除 userCorrection 規則與停用 builtin 規則。

刪除規則**不回溯**修改既有紀錄（避免歷史被改寫），僅影響日後分類。
> v2 可考慮在刪除對話框加一個**選用**的「一併套用到既有紀錄」按鈕，預設不勾。

### 6.4 AI 介面預留

`AiClassifier implements ClassifierPort`，v1 不註冊到 DI container。接上時 service 層策略：rule 先跑，`classifyConfidence < threshold` 才呼叫 AI；AI 結果寫入 `categorySource: 'ai'`。

---

## 7. 去重

### 7.1 去重鍵：`invoiceKey`，不是 `invoiceNumber`

台灣電子發票字軌**按期（兩個月）配發**，字軌字母會輪替重用，號碼本身不保證跨年度唯一。單用 `invoiceNumber` 當 unique index，跨年後可能把兩筆不同的消費誤判成同一張發票並合併——這是資料遺失，不是顯示錯誤。

```ts
invoicePeriod = `${rocYear}${periodStartMonth}`   // 民國年 + 期別起始月(兩位)
                                                   // 2026-10-05 → 民國115年, 09-10月期 → '11509'
invoiceKey = invoicePeriod && invoiceNumber
             ? `${invoicePeriod}-${invoiceNumber}` // '11509-AB12345678'
             : null
```

期別由 `date` 推導：`periodStartMonth = month % 2 === 0 ? month - 1 : month`（1–2月期=01、3–4月期=03…11–12月期=11）。

> `invoicePeriod` 與 `invoiceKey` 都是 derived，但**持久化存下來**（不每次重算），因為它是 unique index 的 key，必須與索引內容完全一致。寫入前由單一 `buildInvoiceKey()` 函式產生，是唯一的產生點。
>
> **這是 unique index，上線後改 key 必須做資料遷移，所以現在定案。** 若樣本顯示 QR 內另有更可靠的唯一識別（例如含年期的完整欄位），以樣本為準並回來改本節——但那也要在 Phase 2 之前。

邊界：`date` 缺失（純手輸 + 無 QR）時 `invoiceNumber` 通常也缺，`invoiceKey = null`，不參與去重。若有號碼無日期 → `invoiceKey = null` 且記 `pending`，讓使用者補日期。

### 7.2 寫入判斷

```
if (invoiceKey == null) → 直接新增
existing = getByIndex('records', 'by_invoiceKey', invoiceKey)
if (!existing) → 新增
else → merge(existing, incoming)
```

查詢與寫入分屬不同 transaction（§2.2）；unique index 的 `ConstraintError` 作為最後防線，捕捉後轉 `duplicate_conflict` 並重跑 merge。

### 7.3 merge 規則（欄位級，來源優先序 user > carrier > qr > manual）

| 欄位 | 策略 |
|---|---|
| `date` / `amount` / `invoiceNumber` | 取高優先來源；兩邊都有且不同 → 保留既有 + `pending(duplicate_conflict)`，UI 讓使用者選 |
| `items` | 取**項數較多**的那份；項數相同取高優先來源 |
| `categoryId` | 既有為 `user` 來源則不動；否則重跑分類 |
| `photoId` | 既有為 null 才填入；兩張照片都有 → 保留既有，新照片丟棄並提示 |
| `note` | 兩者串接 |
| `updatedAt` | 一律更新為 `Date.now()` |

載具匯入（日後）走同一條 merge 路徑，`sourceType: 'carrier'`，所以「匯入去重筆數為 0」由同一段程式保證。

---

## 8. 分析規則與門檻參數

全部存在 `settings.thresholds`，分析頁可即時調整並重算。每條結論**必須**附 `evidence: { recordIds: string[], itemNames?: string[] }`，UI 點擊可跳到該筆紀錄。

分析一律 **on-demand 計算**，不預先彙總；單人資料量不需要 materialized view。超過 5 萬筆再加月度彙總 store。

| 規則 | 判斷式 | 參數 | 預設 |
|---|---|---|---|
| **高頻小額** | 近 N 天內，單筆 ≤ A 元 且 同類別次數 ≥ C | `windowDays` `smallAmount` `minCount` | 30 / 150 / 8 |
| **訂閱與固定支出** | 見 8.2 | `minMonths` `amountVariancePct` `maxMonthlyOccurrences` | 3 / 10% / 2 |
| **月對月暴增** | 見 8.1 | `growthPct` `minDelta` `minDaysThisMonth` | 50% / 1000 / 7 |
| **同類重複購買** | 近 N 天內，相同品項名出現 ≥ K 次 | `windowDays` `minRepeat` `similarity` | 14 / 3 / `exact` |
| **可降低建議** | 見 8.3 | `topN` | **3** |

### 8.1 月對月暴增：比較區間定義

v0.1 只寫「本月 vs 上月」，在月中執行時必定失真——10 月 5 日拿 5 天比 9 月整月，永遠不會觸發。

**v0.2 定案：單一模式「本月至今 vs 上月同期」，不提供切換。**

```
今天 = YYYY-MM-D
本期 = 本月 1 日 ～ 本月 D 日
上期 = 上月 1 日 ～ 上月 D 日
```

邊界：上月天數不足 D（3/31 比 2 月）時取上月最後一天，並在結論文字標註「比較區間已對齊至 2/28」。

結論文字一律寫出實際比較區間（「10/1–10/5 vs 9/1–9/5，飲料 +62%」），不讓使用者自己猜。副作用是數字每天都會變動——這是刻意接受的代價，換取月中就能看到趨勢。

當月資料天數 < `minDaysThisMonth` (7) 時不輸出此規則的結論（樣本太少，噪音大於訊號），改顯示冷啟動提示（§8.4）。

### 8.2 訂閱偵測：排除高頻店家

v0.1 的條件（同店家、連續 M 月、金額變異 ≤ V%）會把「每天去、金額都是 65 元的早餐店」判成訂閱。

**v0.2 加入次數上限：**

```
判定為訂閱，需同時滿足：
  1. 同店家連續出現 ≥ minMonths (3) 個月
  2. 每個月的出現次數在 1 ～ maxMonthlyOccurrences (2) 之間
  3. 月金額變異係數 ≤ amountVariancePct (10%)
```

條件 2 是關鍵：訂閱的特徵是「每月固定少數幾次」，不是「金額穩定」。常去的早餐店會被條件 2 擋掉，並改由「高頻小額」規則命中——那才是它該被歸類的地方。

**已知限制（規則型系統的本質，寫進文件而非試圖解決）：** 手動輸入的店家名稱不一致會讓訂閱偵測漏抓——`Netflix` / `網飛` / `netflix` 會被當成三個店家。v1 只做大小寫與全半形正規化，不做同義詞合併。UI 在設定頁提供「店家名稱合併」工具（手動把多個名稱指向同一個正規名稱）列為 v2；在那之前，分析頁顯示一行提示：「店家名稱不一致會影響訂閱偵測，建議輸入時使用固定寫法」。

### 8.3 可降低建議：統一為「每月等值金額」

v0.1 說「依金額影響排序」但沒定義單位，導致高頻小額的月總額與訂閱的單筆金額無法比較。

**所有命中項一律換算為 `monthlyEquivalent`（每月等值金額，整數元）：**

| 規則 | 換算方式 |
|---|---|
| 高頻小額 | 視窗內總額 ÷ `windowDays` × 30 |
| 訂閱與固定支出 | 最近 `minMonths` 個月的月平均金額 |
| 月對月暴增 | 本期相對上期的**增額**，按 §8.1 的區間長度換算為 30 天 |
| 同類重複購買 | 視窗內該品項總額 ÷ `windowDays` × 30 |

依 `monthlyEquivalent` 由大到小排序，取前 `topN`（3）條。每條都顯示「每月約 ○○○ 元」，讓不同性質的支出可以直接比較。

### 8.4 冷啟動：資料不足時顯示還差多少，不顯示空白

每條規則有最低資料需求，不滿足時不輸出結論，改輸出一個 `insufficientData` 項目：

| 規則 | 最低資料需求 | 不足時顯示 |
|---|---|---|
| 高頻小額 | `windowDays` 內 ≥ 10 筆紀錄 | 「再記 N 筆就能分析高頻小額」 |
| 訂閱與固定支出 | 最早紀錄距今 ≥ `minMonths` 個月 | 「還需 N 天資料才能偵測訂閱」 |
| 月對月暴增 | 本月 ≥ 7 天資料 且 上月有紀錄 | 「下個月開始可比較」或「本月還需 N 天資料」 |
| 同類重複購買 | `windowDays` 內 ≥ 5 筆紀錄 | 「再記 N 筆就能分析重複購買」 |

分析頁永遠有內容，不會在前三個月呈現一片空白讓人以為壞了。

---

## 9. 資料流程

```
            ┌──────────────┐
輸入文字 ───►│ parseQuickInput│──► 純數字 token? ──► pending(ambiguous_item_tokens)
            └───────┬──────┘
拍照 Blob ──►┌──────▼───────┐
            │ RecognizerChain│ (qr → 未來 ocr)
            └───────┬──────┘
                    ▼
            ┌──────────────┐
            │  mergeFields  │ 手輸 vs 辨識，衝突記 pendingReason
            └───────┬──────┘
                    ▼
            ┌──────────────┐
            │  Classifier   │ → categoryId / classifyConfidence / source
            └───────┬──────┘
                    ▼
            ┌──────────────┐
            │ buildInvoiceKey│ period + number
            └───────┬──────┘
                    ▼
            ┌──────────────┐
            │    Dedupe     │ by invoiceKey → merge or insert（唯讀查詢）
            └───────┬──────┘
                    ▼
         classifyConfidence OK? ──No──► status='pending' ──► 待確認佇列
                    │Yes                                        │
                    ▼                                  使用者修正 ──► 寫回規則(§6.2)
            status='confirmed'                                   │
                    └──────────────┬──────────────────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │ transaction(['records','photos']) │ ← 只做讀寫，§2.2
                    └──────────────────────────────┘
```

**虛線以上全部在 transaction 之外。** 照片與紀錄的實際寫入在同一個 transaction 內，避免孤兒照片。

---

## 10. 待確認佇列

獨立頁面（底部 tab 顯示紅點數字），每張卡片：
- 原始輸入全文 / 照片縮圖
- 系統猜測的欄位（可直接編輯）
- `pendingReasons` **全部**轉成人話逐條列出（不只顯示第一個）
- 「確認」「確認並記住規則」「刪除」三個動作
- 多品項改分類時，展開 §6.2 的逐項指定面板

設計原則：**不亂猜**。寧可留空讓使用者填，也不填一個似是而非的類別或一個叫「55」的品項。

---

## 11. 匯出與備份

在 iOS 上這不是加分功能，是**資料安全機制**（見 §13.2）。

| 功能 | 格式 | 內容 |
|---|---|---|
| CSV 匯出 | UTF-8 with BOM（Excel 相容） | 一筆紀錄一列，items 以 `;` 串接；可選日期區間 |
| 完整備份 | `.zip`（JSON + 照片） | records + categories + rules + settings + photos |
| 還原 | 讀 zip | **覆寫操作，需二次確認**，並先自動匯出一份當前備份 |

CSV 欄位順序：
`date, merchant, items, amount, category, categorySource, classifyConfidence, status, invoiceKey, note`

### 11.1 匯出管道：Web Share API 優先

iOS standalone 模式下 `<a download>` 行為不可靠（可能無聲失敗或在 App 內開啟空白頁）。

```
if (navigator.canShare?.({ files: [file] }))
    → navigator.share({ files: [file], title: '...' })   // 使用者可存到「檔案」/ iCloud Drive
else
    → <a download> fallback
```

`navigator.share` 必須在**使用者手勢的同步呼叫鏈內**觸發，所以檔案要在按鈕點擊前就準備好，或以 `share(Promise)` 形式處理——這點在 Phase 6 真機驗證。

### 11.2 備份提醒

- 首次啟動呼叫 `navigator.storage.persist()`，結果存入 `settings.platform.persistGranted`，並顯示在設定頁（讓使用者知道自己的資料處於什麼保護等級）
- `Date.now() - settings.backup.lastBackupAt > settings.backup.remindAfterDays (7) × 86400000` → 首頁顯示提醒橫幅，可一鍵匯出
- 從未備份過且紀錄數 ≥ 20 → 同樣顯示

---

## 12. 待決事項

| # | 項目 | 狀態 | 需要 |
|---|---|---|---|
| 1 | 發票 QR 樣本（實拍照片 3–5 張 + 去識別化原始文字） | **待補，死線 Phase 9** | 阻擋 §5 解析邏輯與 §5.2 library 選型 |
| 2 | 載具明細樣本一份 | **待補，無死線** | 阻擋日後匯入的欄位對應（本期範圍外） |
| 3 | 主力手機系統 | **已決：iPhone（iOS Safari）** | — 見 §13 |
| 4 | 準確率驗收門檻 | **已決** | 見下 |
| 5 | 預設類別清單 | **已決**：移除「超商」且不設 fallback，見 §3.3 | — |
| 6 | §8.1 比較區間 | **已決**：單一模式「本月至今 vs 上月同期」 | — |
| 7 | §13.1 安裝強制 | **已決**：非 standalone 完全擋住，只顯示安裝引導 | — |
| 8 | §6.2 多品項「略過」 | **已決**：只建 merchant 規則 | — |

### #1 樣本可以延後到 Phase 9（已決）

Phase 1–8 不受影響：這段期間所有紀錄都來自手動輸入，`invoiceNumber` 恆為 `null`，`invoiceKey` 也恆為 `null`。因此「unique index 上線後改 key 要做資料遷移」的風險在 Phase 9 之前**不存在**——沒有任何一筆資料帶 key，改格式只是改 `buildInvoiceKey()` 加 schema version bump。Phase 5 的 dedupe 測試用手捏 fixture 即可。

**兩種樣本用途不同，不能互相取代：**

| 樣本 | 用途 |
|---|---|
| 實拍照片 3–5 張（不同角度、光線） | §5.2 library 選型，測「單張圖兩個 QR」的偵測成功率與耗時 |
| QR 原始文字（去識別化） | §5 欄位切法、品項編碼與取得率、§7.1 `invoiceKey` 最終確認 |

建議在 Phase 7（開始每日真實記帳）期間順手蒐集，拿到紙本發票就拍一張存起來。

### #4 驗收門檻（已決）

| 對象 | N | X | 理由 |
|---|---|---|---|
| 快速輸入剖析器 | 20 筆代表性輸入 | ≥ 95% | 自然語言輸入有邊界情境，容許少量失敗（且失敗會進 pending，不會產生錯資料） |
| QR 解析（發票號碼 / 日期 / 金額） | 20 張真實發票 | **100%** | QR 是確定性格式，解錯就是 bug，不是誤差。未達 100% 不進下一個 Phase |
| QR 解析（品項） | 20 張 | 無門檻，記錄實際取得率 | 取得率本身就是「要不要做 OCR」的決策依據 |

---

## 13. 平台約束（iOS）

> 本節集中記錄所有因為「目標平台是 iPhone」而產生的設計要求。**換平台時只需要重讀這一節。**

### 13.1 強制 standalone 模式

iOS 上 Safari 分頁與「加到主畫面」的 Web App 是**兩份獨立的儲存空間**。在 Safari 分頁記的帳，加到主畫面後不會出現——使用者會以為資料遺失。而 7 天未使用即清除的風險主要針對 Safari 分頁，主畫面 App 的處境較好。

**設計要求：**

```
App 啟動 → matchMedia('(display-mode: standalone)').matches
  false → 顯示安裝引導頁，說明「分享 → 加入主畫面」三步驟
          **不允許開始記帳**（連快速輸入欄位都不渲染）
  true  → 正常進入
```

寧可擋住，也不讓使用者在錯的儲存空間累積資料。引導頁附一句說明「為什麼要這樣做」，避免看起來像無理取鬧。

### 13.2 備份是資料安全機制，不是功能

即使在主畫面 App，也不把 IndexedDB 當唯一存放處。三件事（實作細節見 §11）：

1. 首次啟動呼叫 `navigator.storage.persist()`，結果顯示在設定頁
2. 距上次備份 > 7 天顯示提醒橫幅
3. 匯出走 Web Share API，讓檔案能直接存到「檔案」App / iCloud Drive

### 13.3 QR 掃描：單一 library，不用 BarcodeDetector

iOS Safari 無原生 `BarcodeDetector`。見 §5.1 / §5.2。選型條件是「單張圖多碼偵測」，待樣本實測後定案。

### 13.4 拍照：用 file input，不用 getUserMedia

```html
<input type="file" accept="image/*" capture="environment">
```

`getUserMedia` 即時掃描在 iOS standalone 模式下權限行為不穩定（每次開啟可能重新詢問，且 standalone 的權限狀態不一定沿用 Safari 的）。

v1 的流程本來就是「拍照 → 存照片 → 解析」，不需要即時取景框，file input 就夠。這也讓「相機權限流程」的設計成本幾乎歸零——系統相機由 iOS 自己管。

> 代價：無法做「對準就自動掃到」的即時體驗。v1 接受，因為每筆記帳只拍一次。

### 13.5 測試環境：真機 HTTPS

Service worker 需要 HTTPS（`localhost` 除外），所以「Mac 跑 dev server + iPhone 連區網 IP」**不會有 PWA**——service worker 不註冊、也無法加到主畫面測試。

**做法：** Phase 1 就把專案部署到 Netlify / Vercel / GitHub Pages，用 preview 網址在 iPhone 上測。除錯用 Mac Safari 的「開發」選單遠端連 iPhone 的 Web Inspector（iPhone 需開啟 設定 › Safari › 進階 › 網頁檢閱器）。

越早在真機上看到完整安裝流程越好——這是 Phase 1 的驗收條件之一，不是最後才驗。

---

## 14. 開發順序

排序原則：**先確保資料有逃生出口，再開始累積資料。**

| Phase | 內容 | 驗收 | 環境 |
|---|---|---|---|
| **1** | 專案骨架、PWA manifest、service worker、**部署到靜態主機**、standalone 偵測與安裝引導頁 | 在 iPhone 上完成「加到主畫面」並看到引導頁正確切換 | 真機 |
| **2** | `StoragePort` + `IndexedDbAdapter`、schema v1、sparse unique index 測試 | 真機驗證 Blob 寫入/讀回、`persist()` 回傳值 | 真機 + Vitest |
| **3** | `parseQuickInput`（含 §4.3 純數字保護） | §4.2 回測表全過，20 筆 ≥ 95% | Vitest |
| **4** | `RuleClassifier` + 規則 CRUD + §6.2 修正學習 | 單元測試涵蓋 §6.1 五條分支與 §6.2 四種情境 | Vitest |
| **5** | `buildInvoiceKey` + dedupe/merge | 同 key 重複寫入後筆數為 1，欄位依 §7.3 合併 | Vitest |
| **6** | **備份 / CSV 匯出 / 還原（Web Share）** | 真機完成一次「匯出 → 存到檔案 App → 還原」完整來回 | 真機 |
| **7** | 最小 UI：快速輸入、列表、待確認佇列 | 開始每日真實記帳 | 真機 |
| **8** | 分析（§8 四條規則 + 冷啟動 + 建議排序） | 每條結論都附得出 evidence | 真機 |
| **9** | QR 辨識（含 §5.2 library 實測選型） | 20 張真實發票，號碼/日期/金額 100% | 真機 |

Phase 3–5 是純邏輯，不受平台影響，可全速在電腦上開發。

**Phase 6 排在 UI 之前**是刻意的：Phase 7 開始會每天記真帳，在那之前資料必須有逃生出口。Phase 9 排最後是因為它依賴還沒到手的樣本，而且 v1 沒有它也能記帳。

---

## 15. v0.2 修訂摘要

| # | 章節 | 修訂 |
|---|---|---|
| 1 | §2.1 | `StoragePort.query` 移除 `IDBKeyRange`，改自定義 `KeyRange`；`Tx` 確認為自定義介面 |
| 2 | §2.2 | 新增 transaction 使用規則：前處理一律在 transaction 外，內部只讀寫 |
| 3 | §3.1 §7.1 | 去重鍵由 `invoiceNumber` 改為 `invoiceKey`（年期 + 號碼），避免跨年度碰撞 |
| 4 | §6.2 | 多品項被整筆改分類時不自動建 itemKeyword 規則，改逐項指定 |
| 5 | §3.1 | `confidence` → `classifyConfidence`，另加 `recognizeConfidence` |
| 6 | §3.1 | 移除 `by_yearMonth`，改用 `by_date` 字串範圍 |
| 7 | §3.1 | `amount` 明確定義為整數元，寫入前斷言 |
| 8 | §3.1 | `by_invoiceKey` 的 sparse 行為列為 Phase 2 必測項 |
| 9 | §3.3 | 移除「超商」類別，且**不設 merchant fallback**；新增類別刪除行為（停用 / 強制轉移） |
| 10 | §3.4 | 說明 priority 數字只在同類型衝突時生效，不是「品項優先」的實作來源 |
| 11 | §4.3 | 中間純數字 token → 移除該品項並進 pending，不產生名叫「55」的品項 |
| 12 | §5.1 §13.3 | 移除 `BarcodeDetector` 主路徑，改單一 library；選型條件為單張多碼 |
| 13 | §8.1 | 月對月暴增定案為單一模式「本月至今 vs 上月同期」，不提供切換 |
| 14 | §8.2 | 訂閱偵測加「每月 1–2 次」條件；店家名稱不一致列為已知限制 |
| 15 | §8.3 | 建議排序統一換算為「每月等值金額」；`topN` 定為 3 |
| 16 | §8.4 | 新增冷啟動狀態，資料不足顯示「還需 N 天 / N 筆」 |
| 17 | §11 | 備份加 7 天提醒與 Web Share 匯出 |
| 18 | §12 | #3 改為已決（iPhone）；#4 填入 N/X，QR 拉到 100% |
| 19 | §13 | 新增「平台約束（iOS）」整節 |
| 20 | §14 | 新增開發順序，備份提前到 Phase 6 |

**v0.1 已符合、本輪無需修改：** `pendingReasons` 原本就是陣列（§3.7）、`updatedAt` 原本就存在（§3.1）、`id` 原本就是 uuid。

---

## 16. 不在 v1 的清單（避免範圍漂移）

OCR、AI 分類、載具匯入、銀行串接、多人、多幣別、預算上限提醒、圖表以外的報表、跨裝置同步、多品項金額對應剖析、品項模糊比對、店家名稱同義詞合併、刪除規則時回溯套用、即時鏡頭掃描、月對月比較的 `completedMonthsOnly` 模式。
