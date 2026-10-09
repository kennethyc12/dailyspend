# DailySpend 進度交接

> 最後更新：2026-10-09
> 設計文件：[design.md](./design.md) v0.2（所有決策與理由都在那裡，這份只記進度）

---

## 現況一句話

**v1 功能已齊**：Phase 1–8 全部完成並通過真機驗收，站台已上線，214 個測試全過。
只剩 Phase 9（QR 辨識），而它卡在發票樣本。現在最該做的是實際用起來，順手蒐集樣本。

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
- 62 條內建規則，**刻意不含超商與量販店**（§3.3）
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

### Commit 紀錄

```
88baf4d 記錄 Phase 7 真機驗收通過
4045778 Phase 7: 最小 UI（快速輸入、紀錄、待確認、設定）
a556ffb 記錄 Phase 6 真機驗收通過
482cdf4 修正還原按鈕無反應：Vue 深層響應式物件不可寫入 IndexedDB
a58546e Phase 6: 備份、CSV 匯出與還原
242f36f Phase 5: invoiceKey 與去重合併
6e46733 Phase 4: RuleClassifier、規則 CRUD 與修正學習
2fe4ab0 Phase 3: parseQuickInput 快速輸入切詞
5ebb6a6 加入 PROGRESS.md 進度交接文件
ba0ee37 記錄 Phase 1、2 的 iPhone 真機驗收結果
fe620f2 Phase 2: StoragePort、IndexedDbAdapter 與 schema v1
63e5c0f 修正 CI build：補上 @types/node
```

---

## 下一步：實際使用兩三週

v1 功能已經齊了。接下來最有價值的不是寫程式，是**累積真實資料**：

1. **每天記帳**。過程中會長出屬於你的分類規則，待確認的量會自己收斂
2. **順手蒐集發票樣本**（見下節），拿到紙本發票就拍一張
3. **回頭校準分析門檻**。現在的 30 天 8 次、連續 3 個月、10% 變異都是我憑
   常識設的，要用你真實的消費樣態才調得準。分析頁可以直接改，改完立刻重算

### 之後可做的事

| 項目 | 需要什麼 |
|---|---|
| **Phase 9 — QR 辨識** | 發票樣本（唯一的阻塞項） |
| 校準分析門檻 | 兩三週真實資料 |
| 店家名稱合併工具（§8.2 已知限制） | 發現實際有 Netflix / 網飛 這類問題時再做 |
| OCR、AI 分類、載具匯入 | 都在 v1 範圍外，需要時先討論 |

---

## 剩餘 Phase

| Phase | 內容 | 卡關？ |
|---|---|---|
| 9 | QR 辨識 | **需要發票樣本** |

Phase 6 排在 UI 之前是刻意的：Phase 7 開始會每天記真帳，在那之前資料必須有逃生出口。

---

## 唯一的待補項目

**發票樣本，死線 Phase 9。** 兩種用途不同、不能互相取代：

| 樣本 | 用途 |
|---|---|
| 實拍照片 3–5 張（不同角度、光線） | QR library 選型（jsQR vs zxing-wasm），測「單張圖兩個 QR」的偵測成功率 |
| QR 原始文字（去識別化） | 欄位切法、品項編碼與取得率、`invoiceKey` 最終確認 |

建議在 Phase 7 開始每日記帳時順手蒐集，拿到紙本發票就拍一張。

Phase 1–8 完全不受影響：這期間所有紀錄都是手動輸入，`invoiceKey` 恆為 `null`，就算之後樣本推翻了 key 格式，也沒有資料需要遷移。

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
