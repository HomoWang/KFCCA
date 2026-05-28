import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { enrichCoupon } from "../src/lib/couponParser.js";
import { productCategoryKey } from "../src/lib/productCatalog.js";

const data = JSON.parse(fs.readFileSync(new URL("../public/coupon.json", import.meta.url), "utf8"));
const coupons = data.coupons.map(enrichCoupon);

test("current coupon data has no unknown or unmapped items after enrichment", () => {
  const unknownCoupons = coupons.filter((coupon) => coupon.unknownItems?.length);
  const unmappedKeys = coupons.flatMap((coupon) =>
    Object.keys(coupon.items ?? {})
      .filter((key) => !productCategoryKey(key))
      .map((key) => `${coupon.code}:${key}`)
  );

  assert.deepEqual(unknownCoupons.map((coupon) => coupon.code), []);
  assert.deepEqual(unmappedKeys, []);
});

test("26918 is not double-counted as two fried chicken items", () => {
  const coupon = coupons.find((item) => item.code === "26918");

  assert(coupon);
  assert.equal(coupon.items.crispy_chicken_spicy, 1);
  assert.equal(coupon.items.fried_chicken_piece, undefined);
});

test("40634 egg tart flavored ice cream is not treated as egg tart", () => {
  const coupon = coupons.find((item) => item.code === "40634");

  assert(coupon);
  assert.equal(coupon.items.egg_tart, undefined);
  assert.equal(coupon.items.egg_tart_ice_cream, 2);
  assert.equal(productCategoryKey("egg_tart_ice_cream"), "ice_cream");
});

test("strawberry cheese ice cream mochi keeps a precise product key", () => {
  const coupon = coupons.find((item) => item.description?.includes("草苺起司冰淇淋大福"));

  assert(coupon);
  assert.equal(coupon.items.ice_cream_mochi, undefined);
  assert(Number(coupon.items.strawberry_cheese_mochi ?? 0) > 0);
  assert.equal(productCategoryKey("strawberry_cheese_mochi"), "ice_cream");
});

test("new sauce names are normalized as side items", () => {
  const coupon = coupons.find((item) => item.code === "50527");

  assert(coupon);
  assert.equal(coupon.unknownItems.length, 0);
  assert.equal(coupon.items.sauce, 2);
});
