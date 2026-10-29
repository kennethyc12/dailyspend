# DailySpend 設計文件 v0.2

> 狀態：**Phase 1–8 已實作並通過真機驗收（見 §14）。v1 功能已齊，僅剩 Phase 9（QR）待發票樣本。**
> 本文件隨實作同步更新，標註「Phase N 補定」的段落是實作時才定案的規格缺口。
> 技術選型已定：Vue 3 PWA + IndexedDB，**目標平台 iPhone（iOS Safari，standalone 模式）**。
> 待補輸入：發票 QR 原始文字樣本（缺樣本前不撰寫解析欄位邏輯）。載具明細樣本已到位，見 §11.3。
>
> v0.2 修訂摘要見 §15。專案簡介見 [README.md](./README.md)，進度見 [PROGRESS.md](./PROGRESS.md)，功能總覽見 [FEATURES.md](./FEATURES.md)。

---

## 1. 範圍

| 項目 | 本期 | 範圍外（需先詢問） |
|---|---|---|
| 使用者 | 單人 | 多人共享 |
| 幣別 | TWD | 多幣別 |
| 輸入 | 手動快速輸入、發票照片 | 銀行串接 |
| 辨識 | 台灣電子發票 QR code | OCR |
| 分類 | 規則比對 | AI 推論 |
| 匯入 | ~~無（預留介面）~~ 載具 CSV（發票存摺 App 匯出），見 §11.3（2026-10-14） | 財政部官方載具格式 |
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

> 2026-10-18 更正（B7b，使用者同意）：實際只剩 `StoragePort`。`RecognizerPort` 已評估、未採用（QR 偵測直接呼叫 `src/recognize/qrDetect.ts`）；
> `ClassifierPort` 與 `RuleClassifier` 依 D4 刪除，分類走 `classifyWithRules`。

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
  clear(store: StoreName): Promise<void>
}

interface StoragePort {
  put<T>(store: StoreName, value: T): Promise<StoreKey>
  get<T>(store: StoreName, id: StoreKey): Promise<T | undefined>
  getByIndex<T>(store: StoreName, index: string, key: StoreKey): Promise<T | undefined>
  query<T>(store: StoreName, index: string, range: KeyRange, opts?: QueryOptions): Promise<T[]>
  getAll<T>(store: StoreName): Promise<T[]>
  count(store: StoreName): Promise<number>
  delete(store: StoreName, id: StoreKey): Promise<void>
  clear(store: StoreName): Promise<void>      // Phase 6 補上，還原備份用
  transaction<T>(stores: StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T>
  estimateUsage(): Promise<{ usage: number; quota: number | null }>
  requestPersist(): Promise<boolean>
  isPersisted(): Promise<boolean | null>
  close(): void
}
```

`ConstraintError`（unique index 衝突）由 adapter 轉成自定義的 `StorageConflictError`，避免 `DOMException` 洩漏到 service 層。

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
  pendingReasons: PendingReason[]    // Phase 4 補上，見 §6.1
}

interface ClassifierPort {
  readonly source: 'rule' | 'ai'
  classify(input: ClassifyInput): Promise<ClassifyOutput>
}
```

> 2026-10-18 更正（B7b，使用者同意）：`RecognizerPort`、`RecognitionResult` 已評估、未採用，程式裡從未實作；
> `ClassifierPort` 依 D4 刪除。上面只有 `ClassifyOutput` 仍有效（`src/classify/port.ts`）。

兩種 confidence 刻意用不同名稱（`recognizeConfidence` / `classifyConfidence`），避免在 record 上混淆。

~~多個 recognizer 可串接（QR 先跑，未來 OCR 補缺欄位），service 層以 chain 呼叫，合併時「先到且 `recognizeConfidence` 較高者勝」。~~（B7b，2026-10-18：`RecognizerPort` 未採用）

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
| `categoryId` | string \| null | ~~null 代表待確認~~ null 代表未分類（B7c，2026-10-22，使用者同意；畫面與 CSV 顯示「未分類」，「待確認」只指 status） |
| `categorySource` | `'rule' \| 'user' \| 'ai'` | 分類來源 |
| `classifyConfidence` | number | 0–1，分類信心（v0.1 名為 `confidence`） |
| `recognizeConfidence` | number \| null | 0–1，辨識信心，無照片為 null |
| `status` | `'confirmed' \| 'pending'` | pending 進待確認佇列 |
| `pendingReasons` | `PendingReason[]` | **陣列**，可同時成立多個原因 |
| `invoiceNumber` | string \| null | `AB12345678`，10 碼 |
| `invoicePeriod` | string \| null | 發票年期，民國年+期別起始月，如 `11509` |
| `invoiceKey` | string \| null | **去重鍵**，`${invoicePeriod}-${invoiceNumber}`，見 §7 |
| `invoiceRandomCode` | string \| null | QR 內隨機碼 |
| `sourceType` | `'manual' \| 'photo' \| 'carrier'` | ~~carrier 預留~~ carrier：載具匯入（§11.3） |
| `photoId` | string \| null | → `photos.id` |
| `rawRecognition` | object \| null | 原始解析結果，debug 與回測用。載具匯入是 `{ source: 'invoice-passbook-csv', sellerTaxId, rows }`（合併進 QR 紀錄時保留 QR 的） |
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
| `isActive` | boolean | §6.3 要求 builtin 可停用，v0.2 的欄位表漏了，Phase 4 補上 |
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

> 2026-10-18 更正（B7b，使用者同意）：沒有讀取者的鍵已刪：`defaults.date`、`defaults.categoryFallback`、
> `parsing` 整組（`amountPosition`、`merchantDictEnabled`）、`export.encoding`（BOM 寫死在 `csv.ts`）、
> `thresholds.repeatPurchase.similarity`。不做 migration，舊裝置與備份檔裡的舊鍵會殘留，沒有讀取者。

所有預設值集中於此，UI 的「設定」頁直接編輯。

### 3.7 `PendingReason`

```ts
type PendingReason =
  | 'no_category_match'      // 沒有任何規則命中
  | 'ambiguous_merchant'     // 店家橫跨多類別且無品項
  | 'low_confidence'         // < settings.confidence.pendingBelow
  | 'recognition_failed'     // 沒有表頭也沒有品項（confidence 0）時由 service 設；B3b 之後頁面在 confidence 0 時不建面板，正式流程不會走到，保留為 service 契約與讀舊資料
  | 'amount_mismatch'        // 目前沒有產生點（D2c：有總計額就不收手輸），保留是為了讀舊資料
  | 'duplicate_conflict'     // 同 invoiceKey 但欄位衝突
  | 'ambiguous_item_tokens'  // 快速輸入中間出現純數字 token（§4.3）
  | 'multi_item_correction'  // 多品項被整筆改分類，需逐項確認（§6.2）
  | 'missing_merchant'       // 店家空白；補上店家就解除，編輯不會重新加上（B4.1 補定）
  | 'missing_invoice_date'   // 有號碼但算不出年期；補好日期就解除（B4.1 補定）
```

> 2026-10-22 更正（B8，使用者同意）：上面的清單少了 B2 新增的
> `'tokens_after_amount'`（金額後面還有字，已併進品項，請確認）。它是事件型，
> 和 `ambiguous_item_tokens` 一樣只有按「確認」才清掉。實際定義見 `src/models/types.ts`，共 11 種。

**狀態型與事件型（B4.1 補定，2026-10-14）**：`missing_merchant`、`missing_invoice_date` 是狀態型，成立條件可以從紀錄現在的欄位算出來，在 `prepareRecord` 補好就解除（新增、編輯、改分類、合併都經過它；例外是「確認」，它本來就清空全部原因，以及換照片，它只動 `photoId`）。`prepareRecord` 只解除、不加 `missing_merchant`：使用者確認過「沒有店家」之後，再編輯不會讓紀錄回到待確認。分類原因（`no_category_match`、`ambiguous_merchant`、`low_confidence`）在重新分類或改分類時更新；事件型原因（略過的字、金額後多出的字、辨識失敗、合併衝突）要使用者按「確認」才會清掉；`amount_mismatch`、`multi_item_correction` 沒有產生點，只為讀舊資料保留。`status` 完全由原因推導。（B8 補 `tokens_after_amount`）

存成陣列，UI 把每個 reason 轉成一句人話並列出；~~不同 reason 對應不同的修正欄位聚焦。~~（B8，2026-10-22：未做，見 PROGRESS ticket「待確認卡依原因聚焦欄位」）

---

## 4. 快速輸入切詞

目標：`全家 咖啡 55` → `{ merchant:'全家', items:[{name:'咖啡'}], amount:55 }`

### 4.1 規則（由後往前，確定性剖析，不猜）

1. **金額**：取字串中**最後一個**純數字 token（允許 `55`、`1,200`、`55元`、`$55`）。找不到 → 擋下，提示補金額（金額是唯一必填）。
2. **店家**：第一個 token。~~若命中店家字典（歷史紀錄 + 內建常見店家）則標記 `merchantMatched = true`。~~（B7b，2026-10-18：沒有讀取者，已刪）
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

### 4.4 邊界規則（Phase 3 實作時補定）

v0.2 的 §4.1 沒涵蓋以下情況，實作時定案：

| 情況 | 規則 | 理由 |
|---|---|---|
| 小數金額 `55.5` | 視為金額，四捨五入成整數 | `amount` 在 schema 上是整數元。若不在數字 token 的比對範圍內，它會逃過 §4.3 的檢查，變成一個叫「55.5」的品項 |
| `M/D` 的年份 | 用今年；若推出的日期在未來，退一年 | 錢不會花在未來。10/08 輸入 `12/25` 指的是去年 |
| 缺店家 | `pendingReasons += 'missing_merchant'` | §3.7 原本沒有對應的值，新增一個 |
| 只有一個 token 且像日期 | 視為金額，不視為日期 | `1200` 不該被讀成 12 月 00 日 |
| 金額後面還有字 `全家 咖啡 55 麵包` | 金額仍取最後一個數字 token；後面的 token 併進品項，`pendingReasons += 'tokens_after_amount'`。緊接金額的單位（元、塊）屬於金額，不算金額後的字 | 不能默默丟掉使用者打的字；用專屬原因而不沿用 `ambiguous_item_tokens`，待確認卡才說得清楚（B2，DECISIONS P6；B8 補進文件） |

**`7-11` 不是 7 月 11 日。** 日期前綴的比對刻意不對稱：

```
斜線形式允許單位數：  10/3  7/11   → 是日期
破折號形式要求補零：  09-28 07-11  → 是日期
                      7-11         → 不是日期，是店家
```

這正是 §4.1 寫的 `M/D | MM-DD`。實作時若把兩種分隔符合併成 `(\d{1,2})[/-](\d{1,2})`，`7-11 御飯糰 45` 會被剖析成「7 月 11 日，店家＝御飯糰」——而 7-11 是台灣最常見的店家之一。這條已納入回測語料庫。

---

## 5. 辨識流程（QR）

~~**本節的欄位切法為架構佔位，待樣本確認後補。**~~（B8，2026-10-22：欄位切法已依樣本實作，見 §5.3）

已知前提（需用樣本驗證，不預設）：
- 台灣電子發票列印時為**左右兩個 QR 並排**，左 QR 含發票號碼、日期、隨機碼、金額等固定長度欄位；品項明細（若有）放在右 QR 的延伸區。
- 品項能取到幾項、編碼方式（Base64 / UTF-8 / Big5）**必須由樣本決定**，不臆測。（2026-10-12：中文編碼參數在實務上不可靠，不依它判斷編碼，見 §5.3.1）

### 5.1 不使用 BarcodeDetector

v0.1 寫的是「`BarcodeDetector` 原生 API，不支援時 fallback」。**v0.2 移除原生路徑**：目標平台是 iOS Safari，原生 `BarcodeDetector` 不支援，維護兩條路徑只會讓真正會跑的那條缺乏測試。v1 統一用單一 library。

### 5.2 Library 選型：定案 `zxing-wasm`（2026-10-11）

決定性條件是**能不能一次處理一張圖裡的兩個 QR**：

| 候選 | 多碼偵測 | 代價 |
|---|---|---|
| `jsQR` | 否，單張單碼 | 體積小，但必須自己把圖切左右半張分別解；切分點受拍攝角度與裁切影響，容易失敗 |
| `zxing-wasm` | 是，單張多碼 | 體積較大（wasm），但原生支援本情境 |

**定案 `zxing-wasm` 3.1.5。** `jsQR` 已自 dependency 移除。

#### 第一輪：合成圖的能力驗證

用 zxing 的 writer 合成「左右兩個 QR 並排」的圖，回答**能不能**。

| 項目 | zxing-wasm | jsQR |
|---|---|---|
| 一次呼叫解到兩個並排的碼 | ✅（`maxNumberOfSymbols: 8`） | ❌ |
| 全圖只有單一個碼 | ✅ | ✅ |
| **兩個碼並排時** | 兩個都解到 | **連一個都回不出來** |

jsQR 的結果比原本的假設更差：這份文件先前寫的是「單張單碼，要自己切半」，
實際上兩個碼並排會讓它的 locator 被另一半的定位點干擾而整張失敗。也就是說
它不是「拿第一個就夠」，是**非切圖不可**，而切分點正是我們想避免的不確定性
來源。切成左右各 55%（重疊 10%）後兩邊各自解得到，但那個比例是為合成圖挑的。

#### 第二輪：真實發票照片（iPhone，standalone）

| 壓縮設定 | 大小 | zxing | jsQR（全圖 / 左 / 右） |
|---|---|---|---|
| 樣本存檔版 | 232 KB | **2 個** · 41 ms | 2 個（0 / 1 / 1）· 183 ms |
| 1600px / q0.8（現行預設） | 232 KB | **2 個** · 15 ms | 2 個（0 / 1 / 1）· 141 ms |
| 1600px / q0.6 | 167 KB | **2 個** · 12 ms | 2 個（0 / 1 / 1）· 120 ms |
| 1200px / q0.8 | 158 KB | **2 個** · 8 ms | 2 個（0 / 1 / 1）· 64 ms |

三個結論：

1. **jsQR 的「全圖」每一列都是 0。** 合成圖上的發現在真實照片上一樣成立，
   不是合成圖的假象。
2. **zxing 全面較快**，而且最慢的一次（41 ms）仍快於 jsQR 最快的一次
   （64 ms）——即使 zxing 的數字含 JPEG 解圖、jsQR 的不含。
3. **現行壓縮預設（1600px / q0.8）解得動**，§5.2.1 標記「沒驗證過」的風險
   解除，預設不動。

量測上的兩個瑕疵，記下來免得數字被過度解讀：

- **第一列不是相機原圖。** 樣本存進 IndexedDB 前已經過 `compressPhoto`，所以
  前兩列同為 232 KB。「未壓縮的原圖解不解得動」沒有被回答——但既然壓過的解
  得動，這題的風險方向是安全的。
- **wasm 載入顯示 2 ms 不可信**，那是模組已在記憶體中的數字。真正的首次載入
  要冷開 App 才量得到。

樣本數是 1 張。再多拍幾張只會修正成功率，不會翻盤選型：jsQR 必須切圖這點是
結構性的，不是這張照片的運氣。

這些斷言在 `src/recognize/__tests__/qrDetect.test.ts`（合成圖的部分），
真實照片的數字來自 `/qr-lab`（§5.2.2）。

### 5.2.1 拍照管線已完成（Phase 9a），QR 解析待樣本

> 2026-10-22 更正（B8）：QR 解析已在 9b-2 完成，見 §5.3。

Phase 9 拆成兩半：**不依賴樣本的拍照管線先做**，QR 解析等樣本。

已完成：`<input type="file" capture="environment">` → `compressPhoto()` → 存成
`Photo` → 與紀錄同一個 transaction 寫入 → 列表與編輯頁顯示、可更換可移除。

兩個實作決定：

**壓縮參數做成可調**（`settings.photo.maxEdge / thumbEdge / quality`，預設 1600 / 320 / 0.8），
設定頁可改。這組數字原本是為了省空間訂的，**沒有驗證過壓完還解不解得出 QR**。
拿到真實發票後第一件事就是測這個，所以不能寫死。

**附照片不改 `sourceType`。** 照片只是證據，金額仍是手打的。`sourceType` 影響
§7.3 的 merge 優先序（`qr > manual`），附張圖就讓欄位升級成「比手輸可信」是錯的。
等 QR 真的解出欄位，才改成 `'photo'`。

**EXIF 方向必須套用**：`createImageBitmap(file, { imageOrientation: 'from-image' })`。
iPhone 拍的照片方向放在 EXIF 裡，不套用存進去的圖會是躺著的。

### 5.2.2 QR 實驗室（`/qr-lab`）

設定頁 →「發票樣本」→「QR 實驗室」。選一張樣本或現場拍一張，一次跑完：

- 四種壓縮設定（存檔版、1600/q0.8、1600/q0.6、1200/q0.8）各解到幾個碼、耗時多少
- 每個 payload 的文字、位元組長度、hex、Big5 解讀，可複製

~~選型已定案，這一頁留著是因為**欄位切法要靠真實 payload 決定**（§5 待樣本的
部分）：品項的編碼是 Base64 還是 Big5、取得率多少，都要看實際字串。~~
選型已定案，欄位切法也已依樣本實作；這一頁留著用來看新樣本的原始 payload，
例如第一次遇到 Big5 或 Base64 時（B8，2026-10-22）。

路由 lazy 載入，library 不進主 bundle。wasm（約 950 KB）**已列入 precache**
（`globPatterns` 含 `wasm`）——離線時沒有它就解不了碼，而離線可用是這個 App
的前提。代價是安裝時多下載約 1.2 MB。

這一頁是量測工具~~，不是 `RecognizerPort` 的實作~~（B7b：`RecognizerPort` 未採用）；偵測本身在
`src/recognize/qrDetect.ts`。

### 5.3 流程（已實作）

```
照片 Blob（<input type="file">，拍照或相簿）
  → compressPhoto()
  → detectQrCodes()            zxing-wasm，一次解到左右兩碼
  → parseEInvoicePayload()     合併左右 payload，拆表頭與品項
  → 畫面顯示讀到什麼，使用者補店家（與金額；沒有表頭時還有日期）
  → createFromInvoice()        分類 → saveRecord（去重、合併）
```

以上全部在 transaction **之外**完成（§2.2）。

**金額只採信左方 QR 的總計額。** 品項三元組的第三欄規格叫「單價」，~~但第一張
實拍樣本無法分辨它是單價還是小計（`白蘭氏雞精組:2:1479`，2×1479 與 1479 都
說得通）~~（2026-10-12 更正：不加總的理由改為「無法核對品項是否完整」，見下方），
所以不加總、不寫進 `RecordItem.unitPrice` 或 `.amount`，原始值留在
`rawRecognition`。沒有總計額時由使用者輸入金額，**沒填就不給存**。

> 2026-10-12 更正：第一張樣本其實分辨得出來。它是好市多 App 的「發票開立通知」，
> 紙面印的總計 2,358 = 2×1479 + 2×(−300)，當成小計的各種組合（1179、879、2658）
> 都對不上，**支持「單價」**。兩張合規樣本（電影票、炙燒明太子）的 qty 都是 1，兩種讀法
> 算出來一樣，不衝突。目前是 1 張支持、0 張反例，**政策不變**：
> - 沒有表頭的 payload 無法用「記載品目筆數／總筆數」核對品項是否完整，加總可能
>   默默偏少，所以仍不加總、不自動帶入。
> - 規格補充說明第 3 點允許折扣、點數扣抵等「無[數量]」的品目不記錄於 QR
>   （規格見 §5.3.1，Ver 1.9 PDF 第 12–13 頁），所以品項加總可能**大於**實付的總計額。
>   這和上一條（品項不完整時偏少）方向相反，兩種誤差都可能出現。
> - 重新評估的觸發點：9b-3 的樣本中「沒有總計額」的發票超過一張。
> - 屆時若要回填，`unitPrice`／`amount` 依 §3.1 是整數元：只在 `value`、`qty×value`
>   為整數時寫入，否則留 `null`，不四捨五入；已存紀錄的回填屬於資料遷移，另立 plan。

語意確認之後要改的只有兩處（2026-10-12 補充：另需加上品目筆數的核對，見上方更正）：`createFromInvoice()` 裡的 `items` 對應，以及
記一筆頁面那段「不替你加總」的說明。

**表頭總計額是 `0` 視為沒有記載**（2026-10-12）：規格「不得開立零元發票」（規格見
§5.3.1，Ver 1.9 PDF 第 16 頁），境外電商的表頭總計額固定記 `00000000`（PDF 第 8 頁）。所以
`parseEInvoicePayload()` 把它當成 `null` 並留一則 note，由使用者輸入金額。只看
總計額、不看編碼參數（參數不可靠，見 §5.3.1）；`salesAmount` 允許記 `0`，不比照；
/qr-lab 讀的是 `LeftHeader`，照原樣顯示 `0`。

**沒有表頭時日期由使用者填**（2026-10-13，B3b #5）：不再預設今天。有表頭時以 QR 的
日期為準、忽略使用者輸入，因為它決定 `invoiceKey`。日期驗證和編輯頁共用
`isValidIsoDate()`（`src/analysis/dates.ts`）。

**wasm 在進入記一筆頁時先暖機**：冷啟動載入約 1 秒（實機實測），不先暖好的話
會剛好撞在使用者按下拍照之後。

### 5.3.1 中文編碼參數：不依參數判斷編碼（2026-10-12）

左方 QR 第 12 項「中文編碼參數」，財政部《電子發票證明聯一維及二維條碼規格說明》
Ver 1.9（財政部財政資訊中心，民國 111 年 5 月 10 日）PDF 第 7 頁：

> 12. 中文編碼參數(1 碼)：定義後續資訊的編碼規格，若以：
> (1) Big5 編碼，則此值為0
> (2) UTF-8 編碼，則此值為1
> (3) Base64 編碼，則此值為2

境外電商另有「此值為3」（UTF-8，PDF 第 9 頁）。Ver 1.8 的定義相同。
引述的換行與空白是 PDF 抽字產生的，已整理。

實拍（2026-10-12，/qr-lab）：

| 樣本 | 參數 | 規格上代表 | 實際位元組 |
|---|---|---|---|
| 電影票 | `1` | UTF-8 | UTF-8（111 字 / 127 bytes） |
| 炙燒明太子 | `0` | Big5 | **UTF-8**（123 字 / 143 bytes） |

**決策**：不依這個參數向使用者斷言編碼，也不依它改變解碼方式。
原本的程式把對照寫反（`'0'` = UTF-8、`'1'` = Big5），對電影票那張顯示了錯誤的
「Big5」提示；但就算照規格修正，炙燒明太子那張也會被說成 Big5。所以直接移除。

**已評估、未採用**：偵測亂碼（例如品名出現 U+FFFD）並提示。
- 代價：真的遇到 Big5 發票時，若 zxing 猜錯編碼，品名會是亂碼且沒有提示。
- zxing-wasm 的 `characterSet` 沒有設定，預設由 zxing 自行猜；兩張實拍都猜對 UTF-8，
  Big5 能不能猜對**沒有驗證**（目前 0 筆 Big5 實例）。
- 偵測當下拿得到原始位元組（`DetectedCode.bytes`），`decodeBig5` 也已經存在，所以在
  拍照當下重新解碼是可行的。但已存的紀錄沒有保存位元組（`rawRecognition` 只存解析
  結果，見 PROGRESS〈下一步〉的 ticket），事後無法重新解碼。
- 重新評估的觸發點：第一次遇到亂碼品名。

### 5.4 失敗處理

實作對應：`recognizeConfidence` 由 `parseEInvoicePayload()` 給（表頭+品項=1、
只有表頭=0.8、只有品項=0.5、什麼都沒有=0），`pendingReasons` 由
`createFromInvoice()` 補齊。

- ~~偵測不到 QR → `recognizeConfidence: 0`，`recognition_failed`，**照片仍保存**，使用者手動補欄位。~~
  （2026-10-13 更正，D2a：讀不到 QR、讀取失敗、或 `parseEInvoicePayload()` 的 confidence 為 0 時不建發票面板，
  顯示提示並走文字輸入；照片仍會附在文字紀錄上。B3b 實作。）
- 只偵測到一個 QR → 用左 QR 的欄位，品項留空，`recognition_failed` 不設，但 `classifyConfidence` 依無品項的路徑走。
  （2026-10-13 起實作一致，D2b：`recognition_failed` 只在沒有表頭也沒有品項時設。）
- ~~解析部分成功 → 填入已知欄位，缺的留空，`status: 'pending'`。~~
  （2026-10-13 更正：缺的欄位存檔前就得補齊（日期、金額的規則見 §5.3）；缺店家有
  `missing_merchant`、分類沒把握有分類相關的原因。不再因為「部分成功」本身強制 pending。）
- ~~手輸金額 ≠ QR 金額 → 兩個數字都顯示，`amount_mismatch`，預設採信 QR，使用者可改。~~
  （2026-10-13 更正，D2c：金額規則見 §5.3「金額只採信左方 QR 的總計額」；有總計額時畫面不顯示
  金額欄，`amount_mismatch` 已無產生點。）

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

#### 五條分支之間的縫隙（Phase 4 補定）

**「items 全部命中但類別分歧」** 不屬於上面任何一條。例如 `[咖啡, 拿鐵, 衛生紙]` 三項全命中，但分屬飲料與日用品。

定案：**視同「部分命中」，走多數決 0.7。** 分歧本身就是信心不足的訊號，不該拿到「全部命中」的 0.95。

#### ambiguous 的判定要看 priority（Phase 4 補定）

「merchant 命中多類別」若直接用「所有命中規則的類別數 > 1」判斷，會出現這個死結：

```
內建規則：      蝦皮 → 日用品   (priority 100)
使用者修正：    蝦皮 → 娛樂     (priority 200)
→ 兩個類別 → 判為 ambiguous → 永遠進待確認
```

使用者修正過的店家反而永遠分不出來，§6.2 的「修正即成規則」形同失效。

定案：**只取命中規則的最高優先層（priority 與 pattern 長度都相同者），該層內仍有多個類別才算 ambiguous。** 上例中使用者修正獨占最高層，結果是「娛樂」，不是 ambiguous。

同樣邏輯套用在 itemKeyword 上。

#### `ClassifyOutput` 要帶 `pendingReasons`（Phase 4 補定）

§2.3 的介面定義沒有這個欄位，但步驟 3–4 會產生 `ambiguous_merchant` / `no_category_match` / `low_confidence`，上層要靠它決定 `status`。已加入介面。

### 6.2 修正即成規則（v0.2 修正：多品項不自動學習）

v0.1 寫「有品項 → 以最長的 item.name 建規則」有明確的教錯風險：一筆全聯紀錄 `[雞胸, 衛生紙]`，使用者把整筆改成「飲食」，系統會學到「衛生紙 → 飲食」，而且這條錯規則會一直生效到使用者自己發現。

**v0.2 規則：**

> 待確認頁（B4.2a 補定，2026-10-14，使用者同意）：卡片上選類別只是草稿，不會即時學成規則；按「確認並記住規則」才依下表學習，按「確認」只套用類別。編輯頁維持「改類別就學成規則」。

| 情境 | 行為 |
|---|---|
| `items.length === 0` | 建 merchant 規則 |
| `items.length === 1` | 建 itemKeyword 規則（pattern = 該品項名） |
| `items.length >= 2`，使用者只改**整筆**分類 | **不自動建 itemKeyword 規則**。UI 出現「要記住嗎？」面板，列出每個品項讓使用者逐項指定類別；每項指定才各建一條 itemKeyword 規則。使用者選「略過」→ 只建 merchant 規則，並記 `multi_item_correction` 供日後回看（未實作，見 PROGRESS.md〈下一步〉的 `multi_item_correction` ticket） |
| `items.length >= 2`，使用者改**單一品項**的分類 | 直接為該品項建 itemKeyword 規則 |

共同行為：
- `origin = 'userCorrection'`
- 已存在同 `pattern` + `type` 的規則 → 更新 `categoryId` 與 `updatedAt`，不新增
- 建立後 toast：「已記住：拿鐵 → 飲料（可在設定 › 規則中刪除）」+ undo（undo 未實作，B4.2a 記 ticket；目前是頁面上的提示文字）

### 6.3 規則管理畫面

列出所有規則，可依 `type` / `origin` 篩選，顯示 `hitCount` 與 `lastHitAt`，支援刪除 userCorrection 規則與停用 builtin 規則。

刪除規則**不回溯**修改既有紀錄（避免歷史被改寫），僅影響日後分類。
> v2 可考慮在刪除對話框加一個**選用**的「一併套用到既有紀錄」按鈕，預設不勾。

### 6.4 AI 介面預留

~~`AiClassifier implements ClassifierPort`，v1 不註冊到 DI container。接上時 service 層策略：rule 先跑，`classifyConfidence < threshold` 才呼叫 AI；AI 結果寫入 `categorySource: 'ai'`。~~

（B7b，2026-10-18：`ClassifierPort` 已刪，D4，使用者同意。日後接 AI 時再設計介面。）

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

邊界：`date` 缺失（純手輸 + 無 QR）時 `invoiceNumber` 通常也缺，`invoiceKey = null`，不參與去重。若有號碼無日期 → `invoiceKey = null` 且記 `pending(missing_invoice_date)`，讓使用者補日期；補好之後自動解除（B4.1，2026-10-14）。

**例外（載具匯入，2026-10-13 使用者同意）**：匯入時，同日同額、`invoiceKey = null` 的既有紀錄會列為「可能重複」，由使用者逐筆選擇要不要合併；選合併時把號碼補到既有紀錄上，並重算 `invoiceKey`（`mergeForWrite`）。系統不會自動判定兩筆是同一張，見 §11.3。

#### 號碼格式不做嚴格驗證（Phase 5 補定）

標準格式是 2 個英文字母 + 8 位數字。`isStandardInvoiceNumber()` 只供 UI 提示，**不用於擋下寫入**：

~~QR 樣本還沒到手，現在就把非標準格式的號碼判定為無效，等於拿假設去阻斷去重——~~ 非標準格式的號碼仍可能是真的，把它判定為無效等於拿假設去阻斷去重——萬一實際格式不同，受害的是「同一張發票被存成兩筆」這種難以察覺的資料汙染。寧可收下再提示。（B8，2026-10-22：樣本已到手，拿掉過期理由）

號碼寫入前只做正規化：去空白與破折號、轉大寫。

### 7.2 寫入判斷

```
if (invoiceKey == null) → 直接新增
existing = getByIndex('records', 'by_invoiceKey', invoiceKey)
if (!existing) → 新增
else → merge(existing, incoming)
```

查詢與寫入分屬不同 transaction（§2.2）；unique index 的 `ConstraintError` 作為最後防線，捕捉後轉 `duplicate_conflict` 並重跑 merge。

這是手輸與 QR 的寫入路徑（`saveRecord`）。載具匯入為了全有或全無，另有單一 transaction 的寫入路徑（`commitCarrierImport`），合併規則共用 `mergeForWrite`，見 §11.3。

### 7.3 merge 規則（欄位級，來源優先序 user > carrier > qr > manual）

| 欄位 | 策略 |
|---|---|
| `date` / `amount` / `invoiceNumber` | 取高優先來源；兩邊都有且不同 → 保留既有 + `pending(duplicate_conflict)`，UI 讓使用者選 |
| `items` | 取**項數較多**的那份；項數相同取高優先來源 |
| `categoryId` | 既有為 `user` 來源則不動；否則重跑分類 |
| `photoId` | 既有為 null 才填入；兩張照片都有 → 保留既有，新照片丟棄並提示 |
| `note` | 兩者串接 |
| `updatedAt` | 一律更新為 `Date.now()` |

~~載具匯入（日後）走同一條 merge 路徑，`sourceType: 'carrier'`，所以「匯入去重筆數為 0」由同一段程式保證。~~

**實情（2026-10-14 使用者同意偏離）**：載具匯入要在單一 transaction 內全有或全無，不能逐筆走 `saveRecord`，所以寫入判斷另有一份（`carrierImportService.ts`）。共用的是合併規則：兩條路徑都經過 `mergeForWrite()`（`mergeRecords` + `prepareRecord`）。「匯入去重筆數為 0」改由匯入自己的測試保證（重新匯入同一份，總筆數不變）。

#### 第一列的矛盾（Phase 5 補定）

「取高優先來源」與「兩邊都有且不同 → 保留既有」互相牴觸。定案：

```
值相同              → 不算衝突
一邊為 null         → 補上，不算衝突
值不同、優先層不同  → 取高優先來源，並記 conflicts + pending(duplicate_conflict)
值不同、同一優先層  → 保留既有，並記 conflicts + pending(duplicate_conflict)
```

重點是**衝突一律標記**。載具資料比手輸可信，該覆蓋就覆蓋，但「兩邊數字對不上」這件事不能被無聲吞掉——它可能代表抓錯發票。

#### `user` 優先序只適用於 `categoryId`（Phase 5 補定）

來源優先序寫成 `user > carrier > qr > manual`，但我們沒有逐欄位的編輯紀錄：`categorySource === 'user'` 只證明**類別**被改過，不證明日期或金額被改過。

所以實作上 `user` 只參與 `categoryId` 的判斷，其餘欄位一律用 `sourceType` 比較（`carrier > qr > manual`）。要讓 `user` 適用於所有欄位，得在 schema 上加逐欄位的編輯來源，v1 不做。

#### merge 另外回報三件事（Phase 5 補定）

`mergeRecords()` 除了合併後的紀錄，還回傳：

| 欄位 | 用途 |
|---|---|
| `discardedPhotoId` | 兩張照片都有時被丟棄的那張，UI 要提示 |
| `needsReclassify` | 既有分類非使用者設定且品項變了 → 上層要重跑分類 |
| `conflicts` | 衝突欄位名清單，UI 標出哪幾格對不上 |

`needsReclassify` 是旗標而非直接重跑，因為分類必須在 transaction 之外執行（§2.2）。

---

## 8. 分析規則與門檻參數

全部存在 `settings.thresholds`，分析頁可即時調整並重算。每條結論**必須**附 `evidence: { recordIds: string[], itemNames?: string[] }`，UI 點擊可跳到該筆紀錄。

分析一律 **on-demand 計算**，不預先彙總；單人資料量不需要 materialized view。超過 5 萬筆再加月度彙總 store。

| 規則 | 判斷式 | 參數 | 預設 | 範圍（整數） |
|---|---|---|---|---|
| **高頻小額** | 近 N 天內，單筆 ≤ A 元 且 同類別次數 ≥ C | `windowDays` `smallAmount` `minCount` | 30 / 150 / 8 | 1–365 / ≥ 1 / ≥ 2 |
| **訂閱與固定支出** | 見 8.2 | `minMonths` `amountVariancePct` `maxMonthlyOccurrences` | 3 / 10% / 2 | ≥ 2 / ≥ 0 / ≥ 1 |
| **月對月暴增** | 見 8.1 | `growthPct` `minDelta` `minDaysThisMonth` | 50% / 1000 / 7 | ≥ 0 / ≥ 1 / 1–28 |
| **同類重複購買** | 近 N 天內，相同品項名出現在 ≥ K 筆紀錄（見 §8.5） | `windowDays` `minRepeat` ~~`similarity`~~ | 14 / 3 ~~/ `exact`~~ | 1–365 / ≥ 2 ~~/ —~~ |
| **可降低建議** | 見 8.3 | `topN` | **3** | ≥ 1 |

範圍（B6a，2026-10-17，使用者同意）定義在 `THRESHOLD_RANGES`（`src/storage/defaults.ts`），同時用在兩處：分析頁寫入時擋下範圍外、小數與空白，顯示「門檻儲存失敗：<欄位>要填 <範圍>」；每次開啟時 `migrateSettings` 把已存的範圍外值夾回邊界、小數四捨五入、非數字退回預設。下限是讓規則語意成立的最小值（例如 `minMonths` 0 會讓訂閱偵測當掉、`minDelta` ≥ 1 保證本期有紀錄可當依據），上限只在會當掉或語意不成立時才設（觀察天數過大會超出日期範圍；`minDaysThisMonth` 大於 28 在二月永遠達不到）。

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

### 8.5 實作時補定

#### 訂閱的「連續 N 個月」怎麼取區間

寫死成「含本月的最近 N 個月」，每個月初都會漏抓——訂閱那天還沒扣款。

定案：**取最長的連續月份區段，且該區段必須延伸到本月或上月**（代表仍在進行）。變異係數只看區段最後 `minMonths` 個月。這樣月初月底的結果一致，停掉三個月的舊訂閱也不會再出現。

#### 上期為 0 時的成長率

`(本期 − 上期) / 上期` 在上期為 0 時無定義。定案：**視為「新增支出」，只看絕對增額是否達 `minDelta`**，結論文字顯示「新增」而非百分比。

#### 「上月有紀錄」是整月，不是同期

門檻與比較用的區間刻意不同：

```
門檻：上月整月有沒有紀錄     ← §8.4 的字面
比較：本月至今 vs 上月同期   ← §8.1
```

若門檻也用對齊區間，9/25 才花錢的情況會顯示「上個月沒有紀錄」——但上個月明明有。比較本身仍用對齊區間，而結論文字一律寫出實際區間，所以不會誤導。

#### 同類重複購買的「品項總額」是估算

v1 手動輸入沒有單品金額，`item.amount` 幾乎都是 `null`。定案：**用 `record.amount ÷ 品項數` 平均分攤**，並在 `Finding.estimated` 標記，UI 顯示「約」。

這個數字只用於排序，不用於任何對外陳述；evidence 仍然指向具體紀錄，所以「每條結論至少附一筆依據」沒有被犧牲。日後 QR 若能取到單品金額，`item.amount` 有值時自動不標記估算。

金額 ≤ 0 的品項不參與重複購買，但分母（品項數）仍然算進它們，見下一節的已知限制。

#### 同類重複購買：排除 ≤ 0 的品項、次數以紀錄計（C1.5 補定，2026-10-13）

載具資料（§11.3）讓品項第一次有了單品金額，也第一次出現「一列一單位」的形狀，原本的規則因此產生兩種誤報。補定：

- **品項有金額且 ≤ 0 → 不計次，也不計金額。** 這些是折扣、回饋金、點數折抵、套餐附餐，載具會逐列列出，但它們不是一次購買。`amount` 是 `null`（手輸、QR）的品項照舊平均分攤。
- **次數 = 視窗內含該品名的不同紀錄數；金額 = 所有列加總。** 同一張發票買 4 包同款算 1 次，合計是 4 包的金額。
- 推論：加上第一條之後，結論金額不可能是負數。有金額的品項只計正數；`null` 走平均分攤，而紀錄金額 ≥ 0。

已知限制：匯入的紀錄如果在編輯頁新增品項，新品項的 `amount` 是 `null`，會用 `record.amount ÷ 品項數` 估算，而分母也算進被排除的品項，所以估得比較粗。結論會標「約」。觸發點：出現混合紀錄造成明顯誤排序時再重新評估。

為什麼：用 2026/09 的載具樣本模擬，9 條結論裡有 2 條合計是負數（回饋金），另外 4 條完全來自同一張發票的同名列。

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

載具匯入的資料流程見 §11.3。

---

## 10. 待確認佇列

獨立頁面（底部 tab 顯示紅點數字），每張卡片：
- 原始輸入全文 / 照片縮圖
- 系統猜測的欄位（可直接編輯）
- `pendingReasons` **全部**轉成人話逐條列出（不只顯示第一個）
- 「確認」「確認並記住規則」「刪除」三個動作（B4.2a，2026-10-14，使用者同意：類別是草稿，「確認」只套用、不學規則；「確認並記住規則」依 §6.2 學規則後確認）
- ~~多品項改分類時，展開 §6.2 的逐項指定面板~~ 多品項按「確認並記住規則」時，展開 §6.2 的逐項指定面板（B4.2a，2026-10-14，使用者同意）

設計原則：**不亂猜**。寧可留空讓使用者填，也不填一個似是而非的類別或一個叫「55」的品項。

### 10.1 編輯既有紀錄（Phase 7 之後補）

原本的 Phase 拆分漏了這塊：待確認佇列只處理 `status === 'pending'` 的紀錄，一旦確認就再也改不動。打錯金額的唯一補救是還原備份——這在每日記帳的第一天就會踩到。

紀錄頁點任一筆進入編輯頁，可改日期、店家、金額、品項、備註、類別，或刪除。紀錄頁也可選取多筆一次刪除（bulk-delete，2026-10-26，使用者同意）。

**重跑分類的條件**：店家或品項變動時重跑，但 `categorySource === 'user'` 的紀錄不動。這和 §7.3 的 merge 原則一致——使用者指定過的分類比規則可信。

~~**品項用空白分隔的單一輸入框**，與快速輸入的心智模型一致。~~（2026-10-13 更正：改為一行一個品項（`textarea`）。發票路徑的品名可以含空白，用空白分隔會在編輯時把品名切開（B3a #1）；品項欄沒改過時不送出品項，原封不動。）~~同名品項保留既有的 `categoryId`，只有新品項才重新分類。~~ 新品名依位置與順序對回舊品項（頭尾相同的依位置，中段同名的依舊順序），同名品項各自保留數量、金額與分類；相鄰同名刪掉一個時保留前面那個。店家或品名有變、分類來源不是 `user` 時仍會重分類（same-name-items，2026-10-23，使用者同意）。

**改日期必須重算 `invoiceKey`**（§7.1）。日期跨到另一個期別時 key 會變，不重算的話索引內容就和欄位對不上。`updateRecordFields` 一律走 `prepareRecord()`，維持「唯一產生點」的保證。

#### 實作（Phase 7）

四個分頁：記帳 / 紀錄 / 待確認（紅點數字）/ 設定。

待確認卡片上，`pendingReasons` **全部**逐條轉成人話列出，不只顯示第一個。~~改整筆分類時若 `planCorrection` 回傳 `needs_per_item`，卡片就地展開逐項指定面板~~（B4.2a 更正，2026-10-14，使用者同意：改分類會讓紀錄立刻離開待確認，面板跟著卡片消失，看不到）。改成：按「確認並記住規則」時若 `needs_per_item`，卡片先不確認、就地展開逐項指定面板，並附一句說明為什麼不自動學——否則使用者只會覺得系統沒記住他的修正。逐項選類別即時學成品項規則；最後按「完成並確認」，或「略過，只記住店家（並確認）」。

刪除用就地兩段確認，不用 `window.confirm`。

**多選刪除**（bulk-delete，2026-10-26，使用者同意）：紀錄頁按「選取」後可逐筆勾選，或「全選目前結果」（搜尋後全選就能清掉某次匯入或某家店的測試資料）。勾選永遠等於畫面上看得到的：改關鍵字就清空，紀錄被別處刪掉就移除。按「刪除 N 筆」後照還原的兩步驟（§11）：先存下目前資料的保險備份，存下之前「確認刪除」是 disabled；`prepareBulkDelete`／`commitBulkDelete` 讓這件事在 API 上就是強制的。確認區塊列出筆數與合計、其中幾筆附照片（會一起刪）、其中幾筆是發票（之後重新匯入或重掃會再出現）、學到的規則不會刪。刪錯用保險備份還原，不做 undo。單筆刪除（編輯頁、待確認卡）不變，不強制保險備份。刪除一律走 `deleteRecords`，在單一 transaction 內讀 DB 當下的 `photoId` 刪照片。

**就地編輯欄位**（B4.2b-2，chris-dev 判定）：卡片按「修改」展開日期、店家、金額、品項、備註；「完成修改」只在畫面上算出改後的紀錄（驗證、必要時重分類、重算 `invoiceKey`），不寫入。按「確認」或「確認並記住規則」時，改後的欄位、類別、學到的規則與重分類的命中次數在同一個 transaction 寫入（命中次數只在採用了重分類結果時才算：完成修改之後又選了類別就不算）；沒按就什麼都沒存。不讓「修改」直接存檔，是因為補好店家或日期會讓最後一個原因解除，卡片自己消失，使用者沒按確認就離開了待確認。卡片上已選類別時不重分類。逐項面板選類別仍即時學成品項規則，但品項類別要按「完成並確認」或「略過，只記住店家（並確認）」才寫進紀錄。

**規則管理畫面**（§6.3）放在設定頁，預設只列「我修正的」規則。§6.2 的 toast 寫著「可在設定 › 規則中刪除」，沒有這個畫面那句話就是謊話，所以一併做了。

**第一次啟動要鎖住輸入**：seed 還沒跑完就送出，`loadActiveRules` 會回空陣列，每一筆都變成待確認。輸入框與送出鈕在 `initStorage()` 完成前都是 disabled。

---

## 11. 匯出與備份

在 iOS 上這不是加分功能，是**資料安全機制**（見 §13.2）。

| 功能 | 格式 | 內容 |
|---|---|---|
| CSV 匯出 | UTF-8 with BOM（Excel 相容） | 一筆紀錄一列，items 以 `;` 串接；可選日期區間 |
| 完整備份 | `.zip`（JSON + 照片） | records + categories + rules + settings + photos |
| 還原 | 讀 zip | **覆寫操作，需二次確認**，並先自動匯出一份當前備份 |
| 載具 CSV 匯入 | 讀發票存摺 CSV | 預覽 → 選擇可能重複 → 一次寫入；見 §11.3 |

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

`navigator.share` 必須在**使用者手勢的同步呼叫鏈內**觸發。

**實作定案（Phase 6）：進入備份頁時就把 CSV 與 zip 都組好**，按鈕只負責呼叫 `saveFile(預先組好的 File)`。若等按下去才 `await` 組檔，同步鏈已經斷掉，iOS 會擋下分享。匯入或還原完成後重新組一次；一開始重組就作廢舊檔，組檔失敗的那個檔按鈕停用，不會匯出重組前的資料（prepare-files，2026-10-29）。

`AbortError` 代表使用者自己取消，回傳 `'cancelled'` 而非當成失敗；其他錯誤（不支援、權限）則退回 `<a download>`，確保使用者總是拿得到檔案。

#### 備份檔格式（Phase 6 補定）

```
dailyspend-backup-YYYY-MM-DD.zip
├── manifest.json        formatVersion / createdAt / counts
├── data.json            records · categories · rules · settings · 照片中繼資料
└── photos/
    ├── <id>.bin         原圖位元組
    └── <id>.thumb.bin   縮圖位元組
```

照片的二進位內容不塞進 JSON：base64 會膨脹 33%，而照片本身已是 JPEG，再壓也沒有意義。`data.json` 只留中繼資料與 MIME type。

**版本檢查**：`manifest.formatVersion` 大於 App 支援的版本時直接擋下並要求更新，不嘗試解讀未知格式。

**照片遺失不擋還原**：zip 裡少了某張照片的位元組時跳過該張，紀錄照常還原——紀錄比照片重要。

#### 還原強制兩步驟（Phase 6 補定）

`prepareRestore()` → 使用者確認 → `commitRestore()`。

第一步解析備份檔並**同時產出當前資料的保險備份**，第二步才覆寫。拆成兩個函式是為了讓「二次確認」與「先自動匯出一份當前備份」在 API 上就是強制的，而不是靠呼叫端自律。UI 上也鎖住順序：沒存下保險備份，「確認覆寫」按鈕是 disabled。

備份檔有問題時在第一步就失敗，既有資料完全沒被碰過。

#### 不可把 Vue 深層響應式物件寫進 IndexedDB（Phase 6 真機抓到）

```
ref(data).value   → Proxy → structuredClone 丟 DataCloneError
reactive(data)    → Proxy → 同上
shallowRef(data).value → 原物件 → OK
```

IndexedDB 的寫入走 structured clone，而 **Proxy 不可複製**。把待還原的資料放進
`ref()` 會讓裡面每一筆紀錄都變成 Proxy，`tx.put()` 直接拋 `DataCloneError`。

**規則：任何「之後要寫回資料庫」的資料，一律用 `shallowRef` 或 `toRaw`，不用 `ref`/`reactive`。**

這個 bug 在 Vitest 抓不到——fake-indexeddb 的 structured clone 實作會接受 Proxy，
只有真瀏覽器會拒絕。因此 adapter 另外把 `DataCloneError` 轉成
`StorageSerializationError` 並在訊息裡直接點名這個原因。

### 11.2 備份提醒

- 首次啟動呼叫 `navigator.storage.persist()`，結果存入 `settings.platform.persistGranted`，並顯示在設定頁（讓使用者知道自己的資料處於什麼保護等級）
- `Date.now() - settings.backup.lastBackupAt > settings.backup.remindAfterDays (7) × 86400000` → 首頁顯示提醒橫幅，~~可一鍵匯出~~ 點橫幅進備份頁匯出（iOS 的 `navigator.share` 必須在使用者手勢內同步呼叫，首頁一鍵匯出得在每次進記帳頁時預先組整份 zip；backup-reminder，2026-10-18，使用者委託 chris 判定）
- 從未備份過且紀錄數 ≥ 20 → 同樣顯示

### 11.3 載具 CSV 匯入：發票存摺格式（C1 補定，2026-10-13）

只支援「發票存摺」App 匯出的 CSV。財政部官方格式等拿到樣本再做（§12 #2 的原則）。這一節是 parser（`src/parsing/carrierCsv.ts`）的規格；寫入、去重與合併規則在 C2 補進 §7。

**檔案格式**

- 編碼 UTF-8，可有 BOM；換行 `\n` 或 `\r\n`。
- 逗號分隔，RFC 4180 引號規則：含逗號、引號、換行的欄位用 `"` 包住，引號本身寫成 `""`。
- 表頭必須完全一致（每格去頭尾空白後比對）：
  `消費時間,發票號碼,店家名稱,賣方統編,消費品項,單價,個數,小計,總計,備註`
- 一列一個品項。同一張發票的「消費時間、店家名稱、賣方統編」每列重複；依發票號碼分組，不要求列連續。
- 「總計」整張發票只能有一格有值（樣本裡都在第一列）。

**欄位對應（CSV → `CarrierInvoice`）**

| CSV | 欄位 | 規則 |
|---|---|---|
| 消費時間 | `date` | 只接受 `YYYY/MM/DD HH:MM:SS`，轉成 `YYYY-MM-DD`，時間捨棄 |
| 發票號碼 | `invoiceNumber` | 只去頭尾空白；正規化與 `invoiceKey` 一律由寫入路徑的 `prepareRecord` 產生 |
| 店家名稱 | `merchant` | 原樣（公司登記全名，可能含全形數字） |
| 賣方統編 | `sellerTaxId` | 原樣 |
| 消費品項 | `items[].name` | 原樣，不轉半形 |
| 個數 | `items[].qty` | 非負小數，`Number()` 轉換，不四捨五入（加油的公升數帶浮點雜訊，例如 `36.27000000000000512`） |
| 小計 | `items[].amount` | 整數，可以是負數（折扣、回饋金）或 0（套餐附餐） |
| 總計 | `total` | 正整數。**以總計為準**：和小計加總不同是正常的（品項未稅、折扣沒列成品項） |
| 備註 | `note` | 去重後以換行串接 |
| 單價 | — | **不讀**：沒有讀取點，語意也不一致（單價 0 而小計 -14）。原值留在 `rawRows` |

**拒收**

整份拒收（`ok: false`）：

| 代號 | 條件 |
|---|---|
| `header_mismatch` | 表頭不符、空檔案 |
| `malformed` | 引號沒關、某列欄數不是 10。欄位可能錯位，連「這列屬於哪張發票」都不可信。附列號 |

單張拒收（只有那張發票進 `rejected`，附發票號碼與列號，同檔其他張照常匯入）。每張只回報第一個失敗原因，檢查順序如下：

| 代號 | 條件 |
|---|---|
| `number_missing` | 發票號碼空白（無法分組，逐列各一筆） |
| `rows_inconsistent` | 同號碼的列，消費時間、店家或統編不一致（不替資料選邊） |
| `date_invalid` | 消費時間格式不符或日期不存在 |
| `total_missing` | 總計全部空白。**不用小計加總頂替** |
| `total_ambiguous` | 超過一格總計 |
| `total_invalid` | 總計不是非負整數（例如 `1,500`、`12.5`） |
| `total_zero` | 總計為 0，和沒有記載同等對待（同 B0.1） |
| `item_name_missing`／`qty_invalid`／`subtotal_invalid` | 品項**逐列**檢查，每列依序看品名空白、個數不是非負小數、小計不是整數，回報第一個遇到的原因。`item_name_missing` 的觸發點：真實資料出現沒有明細的發票時，重新評估要不要改收成 `items: []` |

這個順序是契約（有測試鎖住）：C2 的預覽顯示哪個原因取決於它。原因用代號，中文文案集中在匯入頁（C2）。

#### 匯入流程（C2a／C2b 補定，2026-10-14）

入口在備份頁「匯入載具 CSV」（匯出與還原之間）。儲存層初始化完成前不能選檔（規則還沒載入的話，每一筆都會分不出類別）。

1. **預覽**（`prepareCarrierImport`，只讀）：每張發票分成
   - 新增：沒有同 `invoiceKey` 的紀錄，也沒有候選
   - 合併：有同 `invoiceKey` 的紀錄，合併後會改變它（品項依 §7.3 整份替換、衝突照樣標 `duplicate_conflict`）
   - 已存在：有同 `invoiceKey` 的紀錄，合併後除了 `updatedAt` 完全相同 → 不寫入
   - 可能重複：沒有同 key，但有同日同額、`invoiceKey = null` 的紀錄（§7.1 例外）
   - 無法匯入：parser 拒收的發票（原因與列號）

   預覽就算好每一筆最終要寫入的紀錄，含分類。合併時 incoming 不帶分類，只有品項變了（`needsReclassify`）才重跑，所以重新匯入同一份是冪等的。
2. **選擇**：每張可能重複的發票預設「兩筆都留」；可改成「合併到」某個候選，一個候選只能被一張發票選走。選了兩筆都留之後，CSV 那筆有了 `invoiceKey`，再匯入同一份會變成「已存在」，不會再問；要合併只能手動刪掉其中一筆。
3. **寫入**（`commitCarrierImport`）：單一 transaction，含規則命中次數。寫入前檢查預覽之後資料沒有變動（既有紀錄的 `updatedAt`、新的 `invoiceKey` 沒被別筆用掉、候選集合沒變），有變動就整批中止，請使用者重新預覽。
4. **寫入後**：`initStorage()`（筆數、備份提醒）→ 重組匯出檔 → 重載紀錄快取（待確認紅點）。

---

## 12. 待決事項

| # | 項目 | 狀態 | 需要 |
|---|---|---|---|
| 1 | 發票 QR 樣本（實拍照片 3–5 張 + 去識別化原始文字） | **部分到位**：1 張實拍已解出兩個碼，§5.2 選型定案 | 還缺原始文字，阻擋 §5 欄位切法 |
| 2 | 載具明細樣本一份 | **已到位（2026-10-13，發票存摺 App 匯出）** | 欄位對應見 §11.3 |
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
| 實拍照片 3–5 張（不同角度、光線） | §5.2 library 選型，測「單張圖兩個 QR」的偵測成功率與耗時 ✅ **已完成**（1 張即定案） |
| QR 原始文字（去識別化） | §5 欄位切法、品項編碼與取得率、§7.1 `invoiceKey` 最終確認 ~~⏳ **仍缺**~~ ✅ 欄位切法已實作；`invoiceKey` 2026-10-14 確認；編碼目前只遇過 UTF-8（B8，2026-10-22） |

原始文字現在不必另外提供：`/qr-lab`（§5.2.2）已經能把 payload 原封不動列出來並複製。

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

iOS Safari 無原生 `BarcodeDetector`。見 §5.1 / §5.2。選型條件是「單張圖多碼偵測」。

**定案 `zxing-wasm`（2026-10-11）**：合成圖與真實照片都只有它能一次解到並排的
兩個碼，`jsQR` 的「全圖」兩種情況都是 0。`jsQR` 已移除。

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
| ~~**1**~~ ✅ | 專案骨架、PWA manifest、service worker、**部署到靜態主機**、standalone 偵測與安裝引導頁 | 在 iPhone 上完成「加到主畫面」並看到引導頁正確切換 | 真機 |
| ~~**2**~~ ✅ | `StoragePort` + `IndexedDbAdapter`、schema v1、sparse unique index 測試 | 真機驗證 Blob 寫入/讀回、`persist()` 回傳值 | 真機 + Vitest |
| ~~**3**~~ ✅ | `parseQuickInput`（含 §4.3 純數字保護） | §4.2 回測表全過，20 筆 ≥ 95% | Vitest |
| ~~**4**~~ ✅ | `RuleClassifier` + 規則 CRUD + §6.2 修正學習 | 單元測試涵蓋 §6.1 五條分支與 §6.2 四種情境 | Vitest |
| ~~**5**~~ ✅ | `buildInvoiceKey` + dedupe/merge | 同 key 重複寫入後筆數為 1，欄位依 §7.3 合併 | Vitest |
| ~~**6**~~ ✅ | **備份 / CSV 匯出 / 還原（Web Share）** | 真機完成一次「匯出 → 存到檔案 App → 還原」完整來回 | 真機 |
| ~~**7**~~ ✅ | 最小 UI：快速輸入、列表、待確認佇列 | 開始每日真實記帳 | 真機 |
| ~~**8**~~ ✅ | 分析（§8 四條規則 + 冷啟動 + 建議排序） | 每條結論都附得出 evidence | 真機 |
| **9** | QR 辨識（含 §5.2 library 實測選型） | 20 張真實發票，號碼/日期/金額 100% | 真機 |

Phase 3–5 是純邏輯，不受平台影響，可全速在電腦上開發。

### 真機驗收紀錄

| Phase | 日期 | 結果 |
|---|---|---|
| 1 | 2026-10-05 | 通過。安裝閘門正確擋住 Safari 分頁；主畫面 App 判定為 standalone（`navigator.standalone` 偵測在 iOS 上有效）；service worker 可用 |
| 2 | 2026-10-05 | 通過。schema v1 開啟成功、12 個內建類別就位、`navigator.storage.persist()` **回傳 true**、Blob 往返位元組一致且 MIME 保留 |
| 3 | 2026-10-08 | 通過（Vitest，不需真機）。§4.2 回測表 6 條全過，20 筆語料庫 20/20 = 100%，總計 52 個剖析測試 |
| 4 | 2026-10-08 | 通過（Vitest，不需真機）。§6.1 五條分支、§6.2 四種情境、規則 CRUD 與優先序各有測試，共 42 個，專案總計 109 個 |
| 5 | 2026-10-09 | 通過（Vitest，不需真機）。同發票重複寫入後筆數為 1、載具匯入去重後重複筆數 0、跨年度同號碼視為兩筆、合併時不留孤兒照片。共 35 個，專案總計 144 個 |
| 6 | 2026-10-09 | 通過。iPhone 上完成「匯出 → 存到檔案 App → 選回該檔 → 還原」完整來回。**首次嘗試失敗**：還原按下去毫無反應，原因是 Vue 深層響應式 Proxy 無法被 structured clone（見 §11.3），修正後通過。Vitest 26 個，專案總計 172 個 |
| 7 | 2026-10-09 | 通過。記帳 → 待確認 → 修正 → 同品項再記一次直接分對，整條修正學習迴路在真機上成立；多品項整筆改分類確實展開逐項指定面板。Vitest 15 個，專案總計 187 個 |
| 8 | 2026-10-09 | 通過。資料量不足時顯示冷啟動提示而非空白；門檻即時調整會重算並保留。Vitest 27 個，專案總計 214 個。**門檻參數仍是憑常識設的預設值**，需要累積真實資料後回頭校準 |
| 編輯/刪除（§10.1） | 2026-10-09 | 通過。Vitest 10 個，專案總計 224 個 |
| 工程基礎（§15.1） | 2026-10-09 | 通過。全域錯誤處理上線後「未處理錯誤 0 筆」；ESLint 的 no-floating-promises 已實測可擋 Phase 6 那種 bug。Vitest 9 個，專案總計 249 個 |
| 9a 拍照管線 | — | **待驗收**：附照片、照片方向是否正確、用量是否增加 |

> `persist()` 在 iOS 上取得授權，代表 IndexedDB 不會因閒置被清除。這降低了資料遺失風險，但**不改變 §14 把備份排在 Phase 6 的決定**——持久化防不了使用者刪除 App、換機、或 iOS 在儲存空間不足時的回收。

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

## 15.1 工程基礎

### 全域錯誤處理

`app.config.errorHandler` + `unhandledrejection` + `window.error`，~~漏網的錯誤跳紅色橫幅並留在設定頁（最近 20 筆）~~ 漏網的錯誤，以及頁面接住但不在預期內的錯誤，都跳紅色橫幅並留在設定頁「非預期的錯誤」（最近 20 筆）（B5a，2026-10-15，使用者同意）。

**分工（B5a）**：頁面的 catch 一律交給 `handleError(err, { where, failed, conflict? })`（`src/errors/handleError.ts`），預期／非預期的分類只在這一處：

- 預期錯誤——使用者操作或資料本身造成的：`ValidationError`、`BackupFormatError`、`CarrierImportStaleError`，以及呼叫端有給 `conflict` 的 records 撞號（`by_invoiceKey`）。頁面顯示「情境：原因」，不回報。
- 非預期錯誤——其他全部：`reportError` 進錯誤紀錄（含 stack 與 `where`）並跳橫幅；頁面只顯示「情境。已記錄錯誤，可到設定頁的『非預期的錯誤』查看」，不顯示原文。
- 撞號的意思由呼叫端決定：同一個 unique index 在「改日期」是撞到另一張發票，在「還原」是備份檔本身有重複。
- `initStorage` 是例外：它沒有頁面情境句，失敗時直接 `reportError`，環境檢查「資料庫」那格照舊顯示原文（那格是診斷欄位）（B5b，2026-10-16 使用者同意）。
- 業務錯誤仍以例外表達，不改成回傳值（偏離 DECISIONS D3「業務結果走回傳值」字面，B5 使用者同意）。
- 「資料未變更」這類情境句是 transaction 回滾才成立的保證，所以頁面還是要接住錯誤講情境，不直接交給全域。

**iPhone 上沒有 console**，錯誤必須留在 App 裡才除得了錯。這是安全網不是替代品——能在 handler 裡處理的仍然要在那裡處理，因為只有那裡知道該顯示什麼訊息。

### ESLint

目的不是統一風格，是抓 bug。核心三條是型別感知規則：`no-floating-promises`、`no-misused-promises`、`await-thenable`。第一條正是 Phase 6「還原按鈕沒反應」的成因，已實測可擋。

刻意關掉的兩條與理由寫在 `eslint.config.js` 的註解裡，摘要：`no-unnecessary-condition` 會跟防禦舊版 Safari 的瀏覽器 API 判斷打架；`no-non-null-assertion` 在 `noUncheckedIndexedAccess` 下是慣用寫法。留著只會產生 32 個警告，訓練人忽略整份輸出。

CI 的順序是 `lint → test → build → deploy`。

---

## 16. 不在 v1 的清單（避免範圍漂移）

OCR、AI 分類、~~載具匯入~~（發票存摺 CSV 已做，見 §11.3；財政部官方格式仍在範圍外）、銀行串接、多人、多幣別、預算上限提醒、圖表以外的報表、跨裝置同步、多品項金額對應剖析、品項模糊比對、店家名稱同義詞合併、刪除規則時回溯套用、即時鏡頭掃描、月對月比較的 `completedMonthsOnly` 模式。
