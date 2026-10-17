# DailySpend 進度交接

> 最後更新：2026-10-12
> 四份文件的分工：
> - [README.md](./README.md) — 這專案是什麼、怎麼跑起來
> - **這份** — 開發進度（按 Phase）、驗收結果、踩過的坑
> - [FEATURES.md](./FEATURES.md) — 做了哪些功能（按功能）、未完成項目
> - [design.md](./design.md) — 設計決策與理由

---

## 現況

**v1 功能全部完成，Phase 1–9 的程式都已寫完並通過真機驗收**，站台上線中，
287 個測試、lint 乾淨。最後一塊（拍發票自動帶入品項）於 2026-10-11 完成。

接下來**不需要再寫新功能**，需要的是用真實資料驗收與校準：Phase 9b 的欄位
解析只被一張不合規的發票走過，分析門檻也還是憑常識設的預設值。

### 狀態總表

| # | 項目 | 狀態 | 真機驗收 | 還缺什麼 |
|---|---|---|---|---|
| 1 | PWA 骨架與安裝閘門 | ✅ | ✅ | — |
| 2 | 儲存層（IndexedDB） | ✅ | ✅ | — |
| 3 | 快速輸入切詞 | ✅ | ✅ | — |
| 4 | 規則分類與修正學習 | ✅ | ✅ | — |
| 5 | 去重鍵與合併 | ✅ | ✅ | 2026-10-14 載具匯入真機驗收：QR 紀錄＋同一張 CSV → 1 筆 |
| 6 | 備份 / CSV / 還原 | ✅ | ✅ | — |
| 7 | 最小 UI | ✅ | ✅ | — |
| 8 | 分析 | ✅ | ✅ | 兩三週真實資料校準門檻 |
| 8+ | 編輯 / 刪除紀錄 | ✅ | ✅ | — |
| 9a | 拍照管線 | ✅ | ✅ | — |
| 9a+ | 發票樣本蒐集 | ✅ | ✅ | — |
| 9b-1 | QR library 選型 | ✅ | ✅ | — |
| 9b-2 | 欄位解析 + 接進記帳 | ✅ | ✅ | 合規發票已在記一筆解出品項；存檔路徑的 `invoiceKey` 在 2026-10-14 載具匯入驗收時確認能和 CSV 合併 |
| 9b-3 | 驗收：20 張真實發票 100% | ⏳ | — | 20 張實拍 |
| B1 | 頁面測試基礎設施 | ✅ | — | 5 個 view 層 bug 以 `it.fails` 標記，等 B3 修 |
| B2 | 日期／品項／多張發票／還原的資料修正 | ✅ | ✅ | 真機上「還原寫到一半失敗」的回滾未驗（接受的風險） |
| B2.1 | 發票品項的小數數量／單價 | ✅ | ✅ | — |
| B0 | 移除依中文編碼參數產生的錯誤提示 | ✅ | —，由單元測試涵蓋 | — |
| B0.1 | 表頭總計額 0 視為沒有記載，請使用者輸入金額 | ✅ | —，由單元測試與頁面測試涵蓋 | — |
| B3a | 編輯頁：含空白品名被拆開、清空金額存成 $0、其他動作蓋掉未存的修改 | ✅ | ✅ | — |
| B3b | 記一筆頁：讀到發票只剩一條存檔路徑、讀取中鎖定、讀不到時有提示、無表頭要填日期 | ✅ | ✅ | — |
| B4 | design.md §5.4 規格與實作一致（D2a、D2b、D2c，以及「部分成功」條） | ✅ | —，由單元測試涵蓋 | — |
| C1 | 載具 CSV（發票存摺格式）parser | ✅ | —，由單元測試涵蓋（沒有畫面） | 寫入與匯入頁在 C2 |
| C1.5 | 重複購買排除 ≤ 0 的品項、次數以紀錄計 | ✅ | —，由單元測試涵蓋（沒有畫面） | — |
| C2a | 載具匯入的預覽與一次寫入（service 層） | ✅ | —，由單元測試涵蓋（沒有畫面） | — |
| C2b | 備份頁的載具 CSV 匯入 | ✅ | ✅ | 2026-10-14 真機驗收 12 項全過 |
| B4.1 | 店家與發票日期補好後，待確認原因自動解除 | ✅ | ✅ | 2026-10-14 真機：新建缺店家紀錄，編輯補上店家與品項後離開待確認頁 |
| B4.2a | 待確認卡分成「確認」與「確認並記住規則」 | ✅ | ✅ | 2026-10-14 真機 3 項全過：多品項改類別卡片不消失、記住後逐項指定並完成確認、只按「確認」不學規則、「確認並記住」出現「已記住」且設定頁看得到 |
| B4.2b-1 | 待確認卡顯示原始輸入與照片縮圖 | ✅ | ✅ | 2026-10-15 真機 6 項全過：原始輸入照原字顯示、附照片的卡有縮圖、確認一張不影響其他縮圖、載具／QR 卡不顯示原始輸入、切分頁回來縮圖照常、既有確認／記住／逐項／刪除不變 |
| B4.2b-2 | 待確認卡就地編輯欄位，確認時和類別、規則一起寫入 | ✅ | ✅ | 2026-10-15 真機 8 項全過：完成修改不寫入、補店家不自動離開、改店家重分類、改品項後逐項指定、放棄修改、取消修改、金額空白擋下、編輯頁照舊 |
| B5a | 錯誤處理分工：非預期錯誤一定進錯誤紀錄 | ✅ | ✅ | 2026-10-16 真機驗收通過：預期錯誤顯示「情境：原因」不跳橫幅、還原壞檔「讀取失敗：…」、照片處理失敗跳「發生非預期的錯誤」並留在設定頁、設定頁文案、一般操作不受影響 |
| B5b | 設定頁、分析頁與儲存層初始化的錯誤分工，修好照片壓縮存不進去 | ✅ | ✅ | 2026-10-16 真機驗收通過：照片壓縮兩欄都存得住、改參數後 QR 仍讀得到、設定頁規則／樣本操作與分析頁門檻不跳橫幅、環境檢查正常 |
| settings-write | settings 寫入讀新鮮值，分析頁寫入成功才更新畫面 | ✅ | ✅ | 2026-10-17 真機驗收通過：分析頁改門檻後重新進頁仍保留、設定頁快速連改照片壓縮三欄重新進頁都保留、備份後「上次備份」更新 |
| B6a | 分析門檻合法範圍、無效輸入提示、修回已存的壞值 | ✅ | ✅ | 2026-10-17 真機驗收通過：分析頁正常打開、清空最少連續月數出現範圍提示且值不變不跳橫幅、建議條數 0 被擋、增幅門檻 0 存得進去、其他門檻照常保留 |

---

## 重要連結

| 項目 | 位置 |
|---|---|
| 線上站台 | https://kennethyc12.github.io/dailyspend/ |
| Repo | https://github.com/kennethyc12/dailyspend |
| CI | https://github.com/kennethyc12/dailyspend/actions |

iPhone 上要從**主畫面圖示**開啟，不要用 Safari 分頁（App 會擋住，這是刻意的，見 design.md §13.1）。

---

## 已完成

### Phase 1 — PWA 骨架與安裝閘門 ✅

- Vite + Vue 3 + TypeScript + vue-router（hash 模式）
- `vite-plugin-pwa`：manifest、service worker、更新提示橫幅
- standalone 偵測與安裝引導頁，非 standalone 時完全擋住功能
- GitHub Actions 自動部署到 GitHub Pages

**真機驗收通過**：安裝閘門正確擋住 Safari 分頁、主畫面 App 判定為 standalone、service worker 可用。

### Phase 2 — 儲存層 ✅

- `StoragePort` 介面，簽章不含任何 IndexedDB 型別
- `IndexedDbAdapter` 實作
- schema v1：5 個 store，`records` 含 `by_invoiceKey` unique sparse index
- 12 個內建類別 + settings 門檻值，首次開啟 seed
- **15 個測試全過**

**真機驗收通過**：資料庫開啟成功、12 個類別就位、`persist()` 回傳 **true**、Blob 往返位元組一致且 MIME 保留。

### Phase 3 — 快速輸入切詞 ✅

- `parseQuickInput`：金額由後往前取最後一個數字 token、店家取首 token、
  中間為品項、日期前綴選配
- §4.3 純數字 token 保護：中間出現 `55` 時移除並轉待確認，不產生名叫「55」的品項
- 全半形正規化、店家字典比對（不分大小寫）
- **52 個剖析測試全過**，20 筆語料庫 20/20 = 100%（門檻 95%）

**抓到一個真 bug**：`7-11` 原本被當成「7 月 11 日」吃掉。日期前綴的比對改成不對稱——
斜線允許單位數（`10/3`），破折號要求補零兩位（`09-28`），所以 `7-11` 是店家。
已納入回測語料庫。

### Phase 4 — 規則分類與修正學習 ✅

- `RuleClassifier` 實作 `ClassifierPort`，§6.1 五條分支齊備
- 規則優先序：itemKeyword/userCorrection 400 → merchant/builtin 100，
  同層再比 pattern 長度、createdAt
- `planCorrection` 實作 §6.2 四種情境，**多品項改整筆時不自動學品項規則**
- 規則 CRUD：builtin 只能停用、userCorrection 可刪、`recordHits` 累計命中
- 64 條內建規則（51 品項 + 13 店家），**刻意不含超商與量販店**（§3.3）
- **42 個測試全過**

補定了四處 v0.2 的規格缺口，都寫回 design.md：`Rule.isActive`、
「全部命中但類別分歧」歸入多數決、ambiguous 判定要看 priority、
`ClassifyOutput` 加 `pendingReasons`。

### Phase 5 — 去重鍵與合併 ✅

- `buildInvoiceKey`：民國年 + 期別起始月 + 號碼，例如 `11509-AB12345678`。
  **唯一的產生點**，因為它是 unique index 的 key
- `mergeRecords`：§7.3 欄位級合併，另回報 `discardedPhotoId` /
  `needsReclassify` / `conflicts`
- `saveRecord`：§7.2 寫入判斷，`ConstraintError` 作為最後防線會重讀再合併
- **35 個測試全過**，含「載具匯入去重後重複筆數 0」與「跨年度同號碼視為兩筆」

補定三處規格缺口：號碼格式不做嚴格驗證（樣本未到）、§7.3 第一列的矛盾、
`user` 優先序只適用於 `categoryId`。

### Phase 6 — 備份 / CSV 匯出 / 還原 ✅

- CSV 匯出：UTF-8 with BOM、欄位依 §11、支援日期區間
- 完整備份 zip：`manifest.json` + `data.json` + `photos/<id>.bin`
- 還原**強制兩步驟**：`prepareRestore()` 會一併產出當前資料的保險備份，
  存下它之前「確認覆寫」按鈕是 disabled
- Web Share 優先，`AbortError` 視為取消而非失敗，其他錯誤退回 `<a download>`
- 7 天備份提醒；從未備份時累積到 20 筆才開始提醒
- `StoragePort` 補上 `clear()`
- **26 個測試全過**，含完整來回（匯出 → 清空資料庫 → 還原後照片位元組一致）

**iOS 限制的處理**：`navigator.share` 必須在使用者手勢的同步呼叫鏈內，
所以進入備份頁時就把 CSV 與 zip 都組好，按鈕只負責呼叫。等按下去才 await
組檔會讓 iOS 擋掉分享。

**真機抓到一個 Vitest 抓不到的 bug**：還原按下去完全沒反應。原因是
`restorePreview` 放在 `ref()` 裡，深層代理把每筆 record 變成 Proxy，
而 IndexedDB 的 structured clone 不接受 Proxy。fake-indexeddb 的實作會
接受，所以單元測試全綠。改用 `shallowRef` 並補上錯誤顯示後通過。

### Phase 7 — 最小 UI ✅

- 四個分頁：記帳 / 紀錄 / 待確認（紅點數字）/ 設定
- `entryService.createFromText`：把 §9 的流程串成一條
  （剖析 → 分類 → 去重 → 存檔 → 累計規則命中）
- 待確認頁逐條列出所有 `pendingReasons`；多品項改整筆時就地展開逐項指定面板
- 設定頁有規則清單（§6.3），可停用內建、刪除修正學來的規則
- **15 個新測試**，涵蓋整條 pipeline 與 §6.2 在真實流程中的四種情境

**第一次啟動要鎖住輸入**：seed 沒跑完就送出會拿到空規則集，每筆都變待確認。
輸入框在 `initStorage()` 完成前是 disabled。

**真機驗收通過**：記帳 → 待確認 → 修正 → 同品項再記一次直接分對，
整條修正學習迴路成立。

所有 async handler 都有 try/catch 並顯示錯誤——Phase 6 的教訓。

### Phase 8 — 分析 ✅

- 四條規則：高頻小額、訂閱與固定支出、月對月暴增、同類重複購買
- 全部換算成「每月等值金額」才排序，不同性質的支出因此可以互相比較（§8.3）
- 冷啟動：資料不足時顯示「還需 N 天 / 再記 N 筆」，分析頁永遠有內容
- 門檻可在分析頁即時調整並重算，設定會存回 settings
- 每條結論都附 `evidence.recordIds`，有測試斷言不得為空
- **27 個測試全過**

補定四處規格缺口（design.md §8.5）：訂閱的連續月份改用「最長連續區段且仍在進行」、
上期為 0 時視為新增支出、「上月有紀錄」指整月而非同期、
重複購買的品項金額用單據總額分攤並標記為估算。

**真機驗收通過**。但門檻參數仍是憑常識設的預設值，需要真實資料回頭校準。

### Phase 8 之後：編輯 / 刪除紀錄 ✅

原本的 Phase 拆分漏了這塊——待確認佇列只處理 pending 的紀錄，一旦確認就
改不動，打錯金額的唯一補救是還原備份。

- 紀錄頁點任一筆進入編輯頁：日期、店家、金額、品項、備註、類別皆可改，可刪除
- 店家或品項變動時重跑分類，但使用者指定過的類別不動（與 §7.3 同一原則）
- 改日期會重算 `invoiceKey`，維持「唯一產生點」的保證
- 金額限制為非負整數，日期限制 `YYYY-MM-DD`
- **10 個新測試**

**真機驗收通過**（2026-10-09）。

### Phase 9a — 拍照管線 ✅

Phase 9 拆成兩半，不依賴樣本的先做。

- 記帳時可附發票照片，編輯頁可更換/移除，列表顯示 📷 標記
- `compressPhoto()`：長邊縮放 + JPEG，產出原圖與縮圖
- **壓縮參數做成可調**（設定頁），因為壓太狠可能讓 QR 解不出來，待實測
- `settings` 新增欄位時自動補鍵（`migrateSettings`），不必寫 migration
- **16 個新測試**

兩個刻意的決定：附照片**不會**把 `sourceType` 改成 `'photo'`（照片只是證據，
金額仍是手打的，不該升級 merge 優先序）；EXIF 方向必須套用，否則 iPhone
拍的照片會躺著存進去。

**真機驗收通過**（2026-10-11，與樣本蒐集一起驗）。

### Phase 9a 之後：發票樣本蒐集 ✅

Phase 9a 留下一個洞：照片只能附在「有金額的紀錄」上，所以想單純蒐集 QR
樣本時反而存不了檔——而樣本正是 Phase 9b 唯一的阻塞項。

- **只存成樣本**（記一筆頁的照片預覽區）：照片寫進 `photos` store，不建紀錄
- 樣本的定義是「沒有任何紀錄的 `photoId` 指向它」。不加旗標是因為
  `removePhoto` 與 `deleteRecord` 都會連帶刪照片，孤兒照片只從這條路徑產生；
  樣本之後被附到紀錄上也會自動從清單消失。不動 schema、不用 migration
- 設定頁新增「發票樣本」清單：縮圖、拍攝時間、尺寸與大小，可刪除
- 拍照入口改成兩個 input：帶 `capture="environment"` 的直開相機，不帶的才跳
  相簿。iOS 上只要有 `capture` 就**只給相機、沒有相簿選項**，所以必須分兩個
- **4 個新測試**

備份 zip 本來就會帶出所有 `photos`，樣本不需要額外的匯出路徑，原檔在
`photos/<id>.bin`。

已知限制：從相簿選舊照片時 `capturedAt` 是匯入時間，不是拍攝時間——
`compressPhoto` 用 `Date.now()`，EXIF 時間在 `createImageBitmap` 之後拿不到。

**真機驗收通過**（2026-10-11）：照片方向正確、相簿來源可選、列表出現 📷、
設定頁看得到樣本、用量有增加。

### Phase 9b — QR 辨識 ✅ 程式完成（待真實發票驗收）

§5.2 的判準是「能不能一次拿到一張圖裡的左右兩個 QR」。兩套都裝起來實測，
**定案 zxing-wasm 3.1.5，jsQR 已移除。**

合成圖（zxing writer 產的並排雙碼）先驗能力，再用真實發票照片驗成功率與耗時：

| 壓縮設定 | 大小 | zxing | jsQR（全圖 / 左 / 右） |
|---|---|---|---|
| 樣本存檔版 | 232 KB | **2 個** · 41 ms | 2 個（0 / 1 / 1）· 183 ms |
| 1600px / q0.8（現行預設） | 232 KB | **2 個** · 15 ms | 2 個（0 / 1 / 1）· 141 ms |
| 1600px / q0.6 | 167 KB | **2 個** · 12 ms | 2 個（0 / 1 / 1）· 120 ms |
| 1200px / q0.8 | 158 KB | **2 個** · 8 ms | 2 個（0 / 1 / 1）· 64 ms |

jsQR 比文件原本的假設更差：不是「單張單碼、取第一個就好」，而是兩碼並排時
locator 被另一半干擾、整張失敗——合成圖與真實照片都是 0。它非切圖不可，而
切分點正是想避免的不確定性來源。zxing 還全面較快，最慢一次仍快於 jsQR 最快
一次，即使 zxing 的耗時含 JPEG 解圖、jsQR 的不含。

**順帶解除一個風險**：現行壓縮預設（1600px / q0.8）解得動，§5.2.1 標記
「沒驗證過」的那條可以劃掉，預設不動。

- `src/recognize/qrDetect.ts`：偵測本體，**不是** `RecognizerPort` 實作
- `/qr-lab`（設定頁 →「發票樣本」→ 連結）：四種壓縮設定各跑一次，列出碼數、
  耗時、payload 的文字/hex/Big5。選型定案後留著，因為欄位切法要看真實 payload
- **5 個測試**，合成圖的斷言在 `qrDetect.test.ts`，不是一次性手測
- 路由 lazy 載入，主 bundle 沒變大（151 kB）；wasm 950 KB 進 precache，
  安裝時多下載約 1.2 MB——離線解不了碼的話這個 App 的前提就破了

兩個量測瑕疵記著：表格第一列不是相機原圖（樣本存檔前已壓過），wasm 載入顯示
2 ms 是模組已在記憶體的數字。樣本數 1 張——再多拍只會修正成功率，不會翻盤。

**第 ④⑤ 步已完成（2026-10-11）**：拍照或選相簿後自動讀 QR，讀到就把品項帶進
記一筆頁，補上店家（與金額）即可存檔，走的是跟手輸同一條去重與分類路徑。

- `einvoicePayload.ts`：結構判別 + `parseEInvoicePayload()`（合併左右 payload、
  跳過表頭後的四個中繼欄位、容忍湊不成三元組的尾巴並留下說明）
- `invoiceService.ts`：`createFromInvoice()`，§5.4 的失敗處理都在這裡
- 記一筆頁新增發票面板；wasm 在進頁時背景暖機（冷啟動 1 秒，實機實測）
- **29 個新測試**

**金額只採信左方 QR 的總計額**，不從品項加總推算。品項第三欄的語意與證據見
design.md §5.3。沒有總計額時由使用者輸入，沒填就不給存。

**還缺的**：2026-10-12 起已有合規左方 QR 的實拍樣本，號碼、日期、總計額都解析正確；
但從照片**存檔**的路徑還沒用合規發票走過，§7.1 的 `invoiceKey` 也還沒在真機上驗證。

### 工程基礎：全域錯誤處理 + ESLint ✅

**全域錯誤處理**（`src/errors/`）

- `app.config.errorHandler` + `unhandledrejection` + `window.error` 三個入口
- 漏網的錯誤會跳紅色橫幅，並留在設定頁（最近 20 筆）
- iPhone 上看不到 console，所以錯誤必須留在 App 裡才除得了錯
- 這是**安全網不是替代品**：能在 handler 裡處理的仍然要在那裡處理，
  因為只有那裡知道該顯示什麼訊息
- 9 個測試

**ESLint**（`eslint.config.js`）

目的不是統一風格，是抓 bug。核心是三條型別感知規則：

| 規則 | 擋掉什麼 |
|---|---|
| `no-floating-promises` | 沒 await 也沒 catch 的 Promise → 「按鈕沒反應」 |
| `no-misused-promises` | 把 async function 傳給預期同步回呼的地方 |
| `await-thenable` | await 一個不是 Promise 的值 |

已實測：把 Phase 6 那種 bug 形狀寫進檔案，lint 確實擋下。

刻意關掉 `no-unnecessary-condition` 與 `no-non-null-assertion`——前者會跟
「防禦舊版 Safari 沒有的瀏覽器 API」打架，後者在 `noUncheckedIndexedAccess`
下是慣用寫法。32 個警告會讓人忽略整份輸出。

**順手修到一個真的**：`quickInput.ts` 的正規表示式裡是字面的全形空白
（U+3000），在原始碼中完全看不見。功能正常，但沒人看得出那是什麼。

CI 加上 `npm run lint`，`package.json` 加上 `engines: node >=22`。

**真機驗收通過**（2026-10-09）：設定頁顯示「未處理錯誤 0 筆」。

### 2026-10-12 全專案審閱後的修正（B1 / B2 / B2.1）✅

審閱找出 view 層與 parser 層多條會默默存錯資料的路徑，依嚴重度分批修。每批都在
乾淨 clone 驗證後以 `--ff-only` 推進 `main`（不開 PR）。B1 以「拿掉 `it.fails` 後
5 個都紅在目標斷言」為證據；B2、B2.1 另做突變驗證。修了什麼、
為什麼這樣決定、驗證結果都寫在各自的 commit message，這裡只記驗收。

- **B1**（`5344528`）：頁面測試基礎設施。#1 #2 #3 #4 #12a 寫成 `it.fails`，由 B3 修
- **B2**（`4e78b85`）：日期依真實月份天數驗證、不存在的日期前綴擋下、金額後的字
  併進品項、保存 `rawInput`、多張發票整張不帶入、還原前驗證備份結構
- **B2.1**（`35e5746`）：實拍合規發票的單價是 `370.0`，原本三個品項全被略過

真機驗收（2026-10-12，iPhone）：

| 項目 | 結果 |
|---|---|
| `2/29 全家 55` 被擋下（同時確認手機是新版） | ✅ |
| `全家 咖啡 55 麵包` 轉待確認、顯示新文案 | ✅ |
| `全家 咖啡 55 元` 存成已確認 | ✅ |
| `24/7` 開頭被擋下 | ✅ |
| 發票面板店家欄按 Enter | 移到 B3 驗收（白巷子讀不到 QR，沒有面板可測） |
| 還原壞掉的備份 | 由自動測試覆蓋：`backup.test.ts`「備份檔驗證」「commit 中途寫入失敗時整批回滾」、`BackupView.test.ts` 兩支；iOS 選檔流程 Phase 6 已驗 |
| B2.1：炙燒明太子那張在記一筆解出 3 個品項、沒有「略過」「湊不成」 | ✅ |

### Commit 紀錄

```
543dee4 fix(b6a): 分析門檻加上合法範圍，擋下無效輸入並修回已存的壞值
22e2cbf 記錄 settings-write 真機確認通過
8b18390 fix(settings-write): settings 寫入改在同一個 transaction 讀新鮮值，分析頁寫入成功才更新畫面
a066734 記錄 B5b 真機確認通過
a355e62 feat(b5b): 設定頁、分析頁與儲存層初始化的錯誤分工，修好照片壓縮存不進去
151bbd4 記錄 B5a 真機確認通過
b53745b feat(b5a): 錯誤處理分工，非預期錯誤一定進錯誤紀錄
a469a5c 記錄 B4.2b-2 真機確認通過
bafff7e feat(b4-2b-2): 待確認卡就地編輯欄位，確認時和類別、規則一起寫入
d597c8d 記錄 B4.2b-1 真機確認通過
7b4c827 feat(b4-2b-1): 待確認卡顯示原始輸入與照片縮圖
17cd579 記錄 B4.2a 真機確認通過
d839379 feat(b4-2a): 待確認卡分成「確認」與「確認並記住規則」
65878bc 記錄 B4.1 真機確認通過
08375ef fix(b4-1): 店家與發票日期補好後，待確認原因自動解除
1568dc2 記錄 C2b 真機驗收通過，invoiceKey 由真實資料證實
ac48e1e feat(c2b): 備份頁可以匯入發票存摺的載具 CSV
bcc8739 feat(c2a): 載具 CSV 匯入的預覽與一次寫入（service 層）
5dd9110 feat(c1-5): 重複購買不再把折扣當商品，也不把一次買多包算成多次
5ad0314 feat(c1): 解析發票存摺匯出的載具 CSV
198a024 fix(b4): 讓 design.md §5.4 的失敗處理規格與實作一致
6bf6b3c feat(b3b): 記一筆頁讀到發票後只剩一條存檔路徑，無表頭時要填日期
c20825a feat(b3a): 編輯頁不再默默改壞品項、金額與未存的修改
ea5cadf feat(b0-1): 表頭總計額是 0 時視為沒有記載，請使用者輸入金額
a89daba feat(b0): 不再依中文編碼參數向使用者斷言編碼
c5aa465 記錄 B1／B2／B2.1 真機驗收，更正品項單價的證據
35e5746 feat(b2-1): 發票品項接受小數數量／單價，容忍 payload 結尾多一個 `:`
4e78b85 feat(b1-b2-p0): B2 修正會默默存錯資料的日期、品項、發票與還原路徑
5344528 feat(b1-b2-p0): B1 頁面測試基礎設施，並把 5 個 view 層 bug 寫成 it.fails
4e9adbf 拍發票自動帶入品項：QR 解析接進記一筆
57460b6 依財政部規格判別 QR payload，讓拍到怪東西時自己說得出問題
56058ec 修正 /qr-lab 的 payload 被裁掉：break-all 擋不住重複字元
425bf8a Phase 9b: 選型定案 zxing-wasm，移除 jsQR
b7caaec Phase 9b: QR library 選型第一輪與 /qr-lab 量測工具
7e9784a 記錄拍照管線與發票樣本真機驗收通過
c338e2a 記錄發票樣本蒐集：拍照與相簿兩條來源
2f53699 發票樣本：只拍照也能存檔，拍照與相簿兩條來源
8e21488 加入 README.md
eccd46c 加入 FEATURES.md：v1 功能開發告一段落的紀錄
0907d40 記錄全域錯誤處理與 ESLint 真機驗收通過
f2df02e 加上全域錯誤處理與 ESLint
a7de182 Phase 9a: 拍照管線（QR 解析待樣本）
f6a875b 記錄編輯/刪除功能真機驗收通過
d27d4d2 補上編輯與刪除既有紀錄
3a0773f 記錄 Phase 8 真機驗收通過；v1 功能已齊
56af00b Phase 8: 分析（四條規則、冷啟動、建議排序）
88baf4d 記錄 Phase 7 真機驗收通過
4045778 Phase 7: 最小 UI（快速輸入、紀錄、待確認、設定）
a556ffb 記錄 Phase 6 真機驗收通過
482cdf4 修正還原按鈕無反應：Vue 深層響應式物件不可寫入 IndexedDB
a58546e Phase 6: 備份、CSV 匯出與還原
242f36f Phase 5: invoiceKey 與去重合併
6e46733 Phase 4: RuleClassifier、規則 CRUD 與修正學習
```

---

## 下一步：用起來，然後驗收

v1 的程式寫完了。接下來最有價值的不是寫功能，是**讓真實資料流過每一條路徑**。
按重要性排：

| # | 做什麼 | 為什麼現在做 | 做完要回填哪裡 |
|---|---|---|---|
| 1 | **每天記帳**（手輸為主） | 長出屬於自己的分類規則，待確認量會自己收斂 | — |
| 2 | **拿到紙本發票就拍** | Phase 9b 的三個假設全靠它驗（見下節） | design.md §5.2 / §5.3 |
| 3 | 累積兩三週後**校準分析門檻** | 30 天 8 次、連續 3 個月、10% 變異都是憑常識設的 | 分析頁可直接改，會存回 settings |
| 4 | 湊滿 **20 張發票**跑驗收 | §12 的驗收門檻：號碼/日期/金額 100% | PROGRESS 狀態總表 9b-3 |

### 審閱後的修正批次（接續）

| 批次 | 內容 | 交接 |
|---|---|---|
| **B0** ✅ | 依編碼參數產生的 Big5 note 移除；規格原文對照後寫進 design.md §5.3.1 | — |
| **B0.1** ✅ | 表頭總計額 `0` 視為沒有記載（境外電商固定記 `00000000`），請使用者輸入金額；規則見 design.md §5.3 | — |
| **B3a** ✅ | 編輯頁 #1 #2 #3：品項欄改為一行一個且沒改不送出、清空金額擋下（「金額不能空白」）、分類與照片動作保留未存的修改 | 真機驗收見狀態總表 |
| **B3b** ✅ | 記一筆頁：讀到可用的發票時隱藏文字框、面板自成 form（Enter = 用發票資料存檔）；讀取中鎖定；讀不到或讀取失敗時提示（含 #12b）；沒有表頭時必填日期（#5）；多張發票被拒絕改走文字框 | 真機驗收見狀態總表 |
| **B4** ✅ | §5.4 規格與實作一致：D2a 改規格（B3b 已實作）、D2b `recognition_failed` 只在 confidence 0 時設、D2c 刪掉 `amount_mismatch` 的產生點、「部分成功」條改規格 | `amount_mismatch` enum 與文案保留，供讀舊資料 |
| **C1** ✅ | 載具匯入第一批：解析發票存摺匯出的 CSV（pure function，沒有畫面、不寫入資料庫），規格見 design.md §11.3 | — |
| **C1.5** ✅ | 重複購買排除 `amount <= 0` 的品項（負數回饋金、0 元附餐），次數改成以紀錄計（同一張發票的同名列只算一次），規則見 design.md §8.5 | 既有紀錄的結論可能變少（手輸或 QR 的同名品項） |
| **C2a** ✅ | 載具匯入的 service 層：`prepareCarrierImport`（新增／合併／已存在／可能重複／無法匯入）、`planWrites`、`commitCarrierImport`（單一 transaction、過期檢查）；`mergeForWrite` 讓合併後重算 `invoiceKey`；抽出 `loadClassifier`、`applyClassification`、`bumpHits` | 匯入不走 `saveRecord`（使用者 2026-10-14 同意，偏離 design.md §7.3 末段），只共用 `mergeForWrite` |
| **C2b** ✅ | 載具匯入的畫面：備份頁「匯入載具 CSV」（選檔 → 預覽 → 逐筆選擇可能重複 → 確認）、寫入後 `initStorage`／`prepareFiles`／`refreshRecords`；文件同步（design.md §1、§3.1、§7.1–§7.3、§9、§11、§11.3、§16，FEATURES，README） | 2026-10-14 真機驗收 12 項全過 |
| **B4.1** ✅ | 狀態型原因（`missing_merchant`、`missing_invoice_date`）在 `prepareRecord` 補好就解除，`correctCategory` 也經過它；合併經過 `mergeForWrite` 一併解除；「確認」維持清空全部原因（Q4）；不做遷移（Q3）；規則見 design.md §3.7 | ~~要先決定哪些原因可自動解除~~（已決定，見 DECISIONS〈B4.1 research 後〉）。交接：已存成「有表頭沒品項」的紀錄仍帶著 `recognition_failed`，它是事件型，由「確認」清掉。~~另外 `carrierImportService.planInsert` 也會加 `missing_merchant`（第三個產生點，另兩個在 `quickInput.ts`、`invoiceService.ts`），統一時要一起收~~（B4.1 Q1 A：產生點維持三處，解除統一在 `prepareRecord`）。一次性例外：B4.1 之前就帶著過時 `missing_merchant` 的紀錄，上線後第一次重新匯入同一份 CSV 會判成「合併」（原因被解除），之後回到「已存在」 |
| **B4.2a** ✅ | 待確認卡的「確認」與「確認並記住規則」：類別改草稿、`resolvePending` 單一 transaction 寫入規則與紀錄、多品項按「記住」才展開逐項面板（修掉改分類後卡片連同面板消失的 bug） | 偏離 design.md §6.2「修正即成規則」與 §10〈實作〉，使用者同意；編輯頁維持選了就學 |
| **B4.2b-1** ✅ | 待確認卡顯示原始輸入（手輸才有）與照片縮圖（`useThumbnails`，以 `photoId` 為 key，讀取中卡片離開或頁面離開不建網址） | 「來源：載具匯入」不做（使用者 2026-10-15 決定，`sourceType` 是合併優先序）；B4.2 研究見 `research-b4-2.md`〈chris-dev 審閱與決定〉 |
| **B4.2b-2** ✅ | 待確認卡就地編輯欄位：編輯也是草稿、確認時和類別與規則同一個 transaction；拆 `updateRecordFields` 算／寫；逐項指定改草稿；`invoiceKey` 衝突訊息講人話 | 見 DECISIONS〈B4.2b research 後〉 |
| **B5a** ✅ | 錯誤處理分工（有頁面測試的四頁）：`handleError` 集中分類，預期錯誤顯示「情境：原因」，非預期錯誤回報進錯誤紀錄並跳橫幅；記一筆、待確認、編輯、備份與照片選擇器改用它；`userMessage` 由它取代；橫幅與設定頁改「非預期」語意；規則見 design.md §15.1 | 業務錯誤仍用例外（偏離 D3「業務結果走回傳值」字面，使用者同意）；錯誤紀錄寫進 IndexedDB 延後 |
| **B5b** ✅ | 錯誤處理分工（其餘）：`initStorage` 失敗回報、設定頁與分析頁的 catch 改用 `handleError`；先補設定頁、分析頁的頁面測試；併入修正「照片壓縮設定從 Phase 9a 起存不進去」（深層 ref 的巢狀 Proxy，改 `toRaw`） | 先補測試再改、併入照片壓縮修正都是使用者決定；QrLab 不做 |
| **settings-write** ✅ | 分析頁門檻樂觀更新 ticket：`updateSettings` 在單一 transaction 讀新鮮 settings 再寫（`markBackedUp` 改用它）；分析頁寫入成功才更新畫面；設定頁照片壓縮指派回傳值、不再靠 `initStorage` 重讀（刪 `toRaw`）；兩頁開頭清 `errorMsg` | 偏離 B5b「存完靠 `initStorage` 重讀」、存檔完成時會重設正在輸入的其他欄位，都是使用者同意；`initStorage` 第 37 行先讀再寫留給 B7 |
| **B6a** ✅ | 分析門檻範圍：`THRESHOLD_RANGES`（全部整數）；分析頁寫入時擋下範圍外、小數與空白並說明；`migrateSettings` 把已存的壞值夾回範圍（修好「最少連續月數存成 0 後分析頁永久打不開」，含還原進來的壞值）；規則見 design.md §8 | B6 拆成 B6a／B6b、範圍值、還原帶字串退回預設都是使用者決定；`analyze` 不改 |
| **B6b** | 分析：佐證紀錄看得到（就地展開、連到編輯頁）、編輯頁返回（觸發既有 ticket） | 見 DECISIONS〈B6 research 後〉Q4、Q5 |
| **B7** | 架構清理：`initStorage` 單一入口（含：執行中再呼叫會直接 return，`await initStorage()` 不保證重讀完成；第 37 行寫回 `persistGranted` 是不在 transaction 裡的先讀再寫，可能蓋掉剛改的門檻，可改用 `updateSettings`）、重複文案、沒在用的 port 與設定項 | 刪 `RuleClassifier`／`ClassifierPort` 偏離 design.md §6.4，要先取得同意；`invoiceKey.ts` 自己的日期 regex（有 capture group）和 `dates.ts` 的 `ISO_DATE` 重複，評估能否共用 |
| **B8** | 文件同步 | FEATURES.md:76「共 10 種」待確認原因（現在 11 種）、文件裡的測試數、design.md §3.7／§4.4 的新規則、「單價語意未定」的舊說法（FEATURES.md、`einvoicePayload.ts`、`invoiceService.ts`、`QuickInputView.vue:278-280`）、本文件「開發指令」的 CI 流程漏了 lint；編碼相關的舊說法：`FEATURES.md:136`「品項編碼已由實拍樣本確認是 UTF-8」、`design.md` §5.2.2「品項的編碼是 Base64 還是 Big5」、`design.md` §12〈#1 樣本可以延後到 Phase 9〉表格「QR 原始文字」那一列（還寫著「品項編碼…⏳ 仍缺」）、`qrDetect.ts:12` 的註解漏了 UTF-8 |

另外二十一張 ticket：
- `RecordEditView.test.ts`「略過逐項指定」在全套 `--sequence.shuffle` 下偶發失敗（chris 審 B6a 時 20 次紅 2 次；base `22e2cbf` 跑 6 次未重現，推測是既有時序問題，與 B6a 無關）。觸發點：CI 或一般執行也紅
- 設定頁照片壓縮的無效輸入靜默忽略：`updatePhotoSetting` 在 `value <= 0` 時直接 return、沒有提示，`quality` 大於 1 也接受（B6a 只做分析頁）。觸發點：真機改壞照片參數，或 9b-3 驗收時
- jsdom 的 `DOMException` 不是 `Error` 子類，錯誤紀錄的 message 會記成 `{}`（測試因此只斷言 where 與筆數）。推測真機不會（WebIDL 規定原型是 `Error.prototype`）。觸發點：真機錯誤紀錄出現 `{}`
- 記一筆讀 QR 時 `detectQrCodes` 回 `error`（例如 wasm 載入失敗）：畫面顯示原文、不進錯誤紀錄，「讀取發票失敗」字樣在 `onPickPhoto` 寫了兩次（結果分支與 catch）。觸發點：有人遇到 wasm 載入失敗，或 B7 清理 QrLab 時（`detectQrCodes` 兩頁共用，正確修法要改它的回傳；使用者 2026-10-16 決定）
- 首次啟動直接進分析頁讀不到 settings：App.vue 已 `void initStorage()`，分析頁 onMounted 的 `await initStorage()` 遇到 `running` 直接 return，`get('settings')` 可能早於 `seed` 寫入 → `null`，頁面空白。機率極低（PWA 從 `/` 開）。觸發點：有人遇到分析頁空白，或 B7 改 `initStorage` 單一入口時
- 待確認卡的死角：多品項卡改日期撞到另一張發票的 `invoiceKey`，按「確認並記住規則」展開逐項面板後「完成並確認」會失敗；面板開著時「修改」「放棄修改」停用（避免逐項草稿錯位），卡片上改不回日期，只能離開頁面（草稿全消失）或刪除。使用者 2026-10-15 決定接受。觸發點：有人真的遇到，或要讓逐項面板可以收起時
- `SettingsView.vue`、`QrLabView.vue` 的 `loadSamples` 在頁面卸載後才 resolve 時，建出的縮圖 object URL 不會被 revoke（小洩漏）。觸發點：B7 把兩頁改用 `useThumbnails`
- `multi_item_correction` 沒有產生點（design.md §6.2「略過」要記它）。P2，之後再評估實作（使用者 2026-10-14 決定，不刪）。卡點：待確認頁的「略過，只記住店家」會直接確認，這個事件型原因加上去會讓剛確認的紀錄立刻回到待確認；要實作得先想清楚它出現在哪裡（例如編輯頁的略過，或另一種不會進待確認的標記）。觸發點：使用者想回頭找「整筆改過分類的多品項紀錄」
- §6.2 的 undo 沒做（B4.2a 正式承認不一致，目前只有提示文字）。觸發點：使用者回報誤記規則要去設定頁刪很麻煩
- 編輯頁返回連結寫死 `/records`（`RecordEditView.vue`），從其他頁進來回不去。觸發點：B4.2b 或任何頁面要連到編輯頁時
- 改日期後 `invoiceKey` 撞到另一筆時不合併（`saveRecord` 有 catch 後合併，編輯與待確認卡沒有）。訊息已講人話（B4.2b-2 `userMessage`），合併仍未做。觸發點：使用者回報改日期存不了而需要合併
- 待確認卡依原因聚焦欄位（design.md §3.7「不同 reason 對應不同的修正欄位聚焦」）。觸發點：B4.2b 之後覺得找欄位麻煩
- `rawRecognition` 只存解析後的結果，parser 有 bug 時事後救不回來。要不要另存原始 payload
- `entryService.test.ts:85` 在台北時間 00:00–08:00 必定失敗（見「坑」第 9 點）
- 依規格把左右 QR 串接後再解析（含 Base64 模式，編碼參數 2）：規格上左右 QR 是一段連續的內容，現在左右分開切三元組，斷點不在品項邊界時會漏品項。P3，目前 0 筆實例。觸發點：第一次遇到參數 2，或合規發票出現「湊不成」note。官方範例 payload 的測試併在這裡做。境外電商（參數 3）在參數之後多兩個 10 碼金額欄位，會讓品項三元組錯位，一併在這裡評估
- 同名品項被合併：`updateRecordFields` 用品名當 key 對應既有品項，兩個同名品項只留最後一個的數量、金額與分類。P2，觸發點：發票出現同名品項（例如同品名不同規格）。**觸發點已到**：載具樣本 90 張中有 6 張含同名品項；使用者 2026-10-13 決定維持原排序
- 已有照片和發票時再選一張，取消或壓縮失敗會把發票資料清掉（`onPickPhoto` 一開始就 `clearInvoice()`）。P3，照片仍附著、文字路徑可用，不會存錯資料。觸發點：有人回報重選照片失敗後發票面板不見
- QR 路徑不讀 `needsReclassify`：`createFromInvoice` 合併後品項變了也不會重跑分類（載具匯入已用 `applyClassification` 處理）。觸發點：QR 合併進既有紀錄後分類明顯錯誤
- 還原後待確認紅點不更新：`confirmRestore` 沒有呼叫 `refreshRecords()`，AppNav 的紅點要等使用者換頁才更新（匯入已處理）。觸發點：使用者回報還原後紅點不對，或併進 B5／B7
- `prepareFiles()` 重組失敗時保留舊檔：只設 `errorMsg`，`csvFile`／`backupFile` 仍是舊的，匯出會拿到匯入或還原前的資料。修法：重組失敗時清掉舊檔或停用匯出。觸發點：使用者回報匯出的資料比畫面上舊
- 「用發票資料存檔」沒有檢查儲存層是否初始化完成（文字的「存檔」有檢查 `state !== 'ready'`）。機率低，只記錄

已評估、未採用：沒有總計額時用品項加總帶入金額（見 design.md §5.3 的觸發點）。

---

## 待驗證的假設

程式已經照規格寫好，但這四件事**還沒有任何真實資料證實過**。寫在這裡是因為
它們錯了的話，修的地方是確定的、而且很小——刻意保留的可調整空間。

| 假設 | 現在怎麼處理 | 證實或推翻後要改哪 |
|---|---|---|
| 品項第三欄是「單價」還是「小計」 | 1 張支持單價、0 張反例，政策未改（見 design.md §5.3） | `createFromInvoice()` 的 items 對應 + 記一筆頁那句說明 |
| 合規左方 QR 的 77 碼表頭 | ✅ 已證實：2 張合規樣本在 /qr-lab、1 張在記一筆解析正確 | — |
| 中文編碼參數 | ✅ 已定案：不依參數判斷，見 design.md §5.3.1 | — |
| `invoiceKey` 能正確去重真實發票 | ✅ 已證實：2026-10-14 真機上，記一筆拍 QR 的紀錄與發票存摺 CSV 的同一張合併成 1 筆 | — |
| 分析四條規則的門檻 | 憑常識設的預設值 | 分析頁即時調整，不必改程式 |

**好消息是目前沒有任何需要遷移的資料**：手輸紀錄的 `invoiceKey` 恆為 `null`，
品項的金額欄位是 `null` 而不是猜出來的數字。假設推翻了也不會留下錯資料。

---

## 之後可做的事

| 項目 | 需要什麼 |
|---|---|
| 店家名稱合併工具（§8.2 已知限制） | 實際遇到 Netflix / 網飛 這類問題時再做 |
| 元件測試 | 無阻塞。記帳頁與編輯頁現在只有 service 層測試 |
| 從相簿選圖時讀 EXIF 拍攝時間 | 現在 `capturedAt` 是匯入時間 |
| OCR、AI 分類、財政部官方載具格式 | 都在 v1 範圍外，需要時先討論（發票存摺 CSV 匯入已在 C2 完成） |

---

## 開發指令

```bash
npm run dev        # 本機開發（會跳過安裝閘門，需按頁面上的 dev bypass）
npm test           # 跑測試（單次）
npm run test:watch # 跑測試（watch）
npm run build      # typecheck + build
npm run typecheck  # 只跑 vue-tsc
```

push 到 `main` 會自動跑 CI（test → build → deploy）。

---

## 需要記住的幾個坑

1. **CI 與本機的依賴差異**：本機 `npm install` 會帶進傳遞依賴，CI 的 `npm ci` 照 lock 安裝不會。`@types/node` 就是這樣漏掉的。要驗 CI 行為，用乾淨 clone + `npm ci`，不要只信本機。

2. **IndexedDB transaction 會自動 commit**：`transaction()` 的 `fn` 裡只能 await 儲存層方法。await 影像壓縮、雜湊、fetch、計時器會讓 transaction 提前結束，之後的寫入直接報錯。前處理一律在開 transaction 之前做完。（design.md §2.2）

3. **iOS Safari 沒有 `display-mode` media query**：standalone 偵測必須同時查 `navigator.standalone`，少了會把主畫面 App 誤判成分頁。

4. **GitHub Pages 沒有 SPA rewrite**：router 用 hash 模式，不要改成 history。

5. **Git remote 走 SSH**：HTTPS 沒有 token，push 會失敗。

6. **Vue 深層響應式物件不可寫進 IndexedDB**：`ref(x).value` 和 `reactive(x)` 都是
   Proxy，structured clone 會丟 `DataCloneError`。任何之後要寫回資料庫的資料，
   一律用 `shallowRef` 或 `toRaw`。fake-indexeddb 接受 Proxy，所以單元測試抓不到，
   只有真機會炸。（design.md §11.3）

7. **UI 的 async handler 一定要 try/catch 並把錯誤顯示出來**。Promise 被吞掉時
   使用者看到的是「按鈕沒反應」，完全無法除錯。Phase 6 就是這樣卡住的。
   現在有兩層防護：`no-floating-promises` 在 lint 擋下，全域 handler 在
   執行期接住漏網的。

8. **iPhone 上沒有 console**。要除錯只能靠設定頁的「未處理的錯誤」清單，
   或接上 Mac Safari 的網頁檢閱器（design.md §13.5）。

9. **`entryService.test.ts:85` 有時區 bug**：用 UTC 的今天比對本地時間算的「昨天」，
   台北時間 00:00–08:00 跑必定失敗（CI 在 UTC 不受影響）。這個時段在本機跑測試用
   `TZ=UTC npm test`。

10. **好市多 App 的「發票開立通知」不是合規發票**：左方 QR 沒有 77 碼表頭，只有品項，
    所以讀不到號碼、日期、總計額，記一筆會請你自己填金額。這是設計上的行為。

11. **熱感紙列印品質差的發票讀不到**：白巷子那張的左方 QR 定位方塊太細、模組斷線，
    zxing 與 iPhone 內建相機都讀不出來。不處理；9b-3 樣本中讀不到的超過一張再評估。
