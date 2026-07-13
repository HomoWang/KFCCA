# KFC 優惠券查詢

這是一個可部署到 GitHub Pages 的肯德基優惠券查詢網站。前端完全讀取靜態資料檔 `public/coupon.json`，資料則由 GitHub Actions 定期抓取候選優惠碼、呼叫官方 API 驗證後產生。

## 功能

- 優惠券清單、關鍵字搜尋、商品類型篩選、價格篩選。
- 依有效期限或價格排序。
- 顯示優惠券代碼、內容、價格、起訖日期與目前是否可用。
- 多人「最划算購買方式」計算器，會依用餐時段在優惠券、單點與套餐間比價，輸出總金額、可滿足品項、多買品項、缺少品項與個人分配。
- 商品標準化模組：`src/lib/productNormalizer.js`。
- 前端最佳化演算法：`src/lib/optimizer.js`。

## 資料來源與更新流程

更新腳本入口是 `script/kfc.py`：

1. 從 `https://kfc.izo.tw/` 擷取 `/coupons/xxxxx` 形式的 5 碼候選優惠碼。
2. 從 `.env` 或 GitHub Actions variables 的 `COUPON_RANGES` / `CHECK_RANGES` 產生補充候選碼。
3. 合併、去重、排序候選碼。
4. 逐筆呼叫官方 API 驗證（候選碼之間依 `KFC_API_SLEEP` 節流）。
5. 只保留驗證成功的優惠券，並排除過期超過 `KFC_EXPIRED_GRACE_DAYS`（預設 14）天的券。
6. 輸出 `public/coupon.json`。

單筆 API timeout、無效券、格式解析失敗或商品無法標準化都不會中斷整體流程。無法標準化的商品會保留在 `unknownItems`，前端仍會顯示該優惠券。

### 菜單資料

`script/menu.py` 掃描官方線上點餐菜單（GetQueryMenu → 各分類 GetQueryFood → 逐商品家族 GetQueryFoodDetail），輸出 `public/menu.json`。每個商品項目包含：

- 單點與套餐變體（`isSingleItem` 區分），以及 `basePrice` / `minPrice`（實付 = basePrice + 所選選項的 `extra` 加價）。
- `fixedItems`（固定內容物，已標準化為 productKey）、`choiceGroups`（任選群組）與 `addonGroups`（加購）。
- 可購買時段 `mealPeriods`（1=早餐、2=午餐、3=下午茶、4=晚餐）與所屬菜單分類。

抓取失敗時保留既有 `menu.json`。前端會把單點直接轉成 offer；套餐則保留任選群組，交由 optimizer 依使用者需求動態搜尋具體選項，不再預先展開所有排列。加購群組不參與目前的最佳化。

## 官方 API 設定

官方 API 端點可能變動，因此以環境變數設定：

```bash
KFC_OFFICIAL_API_URL=https://example.com/official/coupon/api
KFC_OFFICIAL_API_METHOD=POST
KFC_API_TIMEOUT=20
KFC_API_RETRIES=2
KFC_API_SLEEP=0.8
KFC_EXPIRED_GRACE_DAYS=14
COUPON_RANGES=12000-12100,23456
CHECK_RANGES=30000-30100
```

`KFC_OFFICIAL_API_URL` 建議放在 GitHub repository secrets。`COUPON_RANGES`、`CHECK_RANGES` 可放在 repository variables。範圍掃描只是補充來源，請避免設定過大的範圍。

## GitHub Actions

`.github/workflows/main.yml` 每天 UTC 17:15 執行，約等於台灣時間 01:15。流程會：

1. 執行 `python script/kfc.py`。
2. 執行 `python script/menu.py`。
3. 若 `public/coupon.json`、`public/product-history.json` 或 `public/menu.json` 有異動，自動 commit 回 repository。
4. 部署目前靜態網站到 GitHub Pages。

請到 repository settings 啟用 GitHub Pages，來源選擇 GitHub Actions。

## 本機執行

```bash
npm test
python script/kfc.py
npx http-server . -p 4173 -c-1
```

也可以直接用瀏覽器開啟 `index.html`，但使用本機靜態伺服器比較接近 GitHub Pages 的載入方式。

## 新增商品標準化規則

商品目錄（分類、品項、別名）的唯一來源是 `src/data/product-catalog.json`，前端與資料更新腳本共用。修改後執行：

```bash
node script/build-catalog.mjs
```

會重新生成前端使用的 `src/lib/productCatalogData.js`（`tests/catalogSync.test.js` 會確保兩者同步）；Python 端直接讀取同一份 JSON，無須另外維護規則。

優惠券解析後會形成：

```json
{
  "items": {
    "egg_tart": 1
  },
  "rawItems": [
    { "name": "原味蛋撻", "quantity": 1 }
  ]
}
```

## 調整最佳化演算法

`src/lib/optimizer.js` 以通用 offer（優惠券／單點／套餐）使用有限候選集合與 bounded search；
`src/lib/offers.js` 負責把優惠券、`menu.json` 單點與套餐變體轉成共同的
`{ id, kind, price, items, ... }` 形狀。舊的 `optimizeCoupons()` 介面仍保留，新的供給池使用
`optimizeOffers()`：

- 先依即時日期排除未上市／過期 offer，並排除已售罄菜單品項。
- 依 UI 選擇的早餐／午餐／下午茶／晚餐過濾菜單與優惠券 offer；舊資料若尚無優惠券時段，為向後相容暫保留於所有時段。
- 再排除與需求完全無關的 offer。
- 依需求相關商品的單位價格排序並限制候選數。
- 每個需求至少保留一個供應來源，避免單點兜底被候選上限截掉。
- 搜尋前先建立可行方案作為價格上界，再以剩餘需求的樂觀成本做 branch-and-bound。
- 每個 offer 最大購買數量依需求量加 buffer 推估。
- 比較順序：總價最低、多買品項較少、offer 數量較少、到期日較晚。

可調整 `maxCandidates`、`extraBuffer`、`maxStates` 來平衡準確度與前端效能。

## 注意事項

- 本專案只整理公開可查詢的優惠券資訊。
- 最終可用性仍以肯德基官方網站 / APP 實際結帳結果為準。
- 不應高頻率請求官方 API。
- 不保證收錄所有優惠券。
