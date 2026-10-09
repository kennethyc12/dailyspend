# DailySpend

個人記帳 PWA。輸入「全家 咖啡 55」就存檔，規則自動分類，分錯時改一次就會記住。

**https://kennethyc12.github.io/dailyspend/**

> iPhone 請用 Safari 開啟後「分享 → 加入主畫面」，再從主畫面圖示進入。
> 在 Safari 分頁裡 App 會擋住記帳功能——iOS 上分頁與主畫面 App 是兩份獨立的儲存空間，在分頁記的帳加到主畫面後看不到。

---

## 這是什麼

單人用的記帳工具，解決三件事（依優先序）：

1. **方便記錄** — 一行文字就存檔，缺的欄位用預設值
2. **分析消費習慣** — 規則計算，不用 AI
3. **找出可降低的消費** — 每條建議都附得出具體紀錄

**所有資料只存在手機本機**（IndexedDB），不經過任何伺服器。發票號碼與照片含個資，這是刻意的設計前提而非偷懶。代價是換手機要自己匯出備份。

## 功能

- **快速輸入** — `店家 品項 金額`，支援 `1,200`、`55元`、`$55`、全形數字，日期前綴 `昨天` / `10/3` 選填
- **自動分類** — 64 條內建規則，品項優先於店家；判斷不出來就進待確認，不亂猜
- **修正即成規則** — 改一次分類，下次同樣的品項直接分對
- **發票照片** — 拍照附上並自動壓縮（QR 解析尚未完成）
- **去重** — 同一張發票只留一筆，去重鍵是「發票年期 + 號碼」
- **分析** — 高頻小額、訂閱與固定支出、月對月暴增、同類重複購買；門檻可調
- **備份** — CSV 匯出、完整備份 zip（含照片）、還原

完整說明見 [FEATURES.md](./FEATURES.md)。

## 技術選型

| 選擇 | 理由 |
|---|---|
| Vue 3 + TypeScript + Vite | — |
| PWA（vite-plugin-pwa） | 手機上要能像 App 一樣用，且要離線可用 |
| IndexedDB | 本機儲存，而且要存得下照片 Blob |
| 純 CSS + CSS variables | 單人工具、畫面不到 10 個，Tailwind 的邊際效益不高 |
| hash router | GitHub Pages 沒有 SPA rewrite，history 模式重新整理子路徑會 404 |
| Vitest + fake-indexeddb | 邏輯層全部可測，不需要瀏覽器 |

儲存、辨識、分類三層都定義成 port，實作可替換（未來可換 SQLite、加 OCR、加 AI 分類）。

## 開始開發

需要 Node 22 以上。

```bash
npm install
npm run dev        # 開發伺服器（會跳過安裝閘門，需按畫面上的 dev bypass）
```

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm test` | 跑測試（單次） |
| `npm run test:watch` | 跑測試（watch） |
| `npm run lint` | ESLint |
| `npm run typecheck` | vue-tsc |
| `npm run build` | typecheck + build |
| `npm run preview` | 預覽 build 結果 |

### 在 iPhone 上測試

Service worker 需要 HTTPS，所以「Mac 跑 dev server + 手機連區網 IP」測不到 PWA。要在真機驗證請直接推上 `main`，CI 會自動部署，再用手機開線上網址。

除錯用 Mac Safari 的「開發」選單遠端連 iPhone（手機需開啟 設定 › Safari › 進階 › 網頁檢閱器）。

App 內的錯誤紀錄在「設定 › 未處理的錯誤」。

## 專案結構

```
src/
├── models/      資料型別定義
├── storage/     StoragePort 介面 + IndexedDB 實作 + schema
├── parsing/     快速輸入切詞
├── classify/    ClassifierPort + 規則比對 + 修正學習
├── dedupe/      發票去重鍵與欄位級合併
├── analysis/    四條分析規則
├── backup/      CSV、zip 備份、Web Share
├── photo/       影像壓縮
├── errors/      全域錯誤處理
├── services/    串接各層的應用邏輯
├── composables/ Vue 狀態
├── views/       畫面
└── components/  共用元件
```

每個目錄的 `__tests__/` 放對應測試，共 249 個。

## 文件

| 文件 | 內容 |
|---|---|
| [FEATURES.md](./FEATURES.md) | 功能總覽、未完成項目、開發過程的關鍵發現 |
| [PROGRESS.md](./PROGRESS.md) | 開發進度（按 Phase）、驗收紀錄、踩過的坑 |
| [design.md](./design.md) | 設計決策與理由 |

## 部署

推上 `main` 觸發 GitHub Actions：`lint → test → build → deploy`，部署到 GitHub Pages。

`vite.config.ts` 的 `base` 由 repo 名推導（CI 會以 `BASE_PATH` 覆寫），改 repo 名不需要手動同步。

## 開發慣例

幾條在這個專案上踩過坑才定下來的：

- **不要把 Vue 的深層響應式物件寫進 IndexedDB**。`ref(x).value` 和 `reactive(x)` 都是 Proxy，structured clone 會拒絕。要寫回資料庫的資料一律用 `shallowRef`。
- **`transaction()` 的回呼裡只能 await 儲存層方法**。await 影像壓縮、雜湊、網路會讓 IndexedDB 的 transaction 提前 commit。前處理一律在開 transaction 之前做完。
- **UI 的 async handler 一定要 try/catch 並把錯誤顯示出來**。Promise 被吞掉時使用者看到的是「按鈕沒反應」。ESLint 的 `no-floating-promises` 會擋第一層，全域 handler 接住漏網的。
- **要驗 CI 行為就用乾淨 clone + `npm ci`**，不要只信本機。本機 `npm install` 會帶進傳遞依賴，CI 不會。

## 授權

個人專案，未設授權條款。
