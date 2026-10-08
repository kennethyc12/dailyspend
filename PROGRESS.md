# DailySpend 進度交接

> 最後更新：2026-10-08
> 設計文件：[design.md](./design.md) v0.2（所有決策與理由都在那裡，這份只記進度）

---

## 現況一句話

Phase 1–5 完成，站台已上線，144 個測試全過。下一步是 **Phase 6 備份 / CSV 匯出 / 還原**——排在 UI 之前是刻意的，Phase 7 開始每天記真帳，在那之前資料必須有逃生出口。

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

### Commit 紀錄

```
ba0ee37  記錄 Phase 1、2 的 iPhone 真機驗收結果
fe620f2  Phase 2: StoragePort、IndexedDbAdapter 與 schema v1
63e5c0f  修正 CI build：補上 @types/node
b8bcad7  Phase 1: PWA 骨架、安裝閘門與 GitHub Pages 部署
```

---

## 下一步：Phase 6 — 備份 / CSV 匯出 / 還原

**範圍**：CSV 匯出、完整備份（zip）、還原、7 天提醒、Web Share 匯出。

**規格**：design.md §11（§11.1 Web Share 優先、§11.2 備份提醒）

**驗收**：**真機**完成一次「匯出 → 存到 iPhone 檔案 App → 還原」完整來回

**環境**：真機。`navigator.share` 必須在使用者手勢的同步呼叫鏈內觸發，
這點只有 iPhone 上測得出來。

**為什麼排在 UI 之前**：Phase 7 開始會每天記真帳，在那之前資料必須有逃生出口。
`persist()` 雖然已取得授權，但防不了刪 App、換機、或 iOS 回收儲存空間。

要接續時跟 Claude 說「開始 Phase 6」即可。

---

## 剩餘 Phase

| Phase | 內容 | 卡關？ |
|---|---|---|
| 6 | **備份 / CSV 匯出 / 還原** | 否 |
| 7 | 最小 UI，開始每日真實記帳 | 否 |
| 8 | 分析（四條規則 + 冷啟動 + 建議排序） | 否 |
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
