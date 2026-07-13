import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { menuProductsToOffers, resolveNativeComboOffers } from "../src/lib/offers.js";

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
    assert.equal(typeof product.soldOut, "boolean");
    assert.ok(Number.isFinite(product.basePrice) && product.basePrice >= 0);
    assert.ok(Number.isFinite(product.minPrice) && product.minPrice >= product.basePrice);
    if (product.startDate) assert.match(product.startDate, /^\d{4}-\d{2}-\d{2}$/);
    if (product.endDate) assert.match(product.endDate, /^\d{4}-\d{2}-\d{2}$/);
    if (product.startDate && product.endDate) assert.ok(product.startDate <= product.endDate);
    assert.ok(product.fixedItems && typeof product.fixedItems === "object");
    assert.ok(Object.values(product.fixedItems).every((quantity) => Number.isInteger(quantity) && quantity > 0));
    if (product.isSingleItem) assert.ok(Object.keys(product.fixedItems).length > 0);
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
    assert.equal(new Set(product.mealPeriods).size, product.mealPeriods.length);
    assert.ok(product.mealPeriods.every((period) => ["1", "2", "3", "4"].includes(period)));
  }
});

test("menu.json contains a la carte entries usable as price baseline", { skip }, () => {
  const singles = menu.products.filter((product) => product.isSingleItem);
  assert.ok(singles.length > 0, "expected at least one isSingleItem product");
});

test("live menu products expand to bounded, unique offers", { skip }, () => {
  const offers = menuProductsToOffers(menu.products);
  const ids = offers.map((offer) => offer.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(offers.every((offer) =>
    Object.keys(offer.items).length > 0 || offer.choiceGroups?.some((group) =>
      group.options?.some((option) => option.productKey && option.isNoItem !== true)
    )
  ));

  for (const product of menu.products) {
    const productOffers = offers.filter((offer) => offer.fcode === product.fcode);
    assert.equal(productOffers.length, 1, `${product.fcode} should produce one optimizer template`);
    assert.ok(productOffers.every((offer) => offer.price >= product.minPrice));
    if (!product.isSingleItem) {
      const hasChoices = product.choiceGroups.some((group) => group.options.length);
      assert.ok(productOffers.every((offer) => offer.expansionMode === (hasChoices ? "native" : "full")));
    }
  }

  const fries = offers.find((offer) => offer.fcode === "FA196");
  assert.deepEqual(fries.items, { medium_fries: 1, sauce: 1 });
  const tartPair = offers.find((offer) => offer.fcode === "FA233");
  assert.equal(tartPair.items.egg_tart, 2);
  const shrimp = offers.find((offer) => offer.fcode === "FA173");
  assert.equal(shrimp.items.shrimp_nuggets, 3);
  assert.equal(shrimp.items.chicken_nuggets, undefined);
  const shrimpChoice = resolveNativeComboOffers(
    offers.filter((offer) => offer.fcode === "OA620"),
    [{ type: "exact", productKey: "shrimp_nuggets", quantity: 1 }]
  ).find((offer) =>
    offer.selectedChoices?.some((choice) => choice.name === "黃金超蝦塊")
  );
  assert.ok(shrimpChoice);
  assert.equal(shrimpChoice.items.shrimp_nuggets, 1);
  assert.equal(shrimpChoice.items.chicken_nuggets, undefined);
});
