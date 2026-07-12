import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// 與 dataQuality.test.js 同策略：驗 live 資料的形狀。menu.json 由 script/menu.py 生成，
// 尚未生成（或本地沒跑過）時跳過而不失敗。
const menuUrl = new URL("../public/menu.json", import.meta.url);
const exists = fs.existsSync(menuUrl);
const menu = exists ? JSON.parse(fs.readFileSync(menuUrl, "utf8")) : null;
const skip = exists ? false : "public/menu.json not generated yet";

test("menu.json products have a valid offer shape", { skip }, () => {
  assert.ok(Array.isArray(menu.products) && menu.products.length > 0);
  for (const product of menu.products) {
    assert.ok(typeof product.fcode === "string" && product.fcode.length > 0);
    assert.equal(typeof product.name, "string");
    assert.equal(typeof product.isSingleItem, "boolean");
    assert.ok(Number.isFinite(product.basePrice) && product.basePrice >= 0);
    assert.ok(Number.isFinite(product.minPrice) && product.minPrice >= product.basePrice);
    assert.ok(product.fixedItems && typeof product.fixedItems === "object");
    assert.ok(Array.isArray(product.choiceGroups));
    for (const group of product.choiceGroups) {
      assert.ok(Number.isFinite(group.count) && group.count >= 1);
      assert.ok(Array.isArray(group.options) && group.options.length >= 2);
      for (const option of group.options) {
        assert.ok(typeof option.name === "string" && option.name.length > 0);
        assert.ok(Number.isFinite(option.extra) && option.extra >= 0);
        assert.ok(Number.isFinite(option.quantity) && option.quantity >= 1);
      }
    }
    assert.ok(Array.isArray(product.mealPeriods) && product.mealPeriods.length > 0);
  }
});

test("menu.json contains a la carte entries usable as price baseline", { skip }, () => {
  const singles = menu.products.filter((product) => product.isSingleItem);
  assert.ok(singles.length > 0, "expected at least one isSingleItem product");
});
