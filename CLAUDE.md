# KFCCa 開發守則

KFC 優惠券查詢站：零依賴靜態前端（`index.html` + `src/`，ES modules）+ Python 抓取管線（`script/kfc.py`）+ GitHub Actions 每日更新資料並部署 GitHub Pages。測試跑 `node --test`（node:test，無任何 devDependency，維持零依賴）。

## 不可違反的規則（皆來自實際踩過的坑）

1. **商品目錄單一來源**：目錄（分類／品項／別名）唯一來源是 `src/data/product-catalog.json`。改目錄只改這份 JSON，改完執行 `node script/build-catalog.mjs` 重新生成 `src/lib/productCatalogData.js`（`tests/catalogSync.test.js` 會擋住不同步）；Python 端直接讀同一份 JSON。不得在 JS 或 Python 程式碼裡硬編碼商品清單或別名。

2. **「券是否可用」只能用 `isCouponCurrentlyAvailable()`（couponParser.js）即時判斷日期**。資料檔裡的 `available` 欄位不可信 —— 管線恆寫 `true`，且資料一天只更新一次，期限剛過的券整天都會標成可用。任何篩選、計算、推薦邏輯都要走日期判斷，不要讀靜態 flag。

3. **演算法（optimizer 等）改動必須附齊四種情境的測試**：空需求／全部可滿足／全部不可滿足／**部分可滿足＋部分不可滿足（混合）**。歷史教訓：混合情境沒有測試，導致 optimizer 遇到一項無解就整組放棄、連可滿足的需求也不買，上線很久才發現。

4. **檔案編碼一律 UTF-8（無 BOM）**。Windows 上 PowerShell 的 `Out-File`/`Set-Content` 預設 UTF-16，曾把 `official_api.py` 裡的「優惠券」寫壞成 `?芣???` 進了版控。寫入或編輯含中文的檔案後，必須重新讀取確認中文完好；新增中文字串時順手 grep `?{2,}` 或 `�` 檢查。

5. **對 KFC 官方 API 要節流**：每個優惠碼之間必須有延遲（不是只在 retry 時 sleep）。README 對外承諾的行為（如「不高頻請求」）必須在程式碼裡真的存在，不能只寫在文件。

6. **不要產生沒有使用端的產出檔**：任何管線生成的檔案（如 `public/*.js`）必須有實際引用它的地方；新增產出前先把消費端接好，否則會變成每天 commit 的死代碼。

7. **前端所有 innerHTML 插值必須經過 `escapeHtml()`**：優惠券資料來自外部抓取，title/description/code 都是不可信輸入。

8. **日期時區**：一律台灣時區。`YYYY-MM-DD` 解析用 `T00:00:00+08:00`、「今天」用 `Asia/Taipei` 換算，沿用 `couponLifecycle.js` 的既有慣例，不要混用本地時區或 UTC。

## 驗收習慣

- 交付前 `node --test` 必須全綠；CI 也會在 commit 資料前跑。
- 改 optimizer / normalizer 後，除了單元測試，額外用 node -e 跑一個真實混合需求的 sanity check，肉眼確認 selectedCoupons / missing 合理。
- 大型多階段功能走計畫→審查→分批實作流程（專案已有 /plan-flow、/dev-flow skill 與 logs/dev-codex 慣例）。
