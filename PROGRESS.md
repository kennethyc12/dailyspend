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
617 個測試（2026-10-22）、lint 乾淨。最後一塊（拍發票自動帶入品項）於 2026-10-11 完成。

接下來**不需要再寫新功能**，需要的是用真實資料驗收與校準：Phase 9b 的欄位
解析已有 2 張合規發票解析正確（其中 1 張走過記一筆）、`invoiceKey` 已在載具匯入時確認；分析門檻則還是憑常識設的預設值。

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
| B6b | 分析頁佐證紀錄就地展開、連到編輯頁；編輯頁返回回到原頁 | ✅ | ✅ | 2026-10-17 真機驗收通過：依據可展開與收合且日期新到舊、點進編輯頁後返回回到分析頁、從紀錄頁進來返回紀錄頁、重開後返回紀錄頁、刪除後到紀錄頁、依據那一行外觀不變 |
| B7a | `initStorage` 呼叫後保證完成一次完整執行、寫回 persistGranted 不蓋掉並行寫入、還原後紅點立刻更新 | ✅ | ✅ | 2026-10-18 真機驗收通過：冷啟動直接進分析頁正常、記一筆「準備中…」沒有明顯變長、備份後上次備份更新、還原含待確認的備份後紅點立刻正確 |
| backup-reminder | 記帳頁補回備份提醒橫幅（Phase 7 起遺失），點了進備份頁 | ✅ | ✅ | 2026-10-18 真機驗收通過：符合條件時記帳頁出現橫幅、點了進備份頁、完整備份後回記帳頁消失、取消分享時仍在、亮色暗色都清楚 |
| B7b | 刪沒在用的 port 與設定項（D4），`invoiceKey` 改用共用日期檢查 | ✅ | ✅ | 2026-10-22 真機驗收通過：記一筆文字存檔、分析頁、設定頁、匯出備份正常，錯誤紀錄沒有新增 |
| B7c | 「（無店家）」抽常數；沒有類別的紀錄改叫「未分類」，「待確認」只指狀態 | ✅ | ✅ | 2026-10-22 真機驗收通過：待確認卡「確認（目前為 未分類）」、確認後紀錄頁只剩「未分類」、待確認中顯示「未分類 · 待確認」、搜「未分類」找得到、CSV 類別欄是「未分類」、「（無店家）」照常顯示 |
| B8 | 文件、註解與畫面提示對齊現況 | ✅ | ✅ | 2026-10-22 真機驗收通過：記一筆沒有總計額的發票顯示新提示、斷行正常；QR 實驗室頁說明文字是新說法 |
| same-name-items | 編輯品項時同名品項各自保留數量、金額與分類 | ✅ | ✅ | 2026-10-23 真機驗收通過：載具匯入含同名品項的紀錄加一行品項後，兩個同名品項的數量與金額不變 |
| entryservice-tz-test | 「昨天」前綴測試改用本地日期，台北清晨不再必紅 | ✅ | — | 只改測試，不需真機；`TZ=Asia/Taipei` 與 `TZ=UTC` 全套皆 625 passed |
| bulk-delete | 紀錄頁多選刪除，刪除前強制存保險備份 | ✅ | ✅ | 2026-10-26 真機驗收通過：勾選與點整列、全選目前結果、底部列不被分頁列蓋住、確認區塊文案與捲動、iOS 分享保險備份與取消、刪除後回饋與紅點、用保險備份還原。「改搜尋關鍵字後勾選清空」用中文輸入法時勾勾似乎仍在，jsdom（含模擬組字）重現不出來，記 ticket 待重現 |
| prepare-files | 備份頁匯入或還原後重組匯出檔失敗時，不再能匯出重組前的舊檔 | ✅ | ✅ | 2026-10-29 真機驗收通過：進備份頁兩鈕可匯出、匯入載具 CSV 後匯出的 CSV 含匯入的紀錄、完整備份存檔成功且上次備份更新。組檔失敗的情境由頁面測試與突變 M1–M8 涵蓋 |
| record-edit-categories | 直接開啟編輯頁（例如在編輯頁按「有新版本 → 更新」）時，類別選單是空的、目前類別顯示 id | ✅ | ⏳ | 真機驗收：停在編輯頁按「有新版本 → 更新」後類別正常、可改分類 |

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
- 7 天備份提醒；從未備份時累積到 20 筆才開始提醒（Phase 7 `4045778` 起畫面上消失，backup-reminder 補回）
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
  耗時、payload 的文字/hex/Big5。選型定案後留著，~~因為欄位切法要看真實 payload~~ 用來看新樣本的原始 payload（B8，2026-10-22）
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

**當時還缺的（B8 更正：已補齊）**：2026-10-12 起已有合規左方 QR 的實拍樣本，號碼、日期、總計額都解析正確；
~~但從照片**存檔**的路徑還沒用合規發票走過，§7.1 的 `invoiceKey` 也還沒在真機上驗證。~~ 2026-10-14 載具匯入驗收時已確認存檔路徑的 `invoiceKey` 能和 CSV 合併（B8，2026-10-22）。

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
beb1fe6 feat(bulk-delete): 紀錄頁多選刪除，刪除前強制存保險備份
0bc9b22 記錄 entryservice-tz-test 完成
02b3763 記錄 same-name-items 真機確認通過
5960912 fix(entryservice-tz-test): 「昨天」前綴測試改用本地日期，台北清晨不再必紅
5895a0e 記錄 B8 真機確認通過
29abfb5 fix(same-name-items): 編輯品項時同名品項各自保留數量、金額與分類
333a9ac 記錄 B7c 真機確認通過
fa21d8b docs(b8): 文件、註解與畫面提示對齊現況
fcbaab7 記錄 B7b 真機確認通過
a505305 refactor(b7c): 「（無店家）」抽成 NO_MERCHANT 常數
60ce50b fix(b7c): 沒有類別的紀錄改叫「未分類」，「待確認」只指狀態
f97790a 記錄 backup-reminder 真機確認通過
251c731 refactor(b7b): 刪掉沒在用的 port 與設定項（D4），invoiceKey 改用共用日期檢查
a5b1b19 fix(backup-reminder): 記帳頁補回備份提醒橫幅，點了進備份頁
b9bd13e 記錄 B7a 真機確認通過
5e828fb fix(b7a): initStorage 呼叫後保證完成一次完整執行，寫回 persistGranted 不再蓋掉並行寫入，還原後紅點立刻更新
851d107 記錄 B6b 真機確認通過
85c3363 feat(b6b): 分析頁的佐證紀錄可以展開並點進編輯頁，編輯頁返回回到原頁
edb94f3 記錄 B6a 真機確認通過
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
| **B6b** ✅ | 分析：佐證紀錄就地展開（`FindingItem`，日期新到舊、連到編輯頁，`kind:title` 當 key）；編輯頁「← 返回」有站內上一頁就 `router.back()`，否則回 `/records`；刪除後仍回 `/records` | 返回分析頁時展開與捲動消失、不做「再顯示 N 筆」、清單金額 `$1,300`、design.md 不改，都是使用者決定 |
| **B7a** ✅ | `initStorage` 單一入口：呼叫後保證完成一次完整執行，執行中再呼叫就排一輪、排隊前的呼叫合併；第 37 行寫回 `persistGranted` 改用 `updateSettings`（settings 中途被刪就初始化失敗）；還原後待確認紅點立刻更新 | 一支 API（推翻 research 原建議的兩支，chris 判斷、使用者同意）；冷啟動會跑兩輪，重新評估觸發點：真機冷啟動「準備中…」明顯變長；排隊等重讀時又有第三輪，failed 判斷可能漏掉第二輪的失敗，接受（觸發點：真機「還原完成」但資料沒載入） |
| **backup-reminder** ✅ | 備份提醒橫幅補回記帳頁（Phase 7 `4045778` 刪 HomeView 時遺失）：從未備份且 ≥ 20 筆或距上次備份超過 7 天時顯示，點了進 `/backup`，沿用 Phase 6 文案與樣式；design.md §11.2「可一鍵匯出」改成「點橫幅進備份頁匯出」（iOS 手勢限制，使用者委託 chris 判定）；FEATURES 同步；頁面測試補上 7 天邊界與「等 persist 期間備份」 | 不做「稍後提醒」（使用者決定）；還原後立刻跳提醒見 ticket；App 從背景回來不會重新 mount，橫幅可能過期，重新評估觸發點：使用者回報提醒沒出現或沒消失 |
| **B7b** ✅ | 刪 `RuleClassifier`／`ClassifierPort`（偏離 design.md §6.4，使用者同意）、店家字典 `merchantDictionary`／`merchantMatched`、沒有讀取者的設定鍵（`defaults.date`、`defaults.categoryFallback`、`parsing`、`export.encoding`、`repeatPurchase.similarity`）、`categoryCount`／`ruleCount`；`invoiceKey.ts` 改用 `dates.ts` 的 `isValidIsoDate`／`parseIso`；守門測試：帶舊鍵的 settings 第一次 seed 之後不再寫回；`RecognizerPort` 只在文件標「已評估、未採用」 | 不做 migration，舊裝置與備份檔殘留舊鍵、帶舊鍵的裝置第一次開啟寫回 settings 1 次；`close`、`confirmRecord`、`toIdbRange` 轉出、`runBlobRoundTrip`、`isStandardInvoiceNumber` 記成「死 code 清點」ticket |
| **B7c** ✅ | 「（無店家）」7 處改用 `src/models/labels.ts` 的 `NO_MERCHANT`；`categoryId === null` 在畫面與 CSV 改叫「未分類」（`UNCATEGORIZED`），「待確認」只指 `status: pending`；`analyze.ts` 的 `nameOf` 只收 `string`、刪掉走不到的 null 分支；新增 `RecordsView.test.ts`；改 `PendingView.test.ts:242`、`backup.test.ts:109-111` 與 design.md:190（使用者同意） | **使用者可見**：CSV 類別欄的值從「待確認」改為「未分類」，舊匯出檔不會改寫；紀錄頁搜「待確認」不再找到沒有類別的紀錄（搜尋本來就不比對狀態）。null 類別仍是 `warn` 樣式。「null → 標籤」兩份實作記 ticket |
| **B8** ✅ | 文件同步：待確認原因 11 種、design.md §3.7／§4.4 補 `tokens_after_amount`；單價不加總的理由改成「沒有總計額時無法核對品項是否齊全」（FEATURES、註解、記一筆提示、測試名稱）；編碼與合規樣本現況；FEATURES〈數字〉表標統計日期、README 拿掉測試數；開發指令補 lint；清單外同類舊說法一併改（README:27、PROGRESS 現況段、QR 實驗室頁說明） | 〈數字〉表每批都會過時，已標統計日期與 commit；若之後每批都要更新，再考慮刪表 |
| **same-name-items** ✅ | `computeRecordUpdate` 原本用品名建 Map 對回舊品項，同名品項全拿到最後一個的值；改用 `matchItems`（頭尾相同的依位置，中段同名的依舊順序，相鄰同名刪一個保留前面那個）；design.md:979 與 `RecordPatch.itemNames` 註解對齊實況 | **修正前編輯過同名品項的紀錄不會自動修復**；QR 品名頭尾空白、「同名保留 categoryId」與重分類不一致另記 ticket |
| **bulk-delete** ✅ | 紀錄頁「選取」模式：逐筆勾選或全選目前搜尋結果，改關鍵字清空勾選；`prepareBulkDelete`／`commitBulkDelete` 讓保險備份在 API 上強制（同還原）；確認區塊列筆數、合計、照片數、發票數與規則不刪；`deleteRecords` 為唯一刪除點，讀 DB 當下的 `photoId`（單筆刪除一併修正快照過期時刪到別筆照片、留下孤兒照片） | 單筆刪除不強制保險備份；依匯入批次撤銷、依月份／來源篩選、`hitCount` 不倒回另記 ticket；merge-provenance、tombstone、規則清單多選刪除已評估、未採用（DECISIONS） |
| **prepare-files** ✅ | `prepareFiles` 一開始重組就把 `csvFile`／`backupFile` 清成 `null`：組檔失敗的那個檔按鈕停用（原本匯出的是匯入或還原前的舊檔，還會 `markBackedUp`），zip 失敗時新 CSV 仍可匯出；失敗文案改「準備匯出檔失敗，請離開本頁再進來重試」；頁面測試以 `IDBObjectStore.prototype.getAll` 製造失敗 | 不加重試鈕；組檔與匯入／還原重疊另記 ticket |
| **record-edit-categories** | 編輯頁 `onMounted` 先 `refreshRecords()` 再讀紀錄：類別清單是 `useRecords` 的模組單例，其他會顯示紀錄或類別的頁進來都會載入，只有編輯頁要等第一次 `act()`，所以更新 App 後重新載入落在 `#/records/:id` 時類別選單是空的、「目前：」顯示 id；refresh 在 try 內，失敗時整頁「讀取失敗」不顯示半套資料。原 flake ticket（`RecordEditView.test.ts` 在 shuffle 下偶發失敗）同一成因：原推測「第一個測試冷啟動超過 1000ms」**已推翻**，真因是排在任何 `act()` 之前的測試拿不到類別。新增「直接開啟」與「類別讀取失敗」頁面測試；「改整筆分類」補斷言類別確實改變（使用者同意）；`otherOption` 找不到選項時說明原因 | 編輯頁多讀一次全部 records（同其他頁）；`act()` 寫入成功但重新整理失敗另記 ticket |

另外二十八張 ticket：
- 返回分析頁時展開與捲動消失：從佐證清單點進一筆再「← 返回」，清單收合、可能回到頁首（沒有 `keep-alive`、`scrollBehavior`）。使用者 2026-10-17 決定接受。觸發點：真機回報看完一筆回來找不到原本那條
- 設定頁照片壓縮的無效輸入靜默忽略：`updatePhotoSetting` 在 `value <= 0` 時直接 return、沒有提示，`quality` 大於 1 也接受（B6a 只做分析頁）。觸發點：真機改壞照片參數，或 9b-3 驗收時
- 記一筆讀 QR 時 `detectQrCodes` 回 `error`（例如 wasm 載入失敗）：畫面顯示原文、不進錯誤紀錄，「讀取發票失敗」字樣在 `onPickPhoto` 寫了兩次（結果分支與 catch）。觸發點：有人遇到 wasm 載入失敗，或 QrLab 下架時（`detectQrCodes` 兩頁共用，正確修法要改它的回傳；使用者 2026-10-16 決定，2026-10-18 改觸發點）
- 待確認卡的死角：多品項卡改日期撞到另一張發票的 `invoiceKey`，按「確認並記住規則」展開逐項面板後「完成並確認」會失敗；面板開著時「修改」「放棄修改」停用（避免逐項草稿錯位），卡片上改不回日期，只能離開頁面（草稿全消失）或刪除。使用者 2026-10-15 決定接受。觸發點：有人真的遇到，或要讓逐項面板可以收起時
- `SettingsView.vue`、`QrLabView.vue` 的 `loadSamples` 在頁面卸載後才 resolve 時，建出的縮圖 object URL 不會被 revoke（小洩漏）。觸發點：QrLab 下架或設定頁樣本區改版時（`useThumbnails` 以 photoId 從 DB 讀縮圖，樣本已帶 `thumbBlob`，不適合硬套）
- `multi_item_correction` 沒有產生點（design.md §6.2「略過」要記它）。P2，之後再評估實作（使用者 2026-10-14 決定，不刪）。卡點：待確認頁的「略過，只記住店家」會直接確認，這個事件型原因加上去會讓剛確認的紀錄立刻回到待確認；要實作得先想清楚它出現在哪裡（例如編輯頁的略過，或另一種不會進待確認的標記）。觸發點：使用者想回頭找「整筆改過分類的多品項紀錄」
- §6.2 的 undo 沒做（B4.2a 正式承認不一致，目前只有提示文字）。觸發點：使用者回報誤記規則要去設定頁刪很麻煩
- 改日期後 `invoiceKey` 撞到另一筆時不合併（`saveRecord` 有 catch 後合併，編輯與待確認卡沒有）。訊息已講人話（B4.2b-2 `userMessage`），合併仍未做。觸發點：使用者回報改日期存不了而需要合併
- 待確認卡依原因聚焦欄位（design.md §3.7「不同 reason 對應不同的修正欄位聚焦」）。觸發點：B4.2b 之後覺得找欄位麻煩
- `rawRecognition` 只存解析後的結果，parser 有 bug 時事後救不回來。要不要另存原始 payload
- 依規格把左右 QR 串接後再解析（含 Base64 模式，編碼參數 2）：規格上左右 QR 是一段連續的內容，現在左右分開切三元組，斷點不在品項邊界時會漏品項。P3，目前 0 筆實例。觸發點：第一次遇到參數 2，或合規發票出現「湊不成」note。官方範例 payload 的測試併在這裡做。境外電商（參數 3）在參數之後多兩個 10 碼金額欄位，會讓品項三元組錯位，一併在這裡評估
- QR 品名頭尾空白：`einvoicePayload.ts:171-180` 切品名時沒有 trim，帶頭尾空白的品名在編輯品項後對不上（新品名會 trim），變成新品項，數量與金額遺失。另外「品項欄沒改就不送 `itemNames`」（`formToPatch`）這條不變式在 same-name-items 之後沒有測試保護：既有的「#1 只改備註，同名的兩個品項保持原樣」送不送 `itemNames` 結果都一樣。觸發點：第一次出現帶頭尾空白的 QR 品名
- 「同名品項保留 categoryId」與重分類不一致：店家或品名一改、分類來源不是 `user` 時，`applyClassification` 依索引覆寫所有品項的 `categoryId`；保留只在 user 來源或待確認卡草稿（`reclassify: false`）時成立。觸發點：使用者回報改了品項後逐項分類被重設
- 已有照片和發票時再選一張，取消或壓縮失敗會把發票資料清掉（`onPickPhoto` 一開始就 `clearInvoice()`）。P3，照片仍附著、文字路徑可用，不會存錯資料。觸發點：有人回報重選照片失敗後發票面板不見
- QR 路徑不讀 `needsReclassify`：`createFromInvoice` 合併後品項變了也不會重跑分類（載具匯入已用 `applyClassification` 處理）。觸發點：QR 合併進既有紀錄後分類明顯錯誤
- 組檔與匯入／還原重疊：`importLocked` 與還原選檔都不看 `preparing`，進備份頁那一輪組檔還沒結束就匯入或還原時，兩輪 `prepareFiles` 重疊；舊那一輪較晚結束會用匯入前的資料蓋掉新檔，並在 finally 把 `preparing` 改回 false（prepare-files 擋不住）。照片多、iPhone 組檔要好幾秒時才可能發生。觸發點：真機上匯入或還原後馬上匯出，拿到的是舊資料
- 部分失敗後錯誤訊息被匯出清掉：備份頁重組時 zip 失敗、CSV 成功，使用者點「匯出 CSV」後 `exportCsv` 清掉 `errorMsg`，「完整備份」仍停用卻不再說明原因（prepare-files 不處理，使用者 2026-10-29 決定）。修法：組檔錯誤獨立成一個 ref，不被匯出動作清掉。觸發點：使用者回報完整備份鈕灰掉不知道為什麼
- 寫入成功但重新整理失敗，訊息說成失敗：編輯頁 `act()` 在寫入後 `refreshRecords()`，它失敗時走同一個 catch 顯示「操作失敗」，資料其實已寫入；備份頁匯入的同類情況見 `BackupView.test.ts` 的 `it.todo`（現在可以用 `IDBObjectStore.prototype.getAll` 製造失敗）。觸發點：使用者回報顯示失敗但資料其實改了
- 「用發票資料存檔」沒有檢查儲存層是否初始化完成（文字的「存檔」有檢查 `state !== 'ready'`）。機率低，只記錄
- 重跑時記憶體 settings 被蓋回：`runInit` 的 `settings.value = current` 在 `requestPersist` 之後才執行，這段期間在設定頁改了照片壓縮，記憶體裡的值會被蓋回舊的（DB 是對的）。觸發點：真機回報照片壓縮欄位跳回舊值
- 備份頁不等初始化：`BackupView` 的 `onMounted(prepareFiles)` 不等 `initStorage`，首次安裝後直接冷啟動進 `/backup` 時，匯出檔可能在 seed 之前就組好。機率極低。觸發點：使用者回報第一次的匯出檔是空的
- 還原後立刻跳提醒：備份檔裡的 `lastBackupAt` 是匯出前的值（`markBackedUp` 在匯出之後才寫），`restoreBackup` 整份覆蓋 settings，所以用最新備份還原後可能馬上顯示「該備份了」。使用者 2026-10-18 決定接受。觸發點：真機遇到時覺得吵
- 死 code 清點：`StoragePort.close`（adapter 有實作、正式程式沒呼叫端）、`confirmRecord`（只有 `entryService.test.ts`、`carrierImportService.test.ts`、`RecordsView.test.ts` 在用）、`storage/index.ts` 的 `toIdbRange` 轉出（沒人從 index 匯入）、`runBlobRoundTrip`／`BlobRoundTrip`（Phase 2 真機自檢，沒有呼叫端）、`isStandardInvoiceNumber`（design.md:705 說「只供 UI 提示」，UI 沒接）。B7b 不動（使用者 2026-10-18 決定）。觸發點：下一次清理 port 或 storage 介面時
- 「null 類別 → 標籤，否則查表」有兩份實作：`useRecords.ts` 的 `categoryName` 與 `csv.ts` 的 `toCsv`（B7c 只把文案換成 `UNCATEGORIZED` 常數，沒合併）。觸發點：要改類別名稱的 fallback 時（例如刪除類別後的顯示）
- 依匯入批次撤銷（bulk-delete 評估後不做）：紀錄沒有匯入批次識別，合併過的紀錄也回不到合併前的樣子，要改 schema 與備份格式。目前用「搜尋 → 全選目前結果 → 刪除」代替。觸發點：搜尋加全選圈不出某次匯入的範圍
- 紀錄頁沒有依月份或來源篩選（bulk-delete 不做）：多選刪除只能靠搜尋店家、品項、類別圈範圍。觸發點：要刪某個月或所有載具紀錄時，搜尋加全選不夠用
- 刪紀錄不倒回規則的 `hitCount`／`lastHitAt`（bulk-delete 決定不做）：刪測試資料後設定頁的「命中 N 次」會偏高；`hitCount` 只用於顯示，不影響分類排序（`matching.ts`）。要倒回得記錄每次命中來源。觸發點：使用者覺得命中次數誤導
- 多選刪除：iOS 用中文輸入法改搜尋關鍵字後，列上的勾勾似乎沒清空（2026-10-26 真機驗收回報，當時沒注意底部「已選」列與列表是否已篩選）。jsdom 下一般輸入與模擬組字都會清空；組字中（還沒選字）關鍵字不更新，勾選維持是預期行為。下次照這個順序觀察：勾 2 筆 → 打中文並選字送出 → 看列表是否篩選、底部列是否消失、勾勾是否還在 → 再用英文試一次。底部列還在＝狀態沒清（看 `watch(keyword)`／v-model 組字）；底部列消失但勾勾在＝DOM 的 `checked` 沒同步（可改成依 `selected` 重建 checkbox）。觸發點：再次重現

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
npm run lint       # ESLint
```

push 到 `main` 會自動跑 CI（lint → test → build → deploy）。

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

9. ~~**`entryService.test.ts:85` 有時區 bug**：用 UTC 的今天比對本地時間算的「昨天」，
   台北時間 00:00–08:00 跑必定失敗（CI 在 UTC 不受影響）。這個時段在本機跑測試用
   `TZ=UTC npm test`。~~（entryservice-tz-test，2026-10-23 已修：改用 `addDays(todayIso(), -1)`）

10. **好市多 App 的「發票開立通知」不是合規發票**：左方 QR 沒有 77 碼表頭，只有品項，
    所以讀不到號碼、日期、總計額，記一筆會請你自己填金額。這是設計上的行為。

11. **熱感紙列印品質差的發票讀不到**：白巷子那張的左方 QR 定位方塊太細、模組斷線，
    zxing 與 iPhone 內建相機都讀不出來。不處理；9b-3 樣本中讀不到的超過一張再評估。

12. **`useRecords` 是模組單例**：紀錄與類別存在模組層的 `shallowRef`，只有 `refreshRecords()` 會填，頁面進來要自己呼叫，不能假設別頁載入過（record-edit-categories）。頁面測試之間也不會重設，測試結果會依賴執行順序；要模擬「沒載入過」就在該條 it 內清 `useRecords().categories.value`。

13. **jsdom 的 `DOMException` 不是 `Error` 子類**：錯誤紀錄的 message 會記成 `{}`（測試因此只斷言 where 與筆數）。推測真機不會（WebIDL 規定原型是 `Error.prototype`）。觸發點：真機錯誤紀錄出現 `{}`（原 ticket，2026-10-29 移到這裡）
