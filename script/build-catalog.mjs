// 商品目錄單一來源是 src/data/product-catalog.json。
// 前端無建置流程、瀏覽器又不能同步 import JSON，因此把 JSON 轉印成 ES module 供前端使用；
// tests/catalogSync.test.js 會確保兩者同步。改完 JSON 後執行：node script/build-catalog.mjs
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const sourceUrl = new URL("src/data/product-catalog.json", root);
const targetUrl = new URL("src/lib/productCatalogData.js", root);

const catalog = JSON.parse(fs.readFileSync(sourceUrl, "utf8"));
const banner = "// 本檔由 script/build-catalog.mjs 依 src/data/product-catalog.json 生成，請勿手改。\n";
fs.writeFileSync(targetUrl, `${banner}export const productCategories = ${JSON.stringify(catalog.categories, null, 2)};\n`);
console.log("Generated src/lib/productCatalogData.js");
