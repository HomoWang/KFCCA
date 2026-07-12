# KFCCa 開發手冊（給 AI 協作者）

KFC 優惠券查詢＋最划算計算站。零依賴靜態前端（ES modules，無建置）+ Python 抓取管線 + GitHub Actions 每日更新資料並部署 GitHub Pages。**產品終極目標：使用者選想吃的品項，系統自動算出最省點法——不限優惠券，涵蓋單點、官方套餐、早餐時段、新品。**

## 檔案地圖

| 路徑 | 職責 |
|---|---|
| `index.html` + `src/app.js` | 前端入口與 UI（優惠券清單 + 計算機） |
| `src/lib/optimizer.js` | 最佳化搜尋（bounded DFS + branch & bound） |
| `src/lib/couponParser.js` | `isCouponCurrentlyAvailable()` = 唯一合法的可用性判斷 |
| `src/lib/couponLifecycle.js` | 進行中/即將結束/已過季/新登場（台灣時區慣例在此） |
| `src/data/product-catalog.json` | **商品目錄唯一來源**（分類/品項/別名） |
| `src/lib/productCatalogData.js` | 由 `node script/build-catalog.mjs` 生成，勿手改 |
| `script/kfc.py` | 優惠券管線入口（izo 候選碼 + 官方 API 驗證） |
| `script/menu.py` + `script/gatherer/menu.py` | 菜單管線 → `public/menu.json` |
| `script/gatherer/official_api.py` | 官方 API client + 正規化（讀同一份目錄 JSON） |
| `public/*.json` | 發布資料（coupon / menu / product-history），CI 每日 commit |
| `tests/*.test.js` | `node --test`，零依賴 |

## 鐵律（皆來自實際踩過的坑）

1. **目錄單一來源**：改商品目錄只改 `src/data/product-catalog.json`，改完跑 `node script/build-catalog.mjs` 重新生成（`catalogSync.test.js` 會擋不同步）。不得在 JS/Python 硬編碼商品清單。
2. **可用性只准用日期即時判斷**（`isCouponCurrentlyAvailable`）。資料檔的 `available` 欄位恆為 true，不可信。
3. **演算法改動必附四情境測試**：空需求／全可滿足／全不可滿足／混合（部分可滿足）。歷史教訓：漏掉混合情境導致計算機遇到一項無解就整組放棄。
4. **檔案一律 UTF-8**。Windows PowerShell 寫檔預設 UTF-16，曾把中文字串寫壞成 `?芣???` 進版控。寫完含中文的檔案必須重讀驗證。
5. **對官方 API 節流**：候選碼/商品之間依 `KFC_API_SLEEP`（0.8s）延遲。文件承諾的行為必須真的存在於程式碼。
6. **不生成沒有消費端的產出檔**（曾有 `public/coupon.js` 死代碼每日膨脹 git 史）。
7. **前端所有 innerHTML 插值必過 `escapeHtml()`**（抓來的資料是不可信輸入）。
8. **日期一律台灣時區**：解析用 `T00:00:00+08:00`，「今天」用 `Asia/Taipei`，照 `couponLifecycle.js` 慣例。

## 驗收流程

- `node --test` 全綠（CI 在 commit 資料前也會跑）。
- 改 optimizer/normalizer：額外用 `node -e` 跑真實混合需求 sanity check，肉眼確認 selectedCoupons/missing 合理。
- 改 Python：`python -m py_compile` + 實際匯入；測試腳本在 repo 根目錄執行，`sys.path.insert(0, 'script')` 後 `from gatherer.xxx import ...`。
- UI 改動：`python -m http.server 4173` + headless Chrome `--dump-dom --virtual-time-budget=8000` 冒煙（本機 Chrome 在 `C:\Program Files\Google\Chrome\Application\chrome.exe`）。
- Windows console 印中文會因 cp950 亂碼——用 `PYTHONIOENCODING=utf-8`，亂碼顯示≠資料壞掉，以檔案內容為準。

## 官方 API 知識庫（2026-07-12 實測）

Host `https://olo-api.kfcclub.com.tw`，headers 需帶 `Origin/Referer: https://www.kfcclub.com.tw`（`OfficialApiClient._post` 已封裝，含 cookie 初始化與 retry）。

- `menu/v1/GetQueryMenu`：body `{shopcode, mealperiod, ordertype:"2", ismember:"0", parentid:"0", orderdate:"YYYY/MM/DD"}` → `Data.Menu[]`（分類，MenuID/Title）。時段 1=早餐 2=午餐 3=下午茶 4=晚餐。
- `menu/v1/GetQueryFood`：加 `menuid` → `Data.Foods[].Details[]`（商品家族：Fcode/Name/SoldOut/起訖日，**無價格**）。
- `menu/v1/GetQueryFoodDetail`：以**家族 fcode** 查 → `Data.FoodDetail[]` = 該商品**全部變體**（單點+各套餐）。`isSingleItem` 區分單點。
- **價格語意**：實付 = `Original_Price` + Σ(所選選項 `MListPrice`)。`minPrice` = base + 必選 slot 最低加價。已驗證與真實售價一致（咔啦雞腿堡單點 95、XL 餐 213）。
- **坑**：單點的內容物不在 `Details` slots（商品名即內容物）；`MinCount=0` 的 slot 是加購，不是內容物也不計價；餐具/環保選項會混在 slots 要濾掉（`should_ignore_item`）；數量寫在名稱字尾（「咔啦脆雞2塊」）。這些都已處理在 `gatherer/menu.py`，動它前先讀。
- 優惠券驗證：`customer/v1/getEVoucherAPI`（`voucherNo`）；時段探測 `checkCouponProduct`。

## 現狀（2026-07-12）

Phase 0（還債）與 Phase 1（菜單資料）已完成並推上 main（commits `d0c2c18`、`8495fab`、`49bc601`）。`public/menu.json` 有 205 商品（52 單點/153 套餐，含早餐、choiceGroups、addonGroups），未標準化僅剩「蜂蜜糖球」。資料形狀由 `tests/menuData.test.js` 驗證。

## 下一步：Phase 2 任務書（optimizer 泛化成 offers）

目標：計算機的供給池從「只有優惠券」擴成「券 + 單點 + 套餐」，並支援用餐時段。

1. **offer 抽象**：`{ id, kind: "coupon"|"alacarte"|"combo", price, items, endDate?, mealPeriods? }`。現有 optimizer 本質就是「花錢買一包 items」的搜尋器，candidate 選擇/DFS/比價幾乎不用動，改的是入池與結果呈現。
2. **單點入池**：menu.json 中 `isSingleItem` 商品 → offer（price=minPrice, items=fixedItems）。效益：需求永遠有解（「無法滿足」只剩菜單根本沒有）；單點總價是天然上界，可強化剪枝。
3. **套餐入池（變體展開）**：每個 combo 的 choiceGroups 先用「變體展開」處理——每組選一個選項展開成具體 offer（price=base+Σ所選 extra，items=fixed+所選）。設展開上限（如每商品 ≤48 變體，超過取各組最便宜選項）。addonGroups 忽略。
4. **時段**：UI 加「用餐時段」選擇（預設午餐），按 `mealPeriods` 過濾 menu offers；優惠券暫不分時段（資料未記錄，Phase 3 再補）。
5. **過濾沿用鐵律 2**：menu offers 也要檢查 endDate/soldOut。
6. **結果呈現**：方案內區分來源（優惠券代碼 vs 單點 vs 套餐名），總價、多買、缺少邏輯不變。
7. **測試**：鐵律 3 四情境 × (純券/純單點/混合池)；新增「單點兜底」案例（無券可滿足時用單點補）與「套餐 vs 單點+券比價」案例。fixture 一律注入固定 `now`。

拆批建議：(a) offer 化 + 單點（含測試）→ (b) 套餐變體展開 → (c) UI 時段與呈現。每批 `node --test` 全綠再進下一批。

## Phase 3+ backlog

- 優惠券記錄可用時段（`checkCouponProduct` 探測結果目前只用來判斷外送，沒存）。
- choiceGroups 原生搜尋（不展開），處理大型任選組。
- 菜單新品徽章（product-history 機制擴到 menu items）。
- 前端 fetch 失敗的明確錯誤 UI；搜尋 debounce；`cache: "no-store"` 改 `no-cache` 吃 ETag。
