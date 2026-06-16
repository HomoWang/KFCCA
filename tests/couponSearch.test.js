import assert from "node:assert/strict";
import test from "node:test";
import { matchCoupon, buildSuggestions, productKeysMatchingQuery } from "../src/lib/couponSearch.js";

const tartCoupon = { code: "15532", title: "渣打路跑", description: "卡啦雞腿堡 + 蛋塔", rawItems: [], items: { egg_tart: 1, zinger_burger: 1 } };
const burgerCoupon = { code: "20001", title: "脆雞堡餐", description: "", rawItems: [], items: { crispy_chicken_burger: 1 } };
const coupons = [tartCoupon, burgerCoupon];

test("alias-aware search matches egg_tart coupon when querying 蛋撻", () => {
  assert.ok(productKeysMatchingQuery("蛋撻").includes("egg_tart"));
  assert.equal(matchCoupon(tartCoupon, "蛋撻"), true);
});

test("search matches by coupon code", () => {
  assert.equal(matchCoupon(tartCoupon, "15532"), true);
});

test("search returns false when neither text nor mapped product matches", () => {
  assert.equal(matchCoupon(burgerCoupon, "蛋撻"), false);
});

test("empty query matches everything", () => {
  assert.equal(matchCoupon(burgerCoupon, ""), true);
  assert.equal(matchCoupon(burgerCoupon, "   "), true);
});

test("buildSuggestions returns product suggestions with filter ids", () => {
  const suggestions = buildSuggestions("蛋塔", coupons, { limit: 5 });
  const product = suggestions.find((s) => s.type === "product" && s.key === "egg_tart");
  assert.ok(product);
  assert.equal(product.filterId, "exact:egg_tart");
});

test("buildSuggestions returns code suggestions and respects the limit", () => {
  const suggestions = buildSuggestions("20001", coupons, { limit: 3 });
  assert.ok(suggestions.some((s) => s.type === "code" && s.code === "20001"));
  assert.ok(buildSuggestions("雞", coupons, { limit: 2 }).length <= 2);
});

test("blank query yields no suggestions", () => {
  assert.deepEqual(buildSuggestions("", coupons), []);
});
